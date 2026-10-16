import { useEffect, useState } from 'react'
import { getTrackedRevision } from '@/infrastructure/storage'
import { isBridgeHandle } from '@/infrastructure/storage/bridge-fs/bridge-handles'
import { requireWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { useTimelineSettingsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { isAgentEditLocked } from '@/shared/state/agent-edit-lock'
import { receiveCutPublish, siblingCutIds } from '@/shared/state/cuts'
import { AgentSyncController, type EditorStateReport } from './agent-sync-controller'
import { useProjectSyncStore } from './sync-store'
import { receiveAgentActivity } from './agent-activity-store'

const ENDPOINT = '/__shreditor/editor-state'

/** True when the workspace is served by the local bridge, so an agent shares it. */
function isAgentNative(): boolean {
  try {
    return isBridgeHandle(requireWorkspaceRoot())
  } catch {
    return false
  }
}

async function send(report: EditorStateReport): Promise<{ saveRequest?: string | null } | null> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The open cut's siblings: the reply says when the agent published into one.
    body: JSON.stringify({ ...report, cuts: siblingCutIds() }),
    cache: 'no-store',
    keepalive: Boolean(report.closed),
  })
  if (!res.ok) return null
  const reply = (await res.json()) as {
    saveRequest?: string | null
    agentActivity?: unknown
    cutPublish?: unknown
  }
  if (report.closed) return reply
  // Whether an agent is mid-pass on this project (the banner and watch mode).
  receiveAgentActivity(reply.agentActivity)
  receiveCutPublish(reply.cutPublish)
  return reply
}

// Held pointer buttons count as a gesture: clip drags, trims, gizmo moves and
// slider scrubs all commit on release, and a save mid-gesture would be stale.
let pointersDown = 0
function trackPointers(): () => void {
  const down = () => (pointersDown += 1)
  const up = () => (pointersDown = Math.max(0, pointersDown - 1))
  const reset = () => (pointersDown = 0)
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  window.addEventListener('blur', reset)
  return () => {
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', up, true)
    window.removeEventListener('blur', reset)
  }
}

function isBusy(): boolean {
  if (pointersDown > 0) return true
  if (useSelectionStore.getState().dragState?.isDragging) return true
  const sync = useProjectSyncStore.getState()
  if (sync.writing || sync.status === 'reloading') return true
  return useTimelineSettingsStore.getState().isTimelineLoading
}

export interface SaveOptions {
  quiet?: boolean
}

/**
 * In agent-native (bridge) mode: autosave ~1.5s after timeline edits settle
 * and report unsaved state to the bridge for `shred changes` / `shred sync`.
 * Returns whether it is active, so the interval autosave can stand down.
 */
export function useAgentSync(
  projectId: string,
  save: (options?: SaveOptions) => Promise<void>,
): boolean {
  const [active] = useState(isAgentNative)

  useEffect(() => {
    if (!active) return
    const controller = new AgentSyncController({
      projectId,
      tabId: crypto.randomUUID(),
      save: () => save({ quiet: true }),
      isDirty: () => useTimelineStore.getState().isDirty,
      markDirty: () => useTimelineSettingsStore.getState().markDirty(),
      isBusy,
      isPaused: isAgentEditLocked,
      status: () => useProjectSyncStore.getState().status,
      revision: () => getTrackedRevision(projectId),
      send,
    })

    // An edit is a change to timeline content while the editor is dirty.
    // Loads from disk change content too, but leave the editor clean.
    const content = () => {
      const s = useTimelineStore.getState()
      return [s.items, s.tracks, s.transitions, s.keyframes, s.markers, s.inPoint, s.outPoint]
    }
    let lastContent = content()
    let wasDirty = useTimelineStore.getState().isDirty
    const unsubscribeTimeline = useTimelineStore.subscribe(() => {
      const next = content()
      const changed = next.some((value, i) => value !== lastContent[i])
      lastContent = next
      const { isDirty } = useTimelineStore.getState()
      const becameDirty = isDirty && !wasDirty
      wasDirty = isDirty
      if (changed) {
        // Commands set content first and mark dirty right after.
        queueMicrotask(() => {
          if (useTimelineStore.getState().isDirty && !isBusyLoading()) controller.noteEdit()
        })
      } else if (becameDirty) {
        controller.noteEdit()
      } else {
        controller.noteStateChange()
      }
    })
    const unsubscribeSync = useProjectSyncStore.subscribe(() => controller.noteStateChange())
    const untrackPointers = trackPointers()
    const onPageHide = () => controller.stop()
    window.addEventListener('pagehide', onPageHide)
    controller.start()

    return () => {
      window.removeEventListener('pagehide', onPageHide)
      unsubscribeTimeline()
      unsubscribeSync()
      untrackPointers()
      controller.stop()
    }
  }, [active, projectId, save])

  return active
}

function isBusyLoading(): boolean {
  return (
    useProjectSyncStore.getState().status === 'reloading' ||
    useTimelineSettingsStore.getState().isTimelineLoading
  )
}
