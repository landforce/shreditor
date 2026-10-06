import { useEffect } from 'react'
import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { useTimelineSettingsStore } from '@/features/editor/deps/timeline-store'
import { setAgentEditLock } from '@/shared/state/agent-edit-lock'
import { useAgentActivityStore } from './agent-activity-store'
import { useProjectSyncStore } from './sync-store'

const TOAST_EVERY_MS = 2500
/** An agent pass may record its undo step just after the reload finishes. */
const RELOAD_GRACE_MS = 1500

/** The editor loading the project (an agent pass landing) is not a user edit. */
function isLoading(): boolean {
  const sync = useProjectSyncStore.getState()
  if (sync.status === 'reloading' || useTimelineSettingsStore.getState().isTimelineLoading) {
    return true
  }
  return sync.lastExternalLoadAt !== null && Date.now() - sync.lastExternalLoadAt < RELOAD_GRACE_MS
}

/**
 * Watch mode while the agent works on this project: edits are put back with
 * a toast (see `@/shared/state/agent-edit-lock`), playback and inspecting are
 * untouched. Refused edits leave nothing unsaved, so a clean editor stays
 * clean (and autosave has nothing to write).
 */
export function enterAgentWatchMode(): () => void {
  let lastToast = 0
  setAgentEditLock({
    locked: true,
    isExempt: isLoading,
    onRefused: () => {
      const now = Date.now()
      if (now - lastToast < TOAST_EVERY_MS) return
      lastToast = now
      toast.info(i18n.t('editor.agentActivity.refused'))
    },
  })
  const keepClean = !useTimelineSettingsStore.getState().isDirty
  const unsubscribe = keepClean
    ? useTimelineSettingsStore.subscribe((state) => {
        if (state.isDirty && !isLoading()) state.markClean()
      })
    : null
  return () => {
    unsubscribe?.()
    setAgentEditLock(null)
  }
}

export function useAgentWatchMode(): void {
  const working = useAgentActivityStore((s) => s.activity.state === 'working')
  useEffect(() => (working ? enterAgentWatchMode() : undefined), [working])
}
