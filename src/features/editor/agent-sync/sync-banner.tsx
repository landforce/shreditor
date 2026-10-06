import { memo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { reloadProjectFromDisk } from './reload-from-disk'
import { useProjectSyncStore } from './sync-store'

/**
 * Shown when project.json changed on disk while this editor had unsaved
 * edits. The user keeps one side; there is no automatic merge.
 */
export const ProjectSyncBanner = memo(function ProjectSyncBanner({
  projectId,
}: {
  projectId: string
}) {
  const status = useProjectSyncStore((s) => s.status)
  const [busy, setBusy] = useState(false)
  if (status !== 'conflict') return null

  const loadTheirs = async () => {
    setBusy(true)
    try {
      await reloadProjectFromDisk(projectId)
      toast.info('Loaded the version on disk. Your unsaved edits were dropped.')
    } catch {
      toast.error('Could not load the project from disk')
    } finally {
      setBusy(false)
    }
  }

  const keepMine = async () => {
    setBusy(true)
    const sync = useProjectSyncStore.getState()
    sync.setWriting(true)
    try {
      await useTimelineStore.getState().saveTimeline(projectId, { force: true })
      sync.setStatus('synced')
      toast.success('Saved your version over the one on disk')
    } catch {
      toast.error('Save failed')
    } finally {
      sync.setWriting(false)
      setBusy(false)
    }
  }

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
    >
      <span className="flex-1">
        This project changed on disk, probably from an agent pass, while you had unsaved edits.
      </span>
      <Button size="sm" variant="outline" disabled={busy} onClick={loadTheirs}>
        Load the new version
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={keepMine}>
        Keep mine
      </Button>
    </div>
  )
})
