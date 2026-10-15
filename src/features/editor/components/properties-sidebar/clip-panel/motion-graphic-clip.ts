import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'

/** The label prefix `shred motion` gives the clips it places (skills/shreditor-edit/scripts/motion.mjs). */
const MOTION_LABEL = 'Motion: '

/** A rendered HyperFrames motion graphic placed by `shred motion`. */
export const isMotionGraphicClip = (item: TimelineItem | undefined): boolean =>
  item?.type === 'video' && item.label.startsWith(MOTION_LABEL)

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The controls whose draft value differs from what the clip rendered with. */
export function changedValues(
  draft: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(draft).filter(([id, value]) => !sameValue(value, current[id])),
  )
}

/**
 * Selects a clip once the editor has reloaded it from disk (a re-render swaps
 * in a new clip id). Gives up quietly after `timeoutMs`.
 */
export async function selectWhenLoaded(itemId: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (useItemsStore.getState().itemById[itemId]) {
      useSelectionStore.getState().selectItems([itemId])
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}
