/**
 * What to analyse for a set of clips: per media, subject and sample rate, the
 * padded sample ranges the cut-out clips play. Pure; shared by the editor's
 * background scheduler, export and the headless harness.
 */
import type { CutoutStroke, CutoutSubject } from '@/types/cutout'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import {
  isCutoutActive,
  itemSourceRange,
  maxSampleIndex,
  mergeIndexRanges,
  resolveCutoutRate,
  sampleRangeFor,
  type IndexRange,
} from '@/shared/cutout/cutout-core.mjs'
import {
  cutoutStrokeHash,
  isSmartStroke,
  regionTrackRange,
} from '@/shared/cutout/cutout-strokes.mjs'
import type { CutoutMediaInfo } from './cutout-masks'

export interface CutoutNeed {
  mediaId: string
  subject: CutoutSubject
  rate: number
  info: CutoutMediaInfo
  need: IndexRange[]
  itemIds: string[]
}

/** The padded sample ranges one clip needs: all of it, or around `frames` only. */
function clipSampleRanges(
  item: VideoItem,
  projectFps: number,
  rate: number,
  info: CutoutMediaInfo,
  frames?: readonly number[],
): IndexRange[] {
  const range = itemSourceRange(item, projectFps)
  if (!range) return []
  const max = maxSampleIndex(info.duration, rate)
  if (!frames) {
    const whole = sampleRangeFor(range, rate, max)
    return whole ? [whole] : []
  }
  const clipSeconds = item.durationInFrames / projectFps
  const span = range.end - range.start
  const out: IndexRange[] = []
  for (const frame of frames) {
    if (frame < item.from || frame >= item.from + item.durationInFrames) continue
    const share = (frame - item.from) / projectFps / clipSeconds
    const at = item.isReversed ? range.end - share * span : range.start + share * span
    const window = sampleRangeFor({ start: at, end: at }, rate, max)
    if (window) out.push(window)
  }
  return out
}

/**
 * Group the cut-out video items by what they need analysed. `frames`, when
 * given, limits each item to the samples around those timeline frames (a frame
 * render needs only its neighbours, not the whole clip).
 */
export function planCutoutNeeds(
  items: readonly TimelineItem[],
  projectFps: number,
  mediaInfo: (mediaId: string) => CutoutMediaInfo | null,
  frames?: readonly number[],
): CutoutNeed[] {
  const groups = new Map<string, CutoutNeed>()
  for (const raw of items) {
    if (!isCutoutActive(raw)) continue
    const item = raw as VideoItem
    const info = item.mediaId ? mediaInfo(item.mediaId) : null
    if (!info || !item.mediaId || !item.cutout) continue
    const rate = resolveCutoutRate(item.cutout.sampleRate, info.fps)
    const ranges = clipSampleRanges(item, projectFps, rate, info, frames)
    if (ranges.length === 0) continue
    const key = `${item.mediaId}|${item.cutout.subject}|${rate}`
    const group = groups.get(key) ?? {
      mediaId: item.mediaId,
      subject: item.cutout.subject,
      rate,
      info,
      need: [],
      itemIds: [],
    }
    group.need = mergeIndexRanges([...group.need, ...ranges])
    group.itemIds.push(item.id)
    groups.set(key, group)
  }
  return [...groups.values()]
}

export interface CutoutRegionNeed {
  mediaId: string
  info: CutoutMediaInfo
  rate: number
  stroke: CutoutStroke
  hash: string
  /** Painted on sample `start`; tracked over [first, last]. */
  range: { start: number; first: number; last: number }
}

/** The smart strokes of one cut-out clip, each with the samples to track it over. */
function clipRegionNeeds(item: VideoItem, projectFps: number, info: CutoutMediaInfo) {
  const rate = resolveCutoutRate(item.cutout!.sampleRate, info.fps)
  const [whole] = clipSampleRanges(item, projectFps, rate, info)
  const max = maxSampleIndex(info.duration, rate)
  return (item.cutout!.strokes ?? []).filter(isSmartStroke).map((stroke) => ({
    mediaId: item.mediaId!,
    info,
    rate,
    stroke,
    hash: cutoutStrokeHash(stroke),
    range: regionTrackRange(stroke, rate, whole, max),
  }))
}

/**
 * The smart strokes the cut-out clips carry, one per media, rate and stroke,
 * tracked over every sample the clips that carry it play (plus its own frame).
 */
export function planCutoutRegions(
  items: readonly TimelineItem[],
  projectFps: number,
  mediaInfo: (mediaId: string) => CutoutMediaInfo | null,
): CutoutRegionNeed[] {
  const byKey = new Map<string, CutoutRegionNeed>()
  for (const raw of items) {
    if (!isCutoutActive(raw)) continue
    const item = raw as VideoItem
    const info = item.mediaId ? mediaInfo(item.mediaId) : null
    if (!info) continue
    for (const need of clipRegionNeeds(item, projectFps, info)) {
      const key = `${need.mediaId}|${need.hash}|${need.rate}`
      const prior = byKey.get(key)
      if (prior) {
        prior.range.first = Math.min(prior.range.first, need.range.first)
        prior.range.last = Math.max(prior.range.last, need.range.last)
      } else byKey.set(key, need)
    }
  }
  return [...byKey.values()]
}
