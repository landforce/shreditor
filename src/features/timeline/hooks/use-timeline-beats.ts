import { useEffect, useMemo } from 'react'
import { useBeatsStore, type BeatAnalysis, type BeatEntry } from '@/shared/state/beats'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { importMediaLibraryService } from '@/features/timeline/deps/media-library-service'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import type { AudioItem, TimelineItem, TimelineTrack } from '@/types/timeline'

export type TimelineBeatsStatus = 'none' | 'pending' | 'failed' | 'ready'

export interface TimelineBeats {
  status: TimelineBeatsStatus
  bpm: number | null
  /** Beat positions on the timeline, in (fractional) frames, ascending. */
  beatFrames: number[]
  /** The stronger beats (bar starts), when the detector found them. */
  downbeatFrames: number[]
  /** The audio item the beats come from. */
  itemId: string | null
}

export const NO_TIMELINE_BEATS: TimelineBeats = {
  status: 'none',
  bpm: null,
  beatFrames: [],
  downbeatFrames: [],
  itemId: null,
}

const isMusicTrack = (track: TimelineTrack | undefined): boolean =>
  track?.formatRole === 'music' || track?.name.trim().toLowerCase() === 'music'

type AnalysableAudio = AudioItem & { mediaId: string }

const isAnalysableAudio = (item: TimelineItem): item is AnalysableAudio =>
  item.type === 'audio' && !!item.mediaId

const longest = (candidates: AnalysableAudio[]): AnalysableAudio | null =>
  candidates.reduce<AnalysableAudio | null>(
    (best, item) => (!best || item.durationInFrames > best.durationInFrames ? item : best),
    null,
  )

/**
 * The audio item whose beat the timeline follows: the longest clip on a music
 * lane (format role or a track named "Music"), else the longest audio clip.
 */
export function pickMusicItem(
  items: readonly TimelineItem[],
  tracks: readonly TimelineTrack[],
): AnalysableAudio | null {
  const trackById = new Map(tracks.map((track) => [track.id, track]))
  const audio = items.filter(isAnalysableAudio)
  const music = audio.filter(
    (item) => item.formatRole === 'music' || isMusicTrack(trackById.get(item.trackId)),
  )
  return longest(music) ?? longest(audio)
}

/**
 * Source seconds of the clip's first frame, read the way the shot and music
 * cards read it: the original source start, else the trim.
 */
function clipSourceStartSeconds(item: TimelineItem, fps: number): number {
  const sourceFps = item.sourceFps || fps
  const frames = item.sourceStart ?? item.trimStart ?? (item as AudioItem).offset ?? 0
  return Math.max(0, frames) / sourceFps
}

/** Map source-time beats (seconds) onto the timeline, honoring trim, speed and reverse. */
export function mapSourceTimesToTimelineFrames(
  times: readonly number[],
  item: TimelineItem,
  fps: number,
): number[] {
  const speed = item.speed && item.speed > 0 ? item.speed : 1
  const sourceIn = clipSourceStartSeconds(item, fps)
  const sourceSpan = (item.durationInFrames / fps) * speed
  const sourceOut = sourceIn + sourceSpan
  const frames: number[] = []
  for (const time of times) {
    if (time < sourceIn || time > sourceOut) continue
    const offsetSeconds = item.isReversed ? sourceOut - time : time - sourceIn
    frames.push(item.from + (offsetSeconds * fps) / speed)
  }
  return item.isReversed ? frames.reverse() : frames
}

export function computeTimelineBeats(
  items: readonly TimelineItem[],
  tracks: readonly TimelineTrack[],
  byMediaId: Record<string, BeatEntry>,
  fps: number,
): TimelineBeats {
  const item = pickMusicItem(items, tracks)
  if (!item) return NO_TIMELINE_BEATS
  const entry = byMediaId[item.mediaId]
  if (entry === undefined || entry === 'pending') {
    return { ...NO_TIMELINE_BEATS, status: 'pending', itemId: item.id }
  }
  if (entry === 'failed') return { ...NO_TIMELINE_BEATS, status: 'failed', itemId: item.id }
  const analysis: BeatAnalysis = entry
  if (analysis.beats.length === 0) {
    return { ...NO_TIMELINE_BEATS, status: 'failed', itemId: item.id }
  }
  return {
    status: 'ready',
    bpm: analysis.bpm,
    beatFrames: mapSourceTimesToTimelineFrames(analysis.beats, item, fps),
    downbeatFrames: mapSourceTimesToTimelineFrames(analysis.downbeats ?? [], item, fps),
    itemId: item.id,
  }
}

/** True when the beat grid is on screen (the "Show beat grid" setting, on by default). */
export function isBeatGridVisible(): boolean {
  return useSettingsStore.getState().showBeatGrid
}

/**
 * Beat positions for snapping, read once from the stores (no subscription).
 * Empty when the grid is hidden, or when the music clip itself is being moved.
 */
export function getSnapBeatFrames(
  excludeItemIds: readonly string[],
  items: readonly TimelineItem[],
  tracks: readonly TimelineTrack[],
): number[] {
  if (!isBeatGridVisible()) return []
  const { fps } = useTimelineSettingsStore.getState()
  const beats = computeTimelineBeats(items, tracks, useBeatsStore.getState().byMediaId, fps)
  if (beats.itemId && excludeItemIds.includes(beats.itemId)) return []
  return beats.beatFrames
}

/**
 * The music's beat on the timeline. Asks for the analysis the first time it is
 * needed; the result is shared through the beats store.
 */
export function useTimelineBeats(options: { enabled?: boolean } = {}): TimelineBeats {
  const enabled = options.enabled ?? true
  const items = useItemsStore((s) => s.items)
  const tracks = useItemsStore((s) => s.tracks)
  const fps = useTimelineSettingsStore((s) => s.fps)
  const byMediaId = useBeatsStore((s) => s.byMediaId)

  const music = useMemo(
    () => (enabled ? pickMusicItem(items, tracks) : null),
    [enabled, items, tracks],
  )
  const mediaId = music?.mediaId
  const src = music?.src
  // Workspace projects store items without a src: the media file is resolved
  // from the media library by id, as playback does.
  useEffect(() => {
    if (!mediaId) return
    if (src) {
      useBeatsStore.getState().request(mediaId, src)
      return
    }
    if (useBeatsStore.getState().byMediaId[mediaId]) return
    let cancelled = false
    void importMediaLibraryService()
      .then(({ mediaLibraryService }) => mediaLibraryService.getMediaFile(mediaId))
      .then((file) => {
        if (!cancelled && file) useBeatsStore.getState().request(mediaId, file)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [mediaId, src])

  return useMemo(
    () => (enabled ? computeTimelineBeats(items, tracks, byMediaId, fps) : NO_TIMELINE_BEATS),
    [enabled, items, tracks, byMediaId, fps],
  )
}
