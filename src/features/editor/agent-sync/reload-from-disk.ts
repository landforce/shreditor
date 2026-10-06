import { getTrackedRevision, readAgentPassLabel } from '@/infrastructure/storage'
import {
  captureSnapshot,
  useCompositionNavigationStore,
  useTimelineCommandStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useProjectSyncStore } from './sync-store'
import { refreshProjectSettingsFromDisk } from '../components/format-panel/project-format'

/**
 * Re-read project.json into the live editor, keeping the playhead and the
 * clip selection where they were (ids that no longer exist are dropped).
 *
 * The reload is one undo step ("Undo <pass label>", or "Undo Changes from the
 * agent" for writes that weren't a published pass) on top of the existing
 * history, so the user can undo a whole agent pass and still reach their own
 * edits below it. The undone timeline is saved like any edit.
 */
export async function reloadProjectFromDisk(projectId: string): Promise<void> {
  const sync = useProjectSyncStore.getState()
  const frame = usePlaybackStore.getState().currentFrame
  const selected = useSelectionStore.getState().selectedItemIds
  const previousRevision = getTrackedRevision(projectId)
  usePlaybackStore.getState().pause()
  sync.setStatus('reloading')
  try {
    // The load returns to Main; capture Main (not an open composition) as the "before".
    useCompositionNavigationStore.getState().resetToRoot()
    const before = captureSnapshot()
    await useTimelineStore.getState().loadTimeline(projectId, { keepHistory: true })
    // An agent pass may have set or changed the format, kit or canvas too.
    await refreshProjectSettingsFromDisk(projectId)
    usePlaybackStore.getState().setCurrentFrame(frame)
    const label = await readAgentPassLabel(
      projectId,
      getTrackedRevision(projectId),
      previousRevision,
    )
    useTimelineCommandStore
      .getState()
      .recordExternalChange({ type: 'EXTERNAL_CHANGE', payload: label ? { label } : {} }, before)
    const stillThere = new Set(useTimelineStore.getState().items.map((item) => item.id))
    const keep = selected.filter((id) => stillThere.has(id))
    if (keep.length) useSelectionStore.getState().selectItems(keep)
    useProjectSyncStore.getState().markExternalLoad()
  } catch (error) {
    useProjectSyncStore.getState().setStatus('conflict')
    throw error
  }
}
