/**
 * What to analyse for a set of clips: per media, subject and sample rate, the
 * padded sample ranges the cut-out clips play. Pure; shared by the editor's
 * background scheduler, export and the headless harness.
 */
import type { CutoutSubject } from '@/types/cutout'
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
import type { CutoutMediaInfo } from './cutout-masks'

export interface CutoutNeed {
  mediaId: string
  subject: CutoutSubject
  rate: number
  info: CutoutMediaInfo
  need: IndexRange[]
  itemIds: string[]
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
    if (!item.mediaId || !item.cutout) continue
    const info = mediaInfo(item.mediaId)
    if (!info) continue
    const rate = resolveCutoutRate(item.cutout.sampleRate, info.fps)
    const range = itemSourceRange(item, projectFps)
    if (!range) continue
    const max = maxSampleIndex(info.duration, rate)
    const ranges: IndexRange[] = []
    if (frames) {
      for (const frame of frames) {
        if (frame < item.from || frame >= item.from + item.durationInFrames) continue
        const local = (frame - item.from) / projectFps
        const span = range.end - range.start
        const clipSeconds = item.durationInFrames / projectFps
        const at = item.isReversed
          ? range.end - (local / clipSeconds) * span
          : range.start + (local / clipSeconds) * span
        const window = sampleRangeFor({ start: at, end: at }, rate, max)
        if (window) ranges.push(window)
      }
    } else {
      const whole = sampleRangeFor(range, rate, max)
      if (whole) ranges.push(whole)
    }
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
