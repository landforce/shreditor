import type { TimelineItem } from '@/types/timeline'
import { getSynchronizedLinkedItems } from '@/features/timeline/utils/linked-items'

/** Fields that place a clip in time; linked companions keep them in step. */
const TIMING_KEYS = [
  'from',
  'durationInFrames',
  'sourceStart',
  'sourceEnd',
  'speed',
  'speedRamp',
] as const

/**
 * The linked companions (a video's own audio, or the video of an audio clip)
 * that share this item's window, with the timing part of `updates` each must
 * take to stay in sync. Moving to another track is per item, so it carries
 * nothing; companions already offset from the item are left alone.
 */
export function linkedTimingFollowers(
  items: TimelineItem[],
  item: TimelineItem,
  updates: Partial<TimelineItem>,
): Array<{ item: TimelineItem; updates: Partial<TimelineItem> }> {
  if ('trackId' in updates) return []
  const timing = Object.fromEntries(
    TIMING_KEYS.filter((key) => key in updates).map((key) => [key, updates[key]]),
  ) as Partial<TimelineItem>
  if (Object.keys(timing).length === 0) return []
  return getSynchronizedLinkedItems(items, item.id)
    .filter((companion) => companion.id !== item.id)
    .map((companion) => ({ item: companion, updates: timing }))
}
