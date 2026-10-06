import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useProjectSyncStore } from './sync-store'

/**
 * Re-read project.json into the live editor, keeping the playhead and the
 * clip selection where they were (ids that no longer exist are dropped).
 */
export async function reloadProjectFromDisk(projectId: string): Promise<void> {
  const sync = useProjectSyncStore.getState()
  const frame = usePlaybackStore.getState().currentFrame
  const selected = useSelectionStore.getState().selectedItemIds
  usePlaybackStore.getState().pause()
  sync.setStatus('reloading')
  try {
    await useTimelineStore.getState().loadTimeline(projectId)
    usePlaybackStore.getState().setCurrentFrame(frame)
    const stillThere = new Set(useTimelineStore.getState().items.map((item) => item.id))
    const keep = selected.filter((id) => stillThere.has(id))
    if (keep.length) useSelectionStore.getState().selectItems(keep)
    useProjectSyncStore.getState().markExternalLoad()
  } catch (error) {
    useProjectSyncStore.getState().setStatus('conflict')
    throw error
  }
}
