/**
 * Headless text style ops: applyTextStyle, upsertTextStyle and addCaptions,
 * plus the `styleId` of addText. They drive the same text style actions as
 * the editor, so styles, links, overrides and undo behave identically.
 *
 * The Node side passes what the browser cannot read itself in the edit input:
 * the library styles the ops name (copied into the project on use) and the
 * built-in transcripts of the clips addCaptions captions.
 */

import type { TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { MediaTranscriptSegment } from '@/types/storage'
import type { TextStyleDefinition, TextStyleRole } from '@/types/text-style'
import type { TransformProperties } from '@/types/transform'
import { useProjectTextStylesStore } from '@/shared/state/text-styles'
import {
  buildApplyTextStyleUpdates,
  deriveTextStyleFromItem,
  mergeTextStyleOverrides,
} from '@/shared/typography/text-styles/text-style-resolve'
import {
  findTextStyle,
  normalizeTextStyleInput,
} from '@/shared/typography/text-styles/text-style-schema'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import {
  addItems,
  applyTextStyleToItems,
  removeItems,
  saveTextStyleFromItems,
  setTracks,
  upsertProjectTextStyle,
} from '@/features/timeline/stores/timeline-actions'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import {
  buildCaptionTrackAbove,
  findGeneratedCaptionItemsForClip,
} from '@/features/media-library/utils/caption-items'
import { buildStyledCaptionItems } from '@/features/media-library/utils/styled-caption-items'
import { timelineItemProblem } from '@/features/project-bundle/schemas/project-schema'
import { assertNoTrackOverlap, type OverlapContext } from './track-overlap'

type Op = Record<string, unknown> & { op: string }

export interface TextStyleEditInput {
  canvas: { width: number; height: number }
  /** Library styles the ops may name (the Node side reads app/text-styles.json). */
  library?: TextStyleDefinition[]
  /** Built-in transcripts by media id, for addCaptions. */
  transcripts?: Array<{ mediaId: string; segments: MediaTranscriptSegment[] }>
}

let input: TextStyleEditInput = { canvas: { width: 1920, height: 1080 } }

export function setTextStyleEditInput(next: TextStyleEditInput): void {
  input = next
}

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

function projectStyles(): TextStyleDefinition[] {
  return useProjectTextStylesStore.getState().styles
}

/** A style by id or name: the project's copy first, then the library's. */
function resolveStyle(idOrName: unknown, field = 'styleId'): TextStyleDefinition {
  const wanted = str(idOrName)
  if (!wanted) throw new Error(`${field} is required`)
  const style = findTextStyle(projectStyles(), wanted) ?? findTextStyle(input.library ?? [], wanted)
  if (!style) {
    const names = [...projectStyles(), ...(input.library ?? [])].map((s) => s.name)
    throw new Error(
      `${field}: no text style "${wanted}" in the project or the library` +
        (names.length ? ` (have: ${[...new Set(names)].join(', ')})` : ' (shred styles list)'),
    )
  }
  return style
}

/** Copy a library style into the project when it is not there yet. */
function ensureInProject(style: TextStyleDefinition): void {
  if (!projectStyles().some((entry) => entry.id === style.id)) {
    upsertProjectTextStyle(style, input.canvas)
  }
}

function requireText(id: string, field: string): TextItem {
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`${field}: item "${id}" does not exist`)
  if (item.type !== 'text') throw new Error(`${field}: item "${id}" is ${item.type}, not text`)
  return item
}

function assertValidItem(item: TimelineItem, field: string): void {
  const problem = timelineItemProblem(item)
  if (problem) throw new Error(`${field}: the style makes an invalid item (${problem})`)
}

/** Fields of addText that win over the style and become overrides. */
const EXPLICIT_TEXT_FIELDS = [
  'color',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'textAlign',
  'verticalAlign',
] as const

/**
 * addText with `styleId`: the style's look, layout, motion and default length,
 * then the op's own fields on top (recorded as overrides).
 */
export function styleNewTextItem(item: TextItem, op: Op): TextItem {
  if (op.styleId === undefined) return item
  const style = resolveStyle(op.styleId)
  ensureInProject(style)
  const { width, height } = input.canvas
  const base: TransformProperties = {
    x: 0,
    y: 0,
    width: width * 0.8,
    height: height * 0.3,
    rotation: 0,
    opacity: 1,
  }
  const explicit = EXPLICIT_TEXT_FIELDS.filter((key) => op[key] !== undefined)
  const styled: TextItem = {
    ...item,
    transform: base,
    ...buildApplyTextStyleUpdates({ ...item, transform: base }, style, input.canvas),
    ...Object.fromEntries(explicit.map((key) => [key, item[key]])),
    durationInFrames:
      op.durationInFrames === undefined
        ? (style.defaultDurationFrames ?? item.durationInFrames)
        : item.durationInFrames,
    textStyleOverrides: mergeTextStyleOverrides(undefined, explicit),
  }
  assertValidItem(styled, 'styleId')
  return styled
}

function applyTextStyleOp(op: Op): unknown {
  const ids = Array.isArray(op.ids)
    ? op.ids.filter((id): id is string => typeof id === 'string')
    : []
  if (ids.length === 0) throw new Error('applyTextStyle requires non-empty `ids`')
  const style = resolveStyle(op.styleId)
  for (const id of ids) {
    const item = requireText(id, 'ids')
    assertValidItem({ ...item, ...buildApplyTextStyleUpdates(item, style, input.canvas) }, 'ids')
  }
  applyTextStyleToItems(ids, style, input.canvas)
  return { styleId: style.id, ids }
}

/** The style input `upsertTextStyle { fromItemId }` derives from an item. */
function styleInputFromItem(op: Op): Record<string, unknown> {
  const itemId = str(op.fromItemId)!
  const item = requireText(itemId, 'fromItemId')
  const role = (str(op.role) ?? 'other') as TextStyleRole
  return {
    ...(str(op.id) ? { id: op.id } : {}),
    name: op.name,
    role,
    ...(str(op.description) ? { description: op.description } : {}),
    ...deriveTextStyleFromItem(item, input.canvas),
    defaultDurationFrames: item.durationInFrames,
    ...(op.caption ? { caption: op.caption } : {}),
  }
}

function upsertTextStyleOp(op: Op): unknown {
  const fromItemId = str(op.fromItemId)
  if (!fromItemId && !op.style) throw new Error('upsertTextStyle requires `style` or `fromItemId`')
  const style = normalizeTextStyleInput(
    fromItemId ? styleInputFromItem(op) : op.style,
    projectStyles(),
  )
  const probe = {
    id: 'probe',
    type: 'text',
    trackId: 't',
    from: 0,
    durationInFrames: 1,
    label: '',
    text: '',
    color: '#fff',
  } as TextItem
  assertValidItem({ ...probe, ...buildApplyTextStyleUpdates(probe, style, input.canvas) }, 'style')
  const updatedItems = fromItemId
    ? saveTextStyleFromItems(style, [fromItemId], input.canvas)
    : upsertProjectTextStyle(style, input.canvas)
  return { styleId: style.id, version: style.version, style, updatedItems }
}

function captionTrackFor(op: Op, clip: TimelineItem): string {
  const tracks = useItemsStore.getState().tracks
  const requested = str(op.trackId)
  if (requested) {
    const track = tracks.find((candidate) => candidate.id === requested)
    if (!track || track.isGroup || (track.kind ?? 'video') !== 'video') {
      throw new Error(`trackId: "${requested}" is not a video track`)
    }
    return track.id
  }
  const formatTrack = tracks.find((track) => track.formatRole === 'captions' && !track.isGroup)
  if (formatTrack) return formatTrack.id
  const clipOrder = tracks.find((track) => track.id === clip.trackId)?.order ?? 0
  const created: TimelineTrack = {
    ...buildCaptionTrackAbove(tracks, clipOrder),
    formatRole: 'captions',
  }
  setTracks([...tracks, created])
  return created.id
}

type CaptionClip = Extract<TimelineItem, { type: 'video' | 'audio' }>

function requireCaptionClip(clipId: string | undefined): CaptionClip {
  if (!clipId) throw new Error('addCaptions requires `clipId`')
  const clip = useItemsStore.getState().itemById[clipId]
  if (!clip) throw new Error(`clipId: item "${clipId}" does not exist`)
  if ((clip.type !== 'video' && clip.type !== 'audio') || !clip.mediaId) {
    throw new Error(
      `clipId: item "${clipId}" is ${clip.type}; captions come from a video or audio clip`,
    )
  }
  return clip
}

function transcriptOf(mediaId: string): MediaTranscriptSegment[] {
  const transcript = input.transcripts?.find((entry) => entry.mediaId === mediaId)
  if (!transcript) {
    throw new Error(
      `addCaptions: media "${mediaId}" has no transcript yet (shred transcribe ${mediaId}, then retry)`,
    )
  }
  return transcript.segments
}

/** `replace: true`: remove the captions made from this clip's transcript before. */
function removePreviousCaptions(clipId: string): void {
  const previous = findGeneratedCaptionItemsForClip(
    useItemsStore.getState().items,
    clipId,
    'transcript',
  )
  if (previous.length > 0) removeItems(previous.map((item) => item.id))
}

function addCaptionsOp(op: Op, context: OverlapContext): unknown {
  const clip = requireCaptionClip(str(op.clipId))
  const segments = transcriptOf(clip.mediaId!)
  const style = resolveStyle(op.styleId)
  ensureInProject(style)
  if (op.replace === true) removePreviousCaptions(clip.id)
  const trackId = captionTrackFor(op, clip)
  const items = buildStyledCaptionItems({
    clip,
    segments,
    style,
    trackId,
    timelineFps: useTimelineSettingsStore.getState().fps || 30,
    canvas: input.canvas,
  })
  if (items.length === 0) {
    throw new Error(
      `addCaptions: no speech in the transcript of "${clip.mediaId}" within clip "${clip.id}"'s source range`,
    )
  }
  for (const item of items) {
    assertValidItem(item, 'styleId')
    assertNoTrackOverlap(context, { ...item, name: `caption "${item.text.slice(0, 30)}"` })
  }
  addItems(items)
  return { styleId: style.id, trackId, created: items.map((item) => item.id) }
}

const TEXT_STYLE_OPS: Record<string, (op: Op, context: OverlapContext) => unknown> = {
  applyTextStyle: applyTextStyleOp,
  upsertTextStyle: upsertTextStyleOp,
  addCaptions: addCaptionsOp,
}

/** Run a text style op, or return `undefined` when `op` is not one. */
export function runTextStyleOp(op: Op, context: OverlapContext): { result: unknown } | undefined {
  const handler = TEXT_STYLE_OPS[op.op]
  return handler ? { result: handler(op, context) } : undefined
}
