/**
 * The `replaceMedia` edit op: put other media in a clip and keep everything
 * else. The item keeps its id, track, start, length, speed, transform,
 * effects and keyframes; its source window is fitted to the new media (from
 * `sourceStart`, default 0, for the clip's length at its speed), and a video's
 * own audio follows it. Too short a media fails the op instead of shortening
 * the clip. `shred template fill` uses it to drop new footage into a
 * project-derived template's slots.
 */
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { removeItems, unlinkItems, updateItem } from '@/features/timeline/stores/timeline-actions'
import { getSynchronizedLinkedItems } from '@/features/timeline/utils/linked-items'

type Op = Record<string, unknown>

/** Fields that came from the old media and mean nothing for the new one. */
const STALE_FIELDS = [
  'src',
  'audioSrc',
  'thumbnailUrl',
  'waveformData',
  'offset',
  'trimStart',
  'trimEnd',
  'crop',
  'reverseConformSrc',
  'reverseConformPath',
  'reverseConformKey',
  'reverseConformPreviewSrc',
  'reverseConformPreviewPath',
  'reverseConformPreviewKey',
  'reverseConformPreviewUsesProxy',
  'reverseConformPreviewIsSourceLevel',
  'reverseConformPreviewSourceDuration',
  'reverseConformPreviewFps',
  'reverseConformStatus',
  'reverseConformLocalStart',
] as const

const kindOf = (mimeType: string): 'video' | 'image' | 'audio' | null => {
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('audio/')) return 'audio'
  return null
}

const cleared = (): Record<string, undefined> =>
  Object.fromEntries(STALE_FIELDS.map((key) => [key, undefined]))

function requireMedia(mediaId: unknown): MediaMetadata {
  if (typeof mediaId !== 'string' || !mediaId) throw new Error('replaceMedia requires `mediaId`')
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) throw new Error(`replaceMedia: no metadata for media ${mediaId}`)
  return media
}

function requireClip(id: unknown): TimelineItem {
  if (typeof id !== 'string' || !id) throw new Error('replaceMedia requires `id`')
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`id: item "${id}" does not exist`)
  if (item.type !== 'video' && item.type !== 'image' && item.type !== 'audio')
    throw new Error(`replaceMedia: item "${id}" is ${item.type}, not a video, image or audio clip`)
  if (item.isReversed)
    throw new Error(`replaceMedia: item "${id}" plays reversed; un-reverse it first`)
  return item
}

const seconds = (frames: number, fps: number) => (frames / fps).toFixed(2)

function startFrame(start: unknown): number {
  if (start === undefined) return 0
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0)
    throw new Error('replaceMedia: `sourceStart` is a whole frame at the media fps, 0 or more')
  return start
}

const sourceFpsOf = (media: MediaMetadata, projectFps: number) =>
  media.fps && media.fps > 0 ? media.fps : projectFps

/** The new source window for the clip's length at its speed, or a clear error. */
function sourceWindow(
  item: TimelineItem,
  media: MediaMetadata,
  start: unknown,
  projectFps: number,
) {
  const sourceFps = sourceFpsOf(media, projectFps)
  const sourceDuration = Math.max(1, Math.round((media.duration ?? 0) * sourceFps))
  const sourceStart = startFrame(start)
  const speed = item.speed ?? 1
  const need = Math.max(1, Math.round((item.durationInFrames / projectFps) * speed * sourceFps))
  if (sourceStart + need > sourceDuration + 1)
    throw new Error(
      `replaceMedia: ${media.fileName} is ${seconds(sourceDuration, sourceFps)} s; the clip needs ${seconds(need, sourceFps)} s from ${seconds(sourceStart, sourceFps)} s (${item.durationInFrames} frames at speed ${speed}). Pick a longer media or an earlier sourceStart`,
    )
  const sourceEnd = Math.min(sourceDuration, sourceStart + need)
  return { sourceFps, sourceDuration, sourceStart, sourceEnd }
}

const sizeOf = (media: MediaMetadata) => ({
  ...(media.width ? { sourceWidth: media.width } : {}),
  ...(media.height ? { sourceHeight: media.height } : {}),
})

/** A video's own audio: its linked companions that played the same media. */
const ownAudio = (item: TimelineItem) =>
  getSynchronizedLinkedItems(useItemsStore.getState().items, item.id).filter(
    (other) => other.id !== item.id && other.type === 'audio' && other.mediaId === item.mediaId,
  )

function sameKind(item: TimelineItem, media: MediaMetadata) {
  const kind = kindOf(media.mimeType)
  if (kind !== item.type)
    throw new Error(
      `replaceMedia: item "${item.id}" is a ${item.type} clip and ${media.fileName} is ${kind ?? media.mimeType}; replace with the same kind (or removeItems + addClip)`,
    )
  return kind
}

type Window = ReturnType<typeof sourceWindow>

/** The video's own audio follows the new media, or goes when the new media has none. */
function followAudio(
  companions: TimelineItem[],
  media: MediaMetadata,
  window: Window,
  label: string,
) {
  const ids = companions.map((companion) => companion.id)
  if (!media.audioCodec) {
    unlinkItems(ids)
    removeItems(ids)
    return { removedAudio: ids }
  }
  for (const id of ids)
    updateItem(id, {
      ...cleared(),
      ...window,
      mediaId: media.id,
      label: `${label} audio`,
    } as Partial<TimelineItem>)
  return { linked: ids }
}

function replaceMedia(op: Op, projectFps: number) {
  const item = requireClip(op.id)
  const media = requireMedia(op.mediaId)
  const kind = sameKind(item, media)
  const label = typeof op.label === 'string' && op.label ? op.label : media.fileName
  const base = { ...cleared(), mediaId: media.id, label } as Partial<TimelineItem>
  const result = { id: item.id, mediaId: media.id }
  if (kind === 'image') {
    updateItem(item.id, { ...base, ...sizeOf(media) } as Partial<TimelineItem>)
    return result
  }
  const window = sourceWindow(item, media, op.sourceStart, projectFps)
  const companions = kind === 'video' ? ownAudio(item) : []
  const size = kind === 'video' ? sizeOf(media) : {}
  updateItem(item.id, { ...base, ...window, ...size } as Partial<TimelineItem>)
  if (!companions.length) return { ...result, ...window }
  return { ...result, ...window, ...followAudio(companions, media, window, label) }
}

/** The replaceMedia op; null when `op` is another op. */
export function runReplaceMediaOp(op: Op, projectFps: number): { result: unknown } | null {
  return op.op === 'replaceMedia' ? { result: replaceMedia(op, projectFps) } : null
}
