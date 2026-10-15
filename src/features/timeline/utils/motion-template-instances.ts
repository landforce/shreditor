/**
 * Motion template instances: copying a library template into a project, placing
 * instances of it, and replacing a project's copy with a newer version.
 *
 * One project composition per template version is the live link: every instance
 * of that version points at it, so editing it in the project updates them all,
 * while each instance keeps its own control values (compositionControlOverrides).
 */
import type { CompositionItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { CompositionControlOverrides } from '@/types/composition-controls'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'
import {
  compositionClosure,
  type MotionTemplateVariantView,
  type StoredComposition,
} from '@/shared/motion-templates/template-core.mjs'
import { aspectKey } from '@/shared/projects/aspect.mjs'
import { getCompositionControlSourceValue } from '@/shared/utils/composition-controls'
import type { SubComposition } from '../stores/compositions-store'

type NewId = () => string
const defaultNewId: NewId = () => crypto.randomUUID()

interface IdMaps {
  items: Map<string, string>
  tracks: Map<string, string>
  compositions: Map<string, string>
  transitions?: Map<string, string>
}

const mapped = (map: Map<string, string>, id: string): string => map.get(id) ?? id

function remapItem(item: TimelineItem, maps: IdMaps): TimelineItem {
  const next = {
    ...item,
    id: mapped(maps.items, item.id),
    trackId: mapped(maps.tracks, item.trackId),
  } as TimelineItem
  if (item.compositionId) next.compositionId = mapped(maps.compositions, item.compositionId)
  if (item.transformParent?.parentItemId) {
    next.transformParent = {
      ...item.transformParent,
      parentItemId: mapped(maps.items, item.transformParent.parentItemId),
    }
  }
  return next
}

/** Rewrite every item, track and nested-composition id inside one composition. */
export function remapCompositionIds(
  composition: SubComposition,
  maps: IdMaps,
  compositionId = composition.id,
): SubComposition {
  const controls = composition.compositionControls
  return {
    ...composition,
    id: compositionId,
    items: composition.items.map((item) => remapItem(item, maps)),
    tracks: composition.tracks.map((track) => ({
      ...track,
      id: mapped(maps.tracks, track.id),
      ...(track.parentTrackId ? { parentTrackId: mapped(maps.tracks, track.parentTrackId) } : {}),
      items: [],
    })),
    transitions: composition.transitions.map((transition) => ({
      ...transition,
      id: maps.transitions ? mapped(maps.transitions, transition.id) : transition.id,
      leftClipId: mapped(maps.items, transition.leftClipId),
      rightClipId: mapped(maps.items, transition.rightClipId),
      trackId: mapped(maps.tracks, transition.trackId),
    })),
    keyframes: composition.keyframes.map((entry) => ({
      ...entry,
      itemId: mapped(maps.items, entry.itemId),
    })),
    ...(controls
      ? {
          compositionControls: {
            ...controls,
            controls: controls.controls.map((control) => ({
              ...control,
              targetItemId: mapped(maps.items, control.targetItemId),
            })),
          },
        }
      : {}),
  }
}

function toSubComposition(stored: StoredComposition): SubComposition {
  return {
    ...structuredClone(stored),
    items: structuredClone(stored.items) as TimelineItem[],
    tracks: structuredClone(stored.tracks) as TimelineTrack[],
    transitions: structuredClone(stored.transitions ?? []) as Transition[],
    keyframes: structuredClone(stored.keyframes ?? []) as ItemKeyframes[],
    inPoint: null,
    outPoint: null,
  }
}

export interface TemplateCompositionCopy {
  root: SubComposition
  /** Root first, then the compositions it nests. */
  compositions: SubComposition[]
}

/** A fresh copy of a template variant's compositions with new ids, the root tagged with it. */
export function cloneTemplateCompositions(
  template: MotionTemplateVariantView,
  newId: NewId = defaultNewId,
): TemplateCompositionCopy {
  const sources = [template.composition, ...template.subCompositions].map(toSubComposition)
  const maps = {
    items: new Map<string, string>(),
    tracks: new Map<string, string>(),
    compositions: new Map<string, string>(),
    transitions: new Map<string, string>(),
  }
  const fresh = (map: Map<string, string>, ids: string[]) =>
    ids.forEach((id) => map.set(id, newId()))
  for (const source of sources) {
    fresh(maps.compositions, [source.id])
    fresh(
      maps.items,
      source.items.map((item) => item.id),
    )
    fresh(
      maps.tracks,
      source.tracks.map((track) => track.id),
    )
    fresh(
      maps.transitions,
      source.transitions.map((transition) => transition.id),
    )
  }
  const compositions = sources.map((source) =>
    remapCompositionIds(source, maps, maps.compositions.get(source.id)),
  )
  const root: SubComposition = {
    ...compositions[0]!,
    templateId: template.id,
    templateVersion: template.version,
    templateAspect: template.aspect,
    ...(template.hold ? { templateHold: { ...template.hold } } : {}),
  }
  return { root, compositions: [root, ...compositions.slice(1)] }
}

/** The template variant (aspect ratio) a project copy came from. */
export function templateCompositionAspect(
  composition: Pick<SubComposition, 'templateAspect' | 'width' | 'height'>,
): string {
  return composition.templateAspect ?? aspectKey(composition.width, composition.height)
}

/**
 * The project's copy of a template (the newest version when there are several),
 * of one variant when `aspect` is given.
 */
export function findTemplateComposition(
  compositions: readonly SubComposition[],
  templateId: string,
  aspect?: string,
): SubComposition | undefined {
  return compositions
    .filter(
      (composition) =>
        composition.templateId === templateId &&
        (aspect === undefined || templateCompositionAspect(composition) === aspect),
    )
    .sort((a, b) => (b.templateVersion ?? 0) - (a.templateVersion ?? 0))[0]
}

/**
 * An instance's size on the canvas. The variant has the canvas's aspect ratio, so
 * this is the canvas itself: 1:1 when the sizes match, scaled uniformly when only
 * the resolution differs (720x1280 vs 1080x1920).
 */
export function fitTemplateToCanvas(
  template: { width: number; height: number },
  canvas: { width: number },
): { width: number; height: number } {
  const scale = canvas.width / template.width
  return { width: canvas.width, height: Math.round(template.height * scale) }
}

export type TemplateControlValues = Record<string, string | null>

/**
 * Turn control values keyed by control name into an instance's overrides (keyed
 * by control id). A value equal to the composition's own value, or null, clears
 * the override. Unknown names throw with the names the composition has.
 */
export function resolveTemplateControlOverrides(
  composition: Pick<SubComposition, 'items' | 'compositionControls'>,
  values: TemplateControlValues,
  current?: CompositionControlOverrides,
): CompositionControlOverrides | undefined {
  const controls = composition.compositionControls?.controls ?? []
  const byName = new Map(controls.map((control) => [control.name.toLowerCase(), control]))
  const unknown = Object.keys(values).filter((name) => !byName.has(name.toLowerCase()))
  if (unknown.length > 0) {
    const valid = controls.map((control) => `"${control.name}"`).join(', ')
    throw new Error(
      `Unknown control ${unknown.map((name) => `"${name}"`).join(', ')}. ${valid ? `Controls: ${valid}` : 'This template has no controls'}`,
    )
  }
  const next: CompositionControlOverrides = { ...current }
  for (const [name, value] of Object.entries(values)) {
    const control = byName.get(name.toLowerCase())!
    if (value !== null && typeof value !== 'string')
      throw new Error(`Control "${control.name}" takes a string (or null to reset)`)
    if (value === null || value === getCompositionControlSourceValue(composition.items, control))
      delete next[control.id]
    else next[control.id] = value
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function wrapperSourceFields(composition: Pick<SubComposition, 'durationInFrames' | 'fps'>) {
  return {
    sourceStart: 0,
    sourceEnd: composition.durationInFrames,
    sourceDuration: composition.durationInFrames,
    sourceFps: composition.fps,
    speed: 1,
  }
}

/**
 * Check a requested instance length against the template's: shorter is always
 * fine (the end is cut, or hold frames go first); longer needs a hold.
 */
export function resolveInstanceDuration(
  composition: Pick<SubComposition, 'durationInFrames' | 'name' | 'templateHold'>,
  requested: number | undefined,
): number {
  if (requested === undefined) return composition.durationInFrames
  if (requested > composition.durationInFrames && !composition.templateHold) {
    throw new Error(
      `durationInFrames ${requested} is longer than "${composition.name}" (${composition.durationInFrames} frames) and the template has no hold. ` +
        'Set one (shred motion save ... --hold <frame>, or Hold in Save as Template) so a longer instance animates in, holds, then animates out',
    )
  }
  return requested
}

const holdField = (composition: Pick<SubComposition, 'templateHold'>) =>
  composition.templateHold ? { templateHold: { ...composition.templateHold } } : {}

export function buildTemplateInstance(params: {
  composition: SubComposition
  label: string
  trackId: string
  from: number
  durationInFrames: number
  canvas: { width: number }
  overrides?: CompositionControlOverrides
  linkedGroupId?: string
  newId?: NewId
}): CompositionItem {
  const { composition } = params
  const size = fitTemplateToCanvas(composition, params.canvas)
  return {
    id: (params.newId ?? defaultNewId)(),
    type: 'composition',
    trackId: params.trackId,
    from: params.from,
    durationInFrames: params.durationInFrames,
    label: params.label,
    compositionId: composition.id,
    compositionWidth: composition.width,
    compositionHeight: composition.height,
    ...(params.linkedGroupId ? { linkedGroupId: params.linkedGroupId } : {}),
    transform: { x: 0, y: 0, ...size, rotation: 0, opacity: 1 },
    ...(params.overrides ? { compositionControlOverrides: params.overrides } : {}),
    ...holdField(composition),
    ...wrapperSourceFields(composition),
  }
}

export function buildTemplateAudioCompanion(params: {
  composition: SubComposition
  visual: CompositionItem
  trackId: string
  newId?: NewId
}): TimelineItem {
  return {
    id: (params.newId ?? defaultNewId)(),
    type: 'audio',
    trackId: params.trackId,
    from: params.visual.from,
    durationInFrames: params.visual.durationInFrames,
    label: params.visual.label,
    compositionId: params.composition.id,
    linkedGroupId: params.visual.linkedGroupId,
    src: '',
    ...holdField(params.composition),
    ...wrapperSourceFields(params.composition),
  }
}

const overlaps = (item: TimelineItem, from: number, end: number) =>
  item.from < end && from < item.from + item.durationInFrames

/** Tracks of a kind with nothing in [from, from + duration), top to bottom. */
export function freeTracks(params: {
  tracks: readonly TimelineTrack[]
  items: readonly TimelineItem[]
  kind: 'video' | 'audio'
  from: number
  durationInFrames: number
}): TimelineTrack[] {
  const end = params.from + params.durationInFrames
  return params.tracks
    .filter((track) => !track.isGroup && !track.locked && (track.kind ?? 'video') === params.kind)
    .filter(
      (track) =>
        !params.items.some((item) => item.trackId === track.id && overlaps(item, params.from, end)),
    )
    .sort((a, b) => a.order - b.order)
}

/**
 * A track for a new instance: a free track with the template's format role, else
 * a free track another template instance already uses. Null means "make a new
 * track on top" (overlays must not land under the footage).
 */
export function chooseTemplateTrack(params: {
  tracks: readonly TimelineTrack[]
  items: readonly TimelineItem[]
  from: number
  durationInFrames: number
  role?: string
  templateCompositionIds: ReadonlySet<string>
}): string | null {
  const free = freeTracks({ ...params, kind: 'video' })
  const byRole = params.role ? free.find((track) => track.formatRole === params.role) : undefined
  if (byRole) return byRole.id
  const usedByTemplates = new Set(
    params.items
      .filter((item) => item.compositionId && params.templateCompositionIds.has(item.compositionId))
      .map((item) => item.trackId),
  )
  return free.find((track) => usedByTemplates.has(track.id))?.id ?? null
}

export interface TemplateUpdatePlan {
  compositions: SubComposition[]
  rootItems: TimelineItem[]
  compositionId: string
  previousCompositionId: string
  fromVersion: number
  toVersion: number
  instances: number
  /** Control names instances had values for that the new version no longer has. */
  droppedControls: string[]
}

function remapOverrides(
  overrides: CompositionControlOverrides | undefined,
  oldNames: Map<string, string>,
  newIds: Map<string, string>,
  dropped: Set<string>,
): CompositionControlOverrides | undefined {
  if (!overrides) return undefined
  const next: CompositionControlOverrides = {}
  for (const [controlId, value] of Object.entries(overrides)) {
    const name = oldNames.get(controlId)
    const id = name ? newIds.get(name.toLowerCase()) : undefined
    if (id) next[id] = value
    else dropped.add(name ?? controlId)
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function collectReferencedCompositionIds(
  rootItems: readonly TimelineItem[],
  compositions: readonly SubComposition[],
): Set<string> {
  const ids = new Set<string>()
  for (const item of [...rootItems, ...compositions.flatMap((c) => c.items)])
    if (item.compositionId) ids.add(item.compositionId)
  return ids
}

/** Drop the old copy's nested compositions nothing references any more. */
function pruneUnreferenced(
  rootItems: readonly TimelineItem[],
  compositions: SubComposition[],
  candidates: ReadonlySet<string>,
): SubComposition[] {
  let kept = compositions
  for (;;) {
    const referenced = collectReferencedCompositionIds(rootItems, kept)
    const next = kept.filter((c) => !candidates.has(c.id) || referenced.has(c.id))
    if (next.length === kept.length) return kept
    kept = next
  }
}

/** An instance retargeted at a new copy: its length (kept when the copy holds) and hold. */
function retargetTiming(item: TimelineItem, root: SubComposition): Partial<TimelineItem> {
  const durationInFrames = root.templateHold
    ? item.durationInFrames
    : Math.min(item.durationInFrames, root.durationInFrames)
  return {
    durationInFrames,
    templateHold: root.templateHold ? { ...root.templateHold } : undefined,
    ...wrapperSourceFields(root),
  }
}

/**
 * Replace the project's copy of a template variant with the library version:
 * every instance (on the main timeline or nested) points at the new copy and
 * keeps the values of controls whose names still exist. Null when the copy is
 * current.
 */
export function planTemplateUpdate(params: {
  template: MotionTemplateVariantView
  compositions: readonly SubComposition[]
  rootItems: readonly TimelineItem[]
  newId?: NewId
}): TemplateUpdatePlan | null {
  const old = findTemplateComposition(
    params.compositions,
    params.template.id,
    params.template.aspect,
  )
  if (!old) throw new Error(`This project has no copy of template "${params.template.name}"`)
  if (old.templateVersion === params.template.version) return null
  const copy = cloneTemplateCompositions(params.template, params.newId)
  const oldNames = new Map(
    (old.compositionControls?.controls ?? []).map((control) => [control.id, control.name]),
  )
  const newIds = new Map(
    (copy.root.compositionControls?.controls ?? []).map((c) => [c.name.toLowerCase(), c.id]),
  )
  const dropped = new Set<string>()
  let instances = 0
  const retarget = (item: TimelineItem): TimelineItem => {
    if (item.compositionId !== old.id) return item
    const next = {
      ...item,
      compositionId: copy.root.id,
      ...retargetTiming(item, copy.root),
    } as TimelineItem
    if (!next.templateHold) delete next.templateHold
    if (next.type !== 'composition') return next
    instances += 1
    const overrides = remapOverrides(next.compositionControlOverrides, oldNames, newIds, dropped)
    return {
      ...next,
      compositionWidth: copy.root.width,
      compositionHeight: copy.root.height,
      compositionControlOverrides: overrides,
    }
  }
  const rootItems = params.rootItems.map(retarget)
  const others = params.compositions
    .filter((composition) => composition.id !== old.id)
    .map((composition) => ({ ...composition, items: composition.items.map(retarget) }))
  const oldNested = new Set(
    compositionClosure(old.id, params.compositions)
      .slice(1)
      .map((composition) => composition.id),
  )
  return {
    compositions: pruneUnreferenced(rootItems, [...others, ...copy.compositions], oldNested),
    rootItems,
    compositionId: copy.root.id,
    previousCompositionId: old.id,
    fromVersion: old.templateVersion ?? 0,
    toVersion: params.template.version,
    instances,
    droppedControls: [...dropped].sort(),
  }
}
