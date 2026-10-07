/**
 * Keyboard edits anchored on the playhead or the selection: ripple trim to the
 * playhead (Q / W) and duplicate in place (Cmd/Ctrl+D). Each is one undo step
 * and runs through `execute`, so agent watch mode refuses them like any edit.
 */

import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../../items-store'
import { useSelectionStore } from '@/shared/state/selection'
import { execute } from '../shared'
import { duplicateItems, rippleDeleteItems } from '../item-actions'
import type { SplitResultEntry } from '../split-bookkeeping'
import { splitItemsAtFrameDetailed } from './split-actions'

/** Which side of the playhead a ripple trim removes. */
export type PlayheadTrimSide = 'before' | 'after'

/**
 * Captions generated from a clip point at it by id. A split leaves them all on
 * the left part, so move the ones that start at or after the cut onto the right
 * part: they then stay or go with the footage they caption.
 */
function reattachCaptionsAfterSplit(splitGroups: SplitResultEntry[][], splitFrame: number): void {
  const store = useItemsStore.getState()
  const rightIdByLeftId = new Map(
    splitGroups.flat().map((entry) => [entry.result.leftItem.id, entry.result.rightItem.id]),
  )

  for (const item of store.items) {
    if (item.type !== 'text' || !item.captionSource || item.from < splitFrame) continue
    const rightId = rightIdByLeftId.get(item.captionSource.clipId)
    if (!rightId) continue
    store._updateItem(item.id, {
      captionSource: { ...item.captionSource, clipId: rightId },
    } as Partial<TimelineItem>)
  }
}

/**
 * Ripple trim the given clips to a frame: `before` removes the part ahead of the
 * frame (Q), `after` the part behind it (W). The gap closes on each clip's track,
 * linked partners follow, and sync-locked tracks lose the same span. Clips the
 * frame does not fall strictly inside are left alone.
 *
 * Returns the ids of the parts that remain, or an empty list when nothing changed.
 */
export function rippleTrimItemsToFrame(
  itemIds: string[],
  frame: number,
  side: PlayheadTrimSide,
): string[] {
  if (itemIds.length === 0) return []

  const keptIds = execute(
    side === 'before' ? 'RIPPLE_TRIM_START_TO_PLAYHEAD' : 'RIPPLE_TRIM_END_TO_PLAYHEAD',
    () => {
      const splitGroups = splitItemsAtFrameDetailed(frame, itemIds)
      if (splitGroups.length === 0) return []

      reattachCaptionsAfterSplit(splitGroups, frame)

      const splits = splitGroups.flat()
      const removedIds = splits.map((entry) =>
        side === 'before' ? entry.result.leftItem.id : entry.result.rightItem.id,
      )
      const survivingIds = splits.map((entry) =>
        side === 'before' ? entry.result.rightItem.id : entry.result.leftItem.id,
      )

      rippleDeleteItems(removedIds)
      return survivingIds
    },
    { ids: itemIds, frame, side },
  )
  return selectExistingItems(keptIds)
}

/**
 * Select the ids that exist after an edit. A refused edit (agent watch mode)
 * restores the project, so ids it created are gone and nothing is selected.
 */
function selectExistingItems(ids: string[]): string[] {
  const itemById = useItemsStore.getState().itemById
  const existing = ids.filter((id) => itemById[id] !== undefined)
  if (existing.length > 0) useSelectionStore.getState().selectItems(existing)
  return existing
}

interface Span {
  trackId: string
  from: number
  end: number
}

function overlapsAny(spans: readonly Span[], occupied: readonly Span[]): Span | null {
  for (const span of spans) {
    const hit = occupied.find(
      (other) => other.trackId === span.trackId && span.from < other.end && span.end > other.from,
    )
    if (hit) return hit
  }
  return null
}

/**
 * How far to move copies of `sources` so they land right after the originals
 * without covering anything: start at the selection's length and slide later
 * past any clip in the way, keeping the copies' layout intact.
 */
function getDuplicateOffset(sources: TimelineItem[], others: TimelineItem[]): number {
  const start = Math.min(...sources.map((item) => item.from))
  const end = Math.max(...sources.map((item) => item.from + item.durationInFrames))
  const occupied: Span[] = [...sources, ...others].map((item) => ({
    trackId: item.trackId,
    from: item.from,
    end: item.from + item.durationInFrames,
  }))

  let offset = end - start
  // Each pass clears at least one blocking clip, so this ends within occupied.length passes.
  for (let pass = 0; pass <= occupied.length; pass += 1) {
    const placed = sources.map((item) => ({
      trackId: item.trackId,
      from: item.from + offset,
      end: item.from + item.durationInFrames + offset,
    }))
    const blocker = overlapsAny(placed, occupied)
    if (!blocker) return offset

    const blocked = placed.find(
      (span) =>
        span.trackId === blocker.trackId && span.from < blocker.end && span.end > blocker.from,
    )!
    offset += blocker.end - blocked.from
  }
  return offset
}

/**
 * Duplicate clips on their own tracks, placed right after the selection (or the
 * next free span on those tracks). Selects and returns the copies.
 */
export function duplicateItemsAfterSelf(itemIds: string[]): string[] {
  const items = useItemsStore.getState().items
  const wanted = new Set(itemIds)
  const sources = items.filter((item) => wanted.has(item.id))
  if (sources.length === 0) return []

  const others = items.filter((item) => !wanted.has(item.id))
  const offset = getDuplicateOffset(sources, others)
  const copies = duplicateItems(
    sources.map((item) => item.id),
    sources.map((item) => ({ from: item.from + offset, trackId: item.trackId })),
  )

  return selectExistingItems(copies.map((item) => item.id))
}
