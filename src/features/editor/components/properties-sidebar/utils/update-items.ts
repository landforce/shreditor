import type { TimelineItem } from '@/types/timeline'
import { executeTimelineCommand, useTimelineStore } from '@/features/editor/deps/timeline-store'

/**
 * Apply the same update to every selected clip (a video and its own audio,
 * say) as one undo step, named by `type` ("SET_VOLUME" reads "Set Volume").
 */
export function updateItemsInOneStep(
  type: string,
  itemIds: readonly string[],
  updates: Partial<TimelineItem>,
): void {
  if (itemIds.length === 0) return
  const { updateItem } = useTimelineStore.getState()
  executeTimelineCommand(type, () => itemIds.forEach((id) => updateItem(id, updates)), {
    count: itemIds.length,
  })
}
