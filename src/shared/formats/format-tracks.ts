import {
  createFormatTracks,
  type FormatDefinition,
  type FormatTrackSpec,
  type ResolvedFormat,
} from '@formats/registry.mjs'
import { trackRole } from '@formats/scorecard.mjs'
import type { TimelineTrack } from '@/types/timeline'
import { DEFAULT_TRACK_HEIGHT } from '@/shared/timeline/defaults'

type LayoutFormat = FormatDefinition | ResolvedFormat

const byOrder = (a: TimelineTrack, b: TimelineTrack) => a.order - b.order

/**
 * Each of the format's layout tracks matched to an existing track that plays
 * the same role (its formatRole, or a track named like the layout entry) with
 * the same kind; null where the timeline has no such track.
 */
function matchLayout(tracks: TimelineTrack[], format: LayoutFormat): (TimelineTrack | null)[] {
  const resolved = format as ResolvedFormat
  const free = tracks.filter((track) => !track.isGroup).sort(byOrder)
  return format.tracks.map((spec) => {
    const index = free.findIndex(
      (track) =>
        trackRole(track, resolved) === spec.role && (track.kind ?? spec.kind) === spec.kind,
    )
    return index < 0 ? null : (free.splice(index, 1)[0] ?? null)
  })
}

/** The format's layout tracks the timeline doesn't have yet, top to bottom. */
export function findMissingFormatTracks(
  tracks: TimelineTrack[],
  format: LayoutFormat,
): FormatTrackSpec[] {
  const matched = matchLayout(tracks, format)
  return format.tracks.filter((_, index) => !matched[index])
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`
  taken.add(id)
  return id
}

const kindOf = (track: TimelineTrack) => track.kind ?? 'video'

/** Index in `list` to insert layout entry `index` at: next to its nearest placed neighbour. */
function neighbourIndex(
  list: TimelineTrack[],
  placed: (TimelineTrack | null)[],
  index: number,
  kind: 'video' | 'audio',
): number {
  for (let j = index - 1; j >= 0; j -= 1) {
    const before = placed[j]
    if (before) return list.indexOf(before) + 1
  }
  for (let j = index + 1; j < placed.length; j += 1) {
    const after = placed[j]
    if (after) return list.indexOf(after)
  }
  // Nothing of the layout is there: videos on top, audio at the bottom.
  return kind === 'video' ? 0 : list.length
}

/** Where to insert: by the layout, kept within its kind's section (videos above audio). */
function insertionIndex(
  list: TimelineTrack[],
  placed: (TimelineTrack | null)[],
  index: number,
  kind: 'video' | 'audio',
): number {
  const at = neighbourIndex(list, placed, index, kind)
  const firstAudio = list.findIndex((track) => kindOf(track) === 'audio')
  const afterLastVideo = list.findLastIndex((track) => kindOf(track) === 'video') + 1
  if (kind === 'video') return Math.min(at, firstAudio < 0 ? list.length : firstAudio)
  return Math.max(at, afterLastVideo)
}

/**
 * The timeline's tracks with the format's missing layout tracks added, each
 * next to its layout neighbours and tagged with its formatRole. Existing
 * tracks keep their ids, settings, items and relative order (only `order` is
 * renumbered); nothing is removed. Returns the input array when nothing is missing.
 */
export function addMissingFormatTracks(
  tracks: TimelineTrack[],
  format: LayoutFormat,
): { tracks: TimelineTrack[]; added: TimelineTrack[] } {
  const placed = matchLayout(tracks, format)
  if (placed.every(Boolean)) return { tracks, added: [] }

  const taken = new Set(tracks.map((track) => track.id))
  const height = tracks.find((track) => !track.isGroup)?.height ?? DEFAULT_TRACK_HEIGHT
  const fresh = createFormatTracks(format, { height })
  const list = [...tracks].sort(byOrder)
  const added: TimelineTrack[] = []
  placed.forEach((existing, index) => {
    if (existing) return
    const template = fresh[index]!
    const track: TimelineTrack = { ...template, id: uniqueId(template.id, taken) }
    list.splice(insertionIndex(list, placed, index, template.kind), 0, track)
    placed[index] = track
    added.push(track)
  })
  const renumbered = list.map((track, order) =>
    track.order === order ? track : { ...track, order },
  )
  return {
    tracks: renumbered,
    added: added.map((track) => renumbered.find((t) => t.id === track.id)!),
  }
}
