/**
 * Headless programmatic editing.
 *
 * Hydrates the real timeline domain stores from a Project, applies a list of
 * edit ops by driving the REAL timeline action modules (so transition repair,
 * track ordering, split-id rebinding, undo bookkeeping etc. all behave exactly
 * like the editor), then serializes the stores back to a Project. No workspace
 * storage layer is required.
 */
import type { Project } from '@/types/project'
import type {
  TimelineItem,
  TimelineTrack,
  TextItem,
  VideoItem,
  AudioItem,
  ImageItem,
} from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import type { Transition } from '@/types/transition'
import type { AnimatableProperty, EasingType } from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { TransformProperties } from '@/types/transform'

import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import {
  hydrateTimelineStoresFromProject,
  buildTimelineFromStores,
} from '@/features/timeline/stores/timeline-persistence'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
import { seedMediaLibrary } from './seed-media'
import {
  applyTemplateOp,
  assertTemplateInstanceUpdate,
  setTemplateEditInput,
  type TemplateOperationName,
} from './template-ops'
import type { MotionTemplate } from '@/shared/motion-templates/template-core.mjs'
import {
  addItem,
  updateItem,
  moveItem,
  removeItems,
  splitItem,
  trimItemStart,
  trimItemEnd,
  addTransition,
  updateTransition,
  removeTransition,
  setTransformParent,
  addKeyframes,
  setTracks,
  addKeyframe,
  removeKeyframesForProperty,
  addEffect,
  removeEffect,
  updateEffect,
  updateItemTransform,
} from '@/features/timeline/stores/timeline-actions'
import { getGpuEffect } from '@/infrastructure/gpu-effects'
import { timelineItemProblem } from '@/features/project-bundle/schemas/project-schema'
import { runTextStyleOp, setTextStyleEditInput, styleNewTextItem } from './text-style-ops'
import type { TextStyleEditInput } from './text-style-ops'
import {
  assertItemPlacement,
  assertNoTrackOverlap,
  assertTrimPlacement,
  findFreeTrack,
  type OverlapContext,
} from './track-overlap'
import { buildLutEffect, type HeadlessLutFile } from './lut-op'
import { linkedTimingFollowers } from './linked-timing'
import { removeItemsOp, runMarkerOp } from './marker-ops'
import { runSpeedRampOp, speedUpdateTiming, type SpeedRampOperationName } from './speed-ramp-ops'

const log = createLogger('HeadlessEdit')

export type EditOperationName =
  | 'addText'
  | 'addItem'
  | 'updateItem'
  | 'moveItem'
  | 'removeItems'
  | 'split'
  | 'trimStart'
  | 'trimEnd'
  | 'addTransition'
  | 'updateTransition'
  | 'removeTransition'
  | 'addTrack'
  | 'removeTrack'
  | 'addClip'
  | 'addKeyframe'
  | 'removeKeyframes'
  | 'setTransformParent'
  | 'addEffect'
  | 'removeEffect'
  | 'updateEffect'
  | 'addLut'
  | 'setTransform'
  | 'unlinkItems'
  | 'addMarker'
  | 'removeMarkers'
  | TemplateOperationName
  | 'applyTextStyle'
  | 'upsertTextStyle'
  | 'addCaptions'
  | SpeedRampOperationName

/** A wire operation. Node validates its discriminator and fields before this browser boundary. */
export type EditOp = Record<string, unknown> & { op: EditOperationName }

export interface HeadlessEditInput {
  project: Project
  ops: EditOp[]
  /** MediaMetadata for any media referenced by ops (e.g. addClip), keyed for codec/fps/duration lookups. */
  media?: Array<{ mediaId: string; metadata?: MediaMetadata }>
  /** Library text styles the ops name by styleId (copied into the project on use). */
  textStyleLibrary?: TextStyleEditInput['library']
  /** Built-in transcripts of the media addCaptions captions. */
  transcripts?: TextStyleEditInput['transcripts']
  /** Text of the workspace `luts/` files that addLut ops name (read by the Node side). */
  luts?: HeadlessLutFile[]
  /** Library templates named by addTemplate/updateTemplate ops (read by the Node side). */
  templates?: MotionTemplate[]
}

export interface HeadlessEditResult {
  ok: true
  /** The edited project (timeline rebuilt from stores). The driver writes this to disk. */
  project: Project
  applied: number
  results: Array<{ callerId?: string; op: string; ok: boolean; detail?: unknown; error?: string }>
}

function resolvePointer(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) throw new Error(`Invalid result JSON pointer "${pointer}"`)
  let current = value
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (current === null || typeof current !== 'object' || !(key in current)) {
      throw new Error(`Result reference pointer not found: ${pointer}`)
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const REFERENCE_ID_FIELDS = new Set([
  'id',
  'itemId',
  'trackId',
  'leftClipId',
  'rightClipId',
  'effectId',
  'mediaId',
  // Template ops: composition and control targets from createComposition results.
  'compositionId',
  'targetItemId',
  // Text style ops: the clip addCaptions captions, the item upsertTextStyle saves.
  'clipId',
  'fromItemId',
])

function resolveOperationRefs(
  op: EditOp,
  prior: Map<string, HeadlessEditResult['results'][number]>,
): EditOp {
  const visit = (value: unknown, field?: string): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$ref' in value) {
      if (!field || !REFERENCE_ID_FIELDS.has(field))
        throw new Error(`$ref is not allowed in field "${field ?? '$'}"`)
      const ref = (value as { $ref?: unknown }).$ref
      if (typeof ref !== 'string') throw new Error('$ref must be a string')
      const match = /^([A-Za-z][A-Za-z0-9_-]{0,63})#(\/.*)$/.exec(ref)
      if (!match) throw new Error(`Invalid result reference: ${ref}`)
      const result = prior.get(match[1]!)
      if (!result?.ok)
        throw new Error(`Result reference is not a prior successful operation: ${match[1]}`)
      const resolved = resolvePointer(result, match[2]!)
      if (typeof resolved !== 'string')
        throw new Error(`Result reference must resolve to an id string: ${ref}`)
      return resolved
    }
    if (Array.isArray(value))
      return value.map((entry) => visit(entry, field === 'ids' ? 'id' : field))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, visit(entry, key)]),
      )
    }
    return value
  }
  return visit(op) as EditOp
}

// Canvas of the project being edited (set per editProject call) — transform-parent
// binds resolve world transforms against it.
let editCanvas = { width: 1920, height: 1080, fps: 30 }
// LUT files passed with the current editProject call, for addLut.
let editLuts: readonly HeadlessLutFile[] = []

const asString = (value: unknown, fallback?: string): string | undefined =>
  typeof value === 'string' ? value : fallback
const asNumber = (value: unknown, fallback?: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

function tracks(): TimelineTrack[] {
  return useItemsStore.getState().tracks
}

type EffectParamSpec = NonNullable<ReturnType<typeof getGpuEffect>>['params'][string]

const EFFECT_PARAM_CHECKS: Record<
  EffectParamSpec['type'],
  (value: unknown, spec: EffectParamSpec) => string | null
> = {
  number: (value, spec) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number'
    if (
      (spec.min !== undefined && value < spec.min) ||
      (spec.max !== undefined && value > spec.max)
    ) {
      return `must be between ${spec.min} and ${spec.max}`
    }
    return null
  },
  boolean: (value) => (typeof value === 'boolean' ? null : 'must be true or false'),
  select: (value, spec) =>
    spec.options?.some((option) => option.value === value)
      ? null
      : `must be one of ${spec.options?.map((option) => option.value).join(', ')}`,
  color: (value) => (typeof value === 'string' ? null : 'must be a colour string'),
  point: () => null,
  json: (value) => (typeof value === 'string' ? null : 'must be a JSON string'),
  text: (value) => (typeof value === 'string' ? null : 'must be a string'),
}

/** Reject unknown params and out-of-range values the way the editor's controls would. */
function validateEffectParams(gpuEffectType: string, params: unknown): void {
  const definition = getGpuEffect(gpuEffectType)
  if (!definition) throw new Error(`gpuEffectType: unknown GPU effect "${gpuEffectType}"`)
  if (!params || typeof params !== 'object') throw new Error('params must be an object')
  for (const [key, value] of Object.entries(params)) {
    const spec = definition.params[key]
    if (!spec) {
      throw new Error(
        `params.${key}: ${gpuEffectType} has no such param (has ${Object.keys(definition.params).join(', ')})`,
      )
    }
    const problem = EFFECT_PARAM_CHECKS[spec.type](value, spec)
    if (problem) throw new Error(`params.${key}: ${problem}`)
  }
}

/** Linked companions that follow a timing update, each checked for room on its track. */
function linkedFollowersFor(
  context: OverlapContext,
  item: TimelineItem,
  updates: Partial<TimelineItem>,
): ReturnType<typeof linkedTimingFollowers> {
  const followers = linkedTimingFollowers(useItemsStore.getState().items, item, updates)
  for (const follower of followers) {
    assertItemPlacement(context, follower.item, {
      from: asNumber(follower.updates.from),
      durationInFrames: asNumber(follower.updates.durationInFrames),
    })
  }
  return followers
}

function requireItem(id: string, field = 'id'): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`${field}: item "${id}" does not exist`)
  return item
}

function requireTransition(id: string, field = 'id'): Transition {
  const transition = useTransitionsStore.getState().transitions.find((t) => t.id === id)
  if (!transition) throw new Error(`${field}: transition "${id}" does not exist`)
  return transition
}

/**
 * Confirm an `updateTransition` actually landed.
 *
 * `updateTransition` runs handle validation for `durationInFrames` / `alignment`
 * and, on rejection, only logs — its signature is `void`, so a caller cannot tell
 * a rejected edit from an applied one. Comparing against the post-update state
 * catches every rejection path, present and future, without changing the shared
 * store API.
 */
function assertTransitionUpdateApplied(
  id: string,
  updates: Parameters<typeof updateTransition>[1],
): void {
  const applied = requireTransition(id)
  const rejected = Object.entries(updates)
    .filter(([field, requested]) => {
      const actual = (applied as unknown as Record<string, unknown>)[field]
      // `properties` is a plain object; the rest are scalars.
      return JSON.stringify(actual) !== JSON.stringify(requested)
    })
    .map(([field, requested]) => `${field}=${JSON.stringify(requested)}`)

  if (rejected.length === 0) return
  throw new Error(
    `updateTransition("${id}") was rejected: ${rejected.join(', ')} — the transition is unchanged. ` +
      'Duration and alignment must fit the handles available on both clips.',
  )
}

function requireTrack(id: string, field = 'trackId'): TimelineTrack {
  const track = tracks().find((candidate) => candidate.id === id)
  if (!track) throw new Error(`${field}: track "${id}" does not exist`)
  if (track.isGroup) throw new Error(`${field}: track "${id}" is a group and cannot contain items`)
  return track
}

/** Resolve a usable trackId: the requested one if it exists, else the first non-group video track. */
function resolveTrackId(preferred: unknown, kind: 'video' | 'audio' = 'video'): string {
  const all = tracks()
  const requested = asString(preferred)
  if (requested) {
    const track = requireTrack(requested)
    if ((track.kind ?? 'video') !== kind)
      throw new Error(`trackId: track "${requested}" is not ${kind}`)
    return requested
  }
  const match = all.find((t) => !t.isGroup && (t.kind ?? 'video') === kind)
  const fallback = match ?? all.find((t) => !t.isGroup)
  if (!fallback) throw new Error('No track available to place item on (add a track first)')
  return fallback.id
}

function newId(): string {
  return crypto.randomUUID()
}

/** Create a track of the given kind (video on top, audio at bottom unless `order` is given). */
function createTrack(kind: 'video' | 'audio', order?: number): TimelineTrack {
  const all = tracks()
  const orders = all.map((t) => t.order)
  const track = createClassicTrack({
    tracks: all,
    kind,
    order: order ?? (kind === 'video' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1),
  })
  setTracks([...all, track])
  return track
}

/** `addTrack`: a new lane, optionally named and given its role in the project's format. */
function addTrackOp(op: EditOp): { trackId: string; name: string } {
  const track = createTrack(op.kind === 'audio' ? 'audio' : 'video', asNumber(op.order))
  const name = asString(op.name)
  const formatRole = asString(op.formatRole) as TimelineTrack['formatRole']
  if (name || formatRole) {
    setTracks(
      tracks().map((t) =>
        t.id === track.id ? { ...t, ...(name && { name }), ...(formatRole && { formatRole }) } : t,
      ),
    )
  }
  return { trackId: track.id, name: name ?? track.name }
}

/** Find a non-group track of the given kind, or create one. */
function getOrCreateTrack(kind: 'video' | 'audio'): string {
  const existing = tracks().find((t) => !t.isGroup && (t.kind ?? 'video') === kind)
  return existing?.id ?? createTrack(kind).id
}

/** Add a new item at exactly its requested place, failing on a same-track overlap. */
function addItemExactly(context: OverlapContext, item: TimelineItem, name: string): void {
  assertNoTrackOverlap(context, {
    trackId: item.trackId,
    from: item.from,
    durationInFrames: item.durationInFrames,
    name,
  })
  addItem(item)
}

const quoted = (kind: string, text: string) => `${kind} "${text.slice(0, 40)}"`

/** The requested track if it exists, else find-or-create one of the given kind. */
function resolveOrCreateTrack(preferred: unknown, kind: 'video' | 'audio'): string {
  const requested = asString(preferred)
  if (requested) {
    const track = requireTrack(requested)
    if ((track.kind ?? 'video') !== kind)
      throw new Error(`trackId: track "${requested}" is not ${kind}`)
    return requested
  }
  return getOrCreateTrack(kind)
}

/** Source-frame fields for a media clip (source* are in source-native fps). */
function sourceFieldsFor(media: MediaMetadata, projectFps: number) {
  const sourceFps = media.fps && media.fps > 0 ? media.fps : projectFps
  const durationSec = media.duration ?? 0
  const sourceEnd = Math.max(1, Math.round(durationSec * sourceFps))
  return { sourceFps, sourceStart: 0, sourceEnd, sourceDuration: sourceEnd, speed: 1 }
}

function buildTextItem(op: EditOp): TextItem {
  return {
    id: asString(op.id) ?? newId(),
    type: 'text',
    trackId: resolveTrackId(op.trackId, 'video'),
    from: asNumber(op.from, 0)!,
    durationInFrames: asNumber(op.durationInFrames, 90)!,
    label: asString(op.label) ?? 'Text',
    text: asString(op.text) ?? 'Text',
    color: asString(op.color) ?? '#ffffff',
    fontSize: asNumber(op.fontSize, 80)!,
    ...(asString(op.fontFamily) && { fontFamily: asString(op.fontFamily) }),
    ...(op.fontWeight === 'bold' || op.fontWeight === 'semibold' || op.fontWeight === 'medium'
      ? { fontWeight: op.fontWeight }
      : {}),
    ...(op.textAlign === 'left' || op.textAlign === 'center' || op.textAlign === 'right'
      ? { textAlign: op.textAlign }
      : {}),
    ...(op.verticalAlign === 'top' || op.verticalAlign === 'middle' || op.verticalAlign === 'bottom'
      ? { verticalAlign: op.verticalAlign }
      : {}),
  }
}

/**
 * Remove a track. A track with items is refused unless `removeItems: true`, which
 * removes them first (linked companions on other tracks go with them, as in the
 * editor). The editor never removes the last track, so neither does this.
 */
function removeTrackOp(op: EditOp): unknown {
  const trackId = asString(op.trackId)
  if (!trackId) throw new Error('removeTrack requires `trackId`')
  const track = requireTrack(trackId)
  const label = `track ${track.name} (${track.id})`
  if (tracks().length <= 1)
    throw new Error(`${label} is the only track; a project keeps at least one`)
  const before = useItemsStore.getState().items
  const onTrack = before.filter((item) => item.trackId === trackId)
  if (onTrack.length > 0 && op.removeItems !== true) {
    const names = onTrack
      .slice(0, 5)
      .map((item) => `${item.type} "${item.label ?? item.id}" (${item.id})`)
      .join(', ')
    throw new Error(
      `${label} has ${onTrack.length} item(s): ${names}${onTrack.length > 5 ? ', ...' : ''}. ` +
        'Move or remove them first, or pass removeItems: true to delete them with the track.',
    )
  }
  if (onTrack.length > 0) removeItems(onTrack.map((item) => item.id))
  const remaining = new Set(useItemsStore.getState().items.map((item) => item.id))
  setTracks(tracks().filter((candidate) => candidate.id !== trackId))
  return {
    trackId,
    name: track.name,
    removedItems: before.filter((item) => !remaining.has(item.id)).map((item) => item.id),
  }
}

/** Add a gpu-lut effect built from a workspace LUT file (see ./lut-op). */
function addLutOp(op: EditOp): { itemId: string; effectId: string | undefined } {
  const itemId = asString(op.itemId)
  if (!itemId) throw new Error('addLut requires `itemId`')
  requireItem(itemId, 'itemId')
  addEffect(itemId, buildLutEffect(op, editLuts))
  return { itemId, effectId: requireItem(itemId, 'itemId').effects?.at(-1)?.id }
}

/** Apply a single op by driving the real timeline action modules. Throws on bad input. */
function applyOp(op: EditOp): unknown {
  // Same-track overlaps are errors here, never silently shifted (see ./track-overlap).
  const context: OverlapContext = { op: op.op, callerId: asString(op.callerId) }
  switch (op.op) {
    case 'addText': {
      const item = styleNewTextItem(buildTextItem(op), op)
      addItemExactly(context, item, quoted('text', item.text))
      return { id: item.id }
    }
    case 'addItem': {
      const item = op.item as TimelineItem | undefined
      if (!item || typeof item !== 'object') throw new Error('addItem requires `item`')
      const withId: TimelineItem = { ...item, id: item.id || newId() }
      requireTrack(withId.trackId, 'item.trackId')
      addItemExactly(context, withId, quoted(withId.type, withId.label ?? withId.id))
      return { id: withId.id }
    }
    case 'updateItem': {
      const id = asString(op.id)
      if (!id) throw new Error('updateItem requires `id`')
      const item = requireItem(id)
      // A speed change is a rate stretch, as in the editor (./speed-ramp-ops).
      const updates = speedUpdateTiming(item, (op.updates ?? {}) as Partial<TimelineItem>)
      if (updates.trackId) requireTrack(updates.trackId, 'updates.trackId')
      if ('from' in updates || 'durationInFrames' in updates || 'trackId' in updates) {
        assertItemPlacement(context, item, {
          trackId: asString(updates.trackId),
          from: asNumber(updates.from),
          durationInFrames: asNumber(updates.durationInFrames),
        })
      }
      const problem = timelineItemProblem({ ...item, ...updates })
      if (problem) throw new Error(`updates.${problem}`)
      assertTemplateInstanceUpdate(item, updates)
      const followers = op.linked === false ? [] : linkedFollowersFor(context, item, updates)
      updateItem(id, updates)
      for (const follower of followers) updateItem(follower.item.id, follower.updates)
      return followers.length ? { id, linked: followers.map((f) => f.item.id) } : { id }
    }
    case 'moveItem': {
      const id = asString(op.id)
      const from = asNumber(op.from)
      if (!id || from === undefined) throw new Error('moveItem requires `id` and `from`')
      const item = requireItem(id)
      const destination = asString(op.trackId)
      if (destination) requireTrack(destination)
      assertItemPlacement(context, item, { from, trackId: destination })
      moveItem(id, from, destination)
      return { id, from }
    }
    case 'removeItems':
      return removeItemsOp(op)
    case 'split': {
      const id = asString(op.id)
      const frame = asNumber(op.frame)
      if (!id || frame === undefined) throw new Error('split requires `id` and `frame`')
      requireItem(id)
      const result = splitItem(id, frame)
      if (!result) throw new Error(`split failed for item ${id} at frame ${frame}`)
      return { leftId: result.leftItem.id, rightId: result.rightItem.id }
    }
    case 'trimStart': {
      const id = asString(op.id)
      const amount = asNumber(op.amount)
      if (!id || amount === undefined) throw new Error('trimStart requires `id` and `amount`')
      requireItem(id)
      assertTrimPlacement(context, id, 'start', amount)
      trimItemStart(id, amount)
      return { id }
    }
    case 'trimEnd': {
      const id = asString(op.id)
      const amount = asNumber(op.amount)
      if (!id || amount === undefined) throw new Error('trimEnd requires `id` and `amount`')
      requireItem(id)
      assertTrimPlacement(context, id, 'end', amount)
      trimItemEnd(id, amount)
      return { id }
    }
    case 'addTransition': {
      const left = asString(op.leftClipId)
      const right = asString(op.rightClipId)
      if (!left || !right) throw new Error('addTransition requires `leftClipId` and `rightClipId`')
      requireItem(left, 'leftClipId')
      requireItem(right, 'rightClipId')
      const added = addTransition(
        left,
        right,
        asString(op.type) as Parameters<typeof addTransition>[2],
        asNumber(op.durationInFrames),
        asString(op.presentation) as Parameters<typeof addTransition>[4],
        asString(op.direction) as Parameters<typeof addTransition>[5],
        asNumber(op.alignment) ?? 0.5,
      )
      if (!added) throw new Error(`addTransition failed for clips "${left}" and "${right}"`)
      const created = useTransitionsStore
        .getState()
        .transitions.filter((t) => t.leftClipId === left && t.rightClipId === right)
        .at(-1)
      if (created && (op.timing !== undefined || op.properties !== undefined)) {
        updateTransition(created.id, {
          ...(op.timing !== undefined
            ? { timing: asString(op.timing) as Transition['timing'] }
            : {}),
          ...(op.properties !== undefined
            ? { properties: op.properties as Transition['properties'] }
            : {}),
        })
      }
      return { added, id: created?.id, presentation: created?.presentation }
    }
    case 'updateTransition': {
      const id = asString(op.id)
      if (!id) throw new Error('updateTransition requires `id`')
      requireTransition(id)
      const updates: Parameters<typeof updateTransition>[1] = {
        ...(op.durationInFrames !== undefined
          ? { durationInFrames: asNumber(op.durationInFrames) }
          : {}),
        ...(op.presentation !== undefined
          ? { presentation: asString(op.presentation) as Transition['presentation'] }
          : {}),
        ...(op.direction !== undefined
          ? { direction: asString(op.direction) as Transition['direction'] }
          : {}),
        ...(op.timing !== undefined ? { timing: asString(op.timing) as Transition['timing'] } : {}),
        ...(op.alignment !== undefined ? { alignment: asNumber(op.alignment) } : {}),
        ...(op.properties !== undefined
          ? { properties: op.properties as Transition['properties'] }
          : {}),
      }
      if (Object.keys(updates).length === 0)
        throw new Error('updateTransition requires at least one field to change')
      updateTransition(id, updates)
      // The store action validates handles for duration/alignment and, when the
      // requested value doesn't fit, logs a warning and leaves the transition
      // untouched — it returns void, so the rejection is invisible from here.
      // Verify against the resulting state so a rejected edit fails loudly
      // instead of reporting ok with the old value still in place.
      assertTransitionUpdateApplied(id, updates)
      return { id }
    }
    case 'removeTransition': {
      const id = asString(op.id)
      if (!id) throw new Error('removeTransition requires `id`')
      requireTransition(id)
      removeTransition(id)
      return { id }
    }
    case 'addTrack':
      return addTrackOp(op)
    case 'removeTrack':
      return removeTrackOp(op)
    case 'addClip': {
      const mediaId = asString(op.mediaId)
      if (!mediaId) throw new Error('addClip requires `mediaId`')
      const media = useMediaLibraryStore.getState().mediaById[mediaId]
      if (!media) {
        throw new Error(
          `addClip: no metadata for media ${mediaId} (pass it via the CLI's media list)`,
        )
      }
      const from = asNumber(op.from, 0)!
      const projectFps = useTimelineSettingsStore.getState().fps || 30
      const created: Array<{ id: string; type: string; trackId: string }> = []
      const label = media.fileName ?? mediaId
      const place = (item: TimelineItem) => {
        addItemExactly(context, item, quoted(item.type, label))
        created.push({ id: item.id, type: item.type, trackId: item.trackId })
      }

      if (media.mimeType.startsWith('image/')) {
        const item: ImageItem = {
          id: newId(),
          type: 'image',
          trackId: resolveOrCreateTrack(op.trackId, 'video'),
          from,
          durationInFrames: asNumber(op.durationInFrames, 150)!,
          label,
          mediaId,
          src: '',
          ...(media.width ? { sourceWidth: media.width } : {}),
          ...(media.height ? { sourceHeight: media.height } : {}),
        }
        place(item)
      } else if (media.mimeType.startsWith('audio/')) {
        const sf = sourceFieldsFor(media, projectFps)
        const item: AudioItem = {
          id: newId(),
          type: 'audio',
          trackId: resolveOrCreateTrack(op.trackId, 'audio'),
          from,
          durationInFrames:
            asNumber(op.durationInFrames) ??
            Math.max(1, Math.round((media.duration ?? 0) * projectFps)),
          label,
          mediaId,
          src: '',
          volume: 0,
          ...sf,
        }
        place(item)
      } else if (media.mimeType.startsWith('video/')) {
        const sf = sourceFieldsFor(media, projectFps)
        const durationInFrames =
          asNumber(op.durationInFrames) ??
          Math.max(1, Math.round((media.duration ?? 0) * projectFps))
        const linkedGroupId = crypto.randomUUID()
        const video: VideoItem = {
          id: newId(),
          type: 'video',
          trackId: resolveOrCreateTrack(op.trackId, 'video'),
          from,
          durationInFrames,
          label,
          mediaId,
          src: '',
          volume: 0,
          linkedGroupId,
          ...(media.width ? { sourceWidth: media.width } : {}),
          ...(media.height ? { sourceHeight: media.height } : {}),
          ...sf,
        }
        place(video)
        // Linked audio companion (as the app creates on import) so audio renders.
        // It must stay in sync with the video, so it takes the first audio track
        // free for that range (a new one if none is) instead of being shifted.
        if (media.audioCodec) {
          const audio: AudioItem = {
            id: newId(),
            type: 'audio',
            trackId: findFreeTrack('audio', from, durationInFrames)?.id ?? createTrack('audio').id,
            from,
            durationInFrames,
            label: `${label} audio`,
            mediaId,
            src: '',
            volume: 0,
            linkedGroupId,
            ...sf,
          }
          place(audio)
        }
      } else {
        throw new Error(`addClip: unsupported media mimeType ${media.mimeType}`)
      }
      return { created }
    }
    case 'addKeyframe': {
      const itemId = asString(op.itemId)
      const property = asString(op.property)
      const frame = asNumber(op.frame)
      const value = asNumber(op.value)
      if (!itemId || !property || frame === undefined || value === undefined) {
        throw new Error('addKeyframe requires `itemId`, `property`, `frame`, `value`')
      }
      requireItem(itemId, 'itemId')
      const easing = asString(op.easing) as EasingType | undefined
      // easingConfig (e.g. custom spring tension/friction/mass) goes through the
      // batch action — the scalar addKeyframe action does not accept it.
      const keyframeId = op.easingConfig
        ? (addKeyframes([
            {
              itemId,
              property: property as AnimatableProperty,
              frame,
              value,
              easing,
              easingConfig: op.easingConfig as Parameters<
                typeof addKeyframes
              >[0][number]['easingConfig'],
            },
          ])[0] ?? '')
        : addKeyframe(itemId, property as AnimatableProperty, frame, value, easing)
      if (!keyframeId) throw new Error(`addKeyframe failed (item ${itemId} @ frame ${frame})`)
      return { keyframeId }
    }
    case 'setTransformParent': {
      const id = asString(op.id)
      if (!id) throw new Error('setTransformParent requires `id`')
      const child = requireItem(id)
      const detach = op.parentItemId === null
      const parentItemId = detach ? undefined : asString(op.parentItemId)
      if (!detach && !parentItemId) {
        throw new Error(
          'setTransformParent requires `parentItemId` (item id to attach, null to detach)',
        )
      }
      if (parentItemId) requireItem(parentItemId, 'parentItemId')
      const ok = setTransformParent({
        childItemId: id,
        ...(parentItemId ? { parentItemId } : {}),
        behavior: asString(op.behavior) as Parameters<typeof setTransformParent>[0]['behavior'],
        frame: asNumber(op.frame) ?? child.from,
        canvas: editCanvas,
      })
      if (!ok) {
        throw new Error(
          `setTransformParent failed for "${id}"${parentItemId ? ` -> "${parentItemId}"` : ' (detach)'}`,
        )
      }
      return { id, parentItemId: parentItemId ?? null }
    }
    case 'removeKeyframes': {
      const itemId = asString(op.itemId)
      const property = asString(op.property)
      if (!itemId || !property) throw new Error('removeKeyframes requires `itemId` and `property`')
      requireItem(itemId, 'itemId')
      removeKeyframesForProperty(itemId, property as AnimatableProperty)
      return { itemId, property }
    }
    case 'addEffect': {
      const itemId = asString(op.itemId)
      if (!itemId) throw new Error('addEffect requires `itemId`')
      requireItem(itemId, 'itemId')
      const effect =
        op.effect && typeof op.effect === 'object'
          ? op.effect
          : op.gpuEffectType
            ? { type: 'gpu-effect', gpuEffectType: op.gpuEffectType, params: op.params ?? {} }
            : null
      if (!effect) throw new Error('addEffect requires `effect` or `gpuEffectType`')
      const gpuEffectType = (effect as { gpuEffectType?: unknown }).gpuEffectType
      if (typeof gpuEffectType !== 'string' || !getGpuEffect(gpuEffectType)) {
        throw new Error(`gpuEffectType: unknown GPU effect "${String(gpuEffectType)}"`)
      }
      validateEffectParams(gpuEffectType, (effect as { params?: unknown }).params ?? {})
      addEffect(itemId, effect as VisualEffect)
      const added = requireItem(itemId, 'itemId').effects?.at(-1)
      return { itemId, effectId: added?.id }
    }
    case 'removeEffect': {
      const itemId = asString(op.itemId)
      const effectId = asString(op.effectId)
      if (!itemId || !effectId) throw new Error('removeEffect requires `itemId` and `effectId`')
      const item = requireItem(itemId, 'itemId')
      if (!item.effects?.some((candidate) => candidate.id === effectId)) {
        throw new Error(`effectId: effect "${effectId}" does not exist on item "${itemId}"`)
      }
      removeEffect(itemId, effectId)
      return { itemId, effectId }
    }
    case 'updateEffect': {
      const itemId = asString(op.itemId)
      const effectId = asString(op.effectId)
      if (!itemId || !effectId) throw new Error('updateEffect requires `itemId` and `effectId`')
      const entry = requireItem(itemId, 'itemId').effects?.find(
        (candidate) => candidate.id === effectId,
      )
      if (!entry)
        throw new Error(`effectId: effect "${effectId}" does not exist on item "${itemId}"`)
      const updates: Partial<{ effect: VisualEffect; enabled: boolean }> = {}
      if (op.params !== undefined) {
        if (entry.effect.type !== 'gpu-effect')
          throw new Error('updateEffect: only GPU effects take params')
        validateEffectParams(entry.effect.gpuEffectType, op.params)
        updates.effect = {
          ...entry.effect,
          params: {
            ...entry.effect.params,
            ...(op.params as Record<string, number | boolean | string>),
          },
        }
      }
      if (typeof op.enabled === 'boolean') updates.enabled = op.enabled
      updateEffect(itemId, effectId, updates)
      return { itemId, effectId }
    }
    case 'addLut':
      return addLutOp(op)
    case 'setTransform': {
      const id = asString(op.id)
      if (!id || !op.transform || typeof op.transform !== 'object') {
        throw new Error('setTransform requires `id` and `transform`')
      }
      const item = requireItem(id)
      // The store only merges into an existing transform; clips created by
      // addClip have none yet, which made this a silent no-op.
      if (!('transform' in item) || !item.transform) {
        updateItem(id, { transform: {} } as Partial<TimelineItem>)
      }
      updateItemTransform(id, op.transform as Partial<TransformProperties>)
      return { id }
    }
    default: {
      const handled = runMarkerOp(op) ?? runSpeedRampOp(op) ?? runTextStyleOp(op, context)
      if (handled) return handled.result
      return applyTemplateOp(op, { overlap: context, canvas: editCanvas })
    }
  }
}

/** Apply one op, record its result (success or failure), and rethrow on failure. */
function applyOpTracked(
  rawOp: EditOp,
  prior: Map<string, HeadlessEditResult['results'][number]>,
  results: HeadlessEditResult['results'],
): void {
  const callerId = asString(rawOp.callerId)
  const op = resolveOperationRefs(rawOp, prior)
  try {
    const detail = applyOp(op)
    const result = { ...(callerId ? { callerId } : {}), op: op.op, ok: true as const, detail }
    results.push(result)
    if (callerId) prior.set(callerId, result)
  } catch (error) {
    results.push({
      ...(callerId ? { callerId } : {}),
      op: op.op,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      `Edit op "${op.op}" failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function editProject(input: HeadlessEditInput): Promise<HeadlessEditResult> {
  const { project: migrated } = migrateProject(input.project)
  editCanvas = {
    width: migrated.metadata?.width ?? 1920,
    height: migrated.metadata?.height ?? 1080,
    fps: migrated.metadata?.fps ?? 30,
  }
  await hydrateTimelineStoresFromProject(migrated)
  seedMediaLibrary(input.media)
  setTextStyleEditInput({
    canvas: editCanvas,
    projectId: migrated.id,
    library: input.textStyleLibrary,
    transcripts: input.transcripts,
  })
  editLuts = input.luts ?? []
  setTemplateEditInput(input.templates)

  log.info('Headless edit starting', { ops: input.ops.length })

  const results: HeadlessEditResult['results'] = []
  const prior = new Map<string, HeadlessEditResult['results'][number]>()
  const callerIds = input.ops.map((op) => asString(op.callerId)).filter(Boolean) as string[]
  if (new Set(callerIds).size !== callerIds.length) throw new Error('Duplicate edit callerId')
  for (const rawOp of input.ops) applyOpTracked(rawOp, prior, results)

  const timeline = buildTimelineFromStores()
  log.info('Headless edit complete', { applied: results.length })

  return {
    ok: true,
    project: { ...migrated, timeline },
    applied: results.length,
    results,
  }
}
