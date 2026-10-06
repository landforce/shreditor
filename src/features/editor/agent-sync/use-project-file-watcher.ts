import { useEffect } from 'react'
import { toast } from 'sonner'
import {
  getTrackedRevision,
  readProjectStamp,
  setTrackedRevision,
  type ProjectFileStamp,
} from '@/infrastructure/storage'
import { useTimelineSettingsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { createLogger } from '@/shared/logging/logger'
import { reloadProjectFromDisk } from './reload-from-disk'
import { useProjectSyncStore } from './sync-store'

const logger = createLogger('ProjectFileWatcher')
const POLL_MS = 1000

/**
 * Polls project.json for writes made outside this tab (the headless service
 * applying an agent pass). A clean editor reloads in place; a dirty one is
 * put into `conflict` so the user chooses.
 */
export function useProjectFileWatcher(projectId: string): void {
  useEffect(() => {
    let stamp: ProjectFileStamp | null = null
    let busy = false
    let stopped = false

    const tick = async () => {
      const sync = useProjectSyncStore.getState()
      if (
        busy ||
        sync.writing ||
        sync.status === 'reloading' ||
        useTimelineSettingsStore.getState().isTimelineLoading
      )
        return
      const tracked = getTrackedRevision(projectId)
      if (!tracked) return
      busy = true
      try {
        stamp = await readProjectStamp(projectId, stamp)
        if (stopped || !stamp || stamp.revision === getTrackedRevision(projectId)) return
        if (useTimelineStore.getState().isDirty) {
          if (sync.status !== 'conflict') {
            sync.setStatus('conflict')
            logger.info('project.json changed on disk while the editor has unsaved edits')
          }
          return
        }
        await reloadProjectFromDisk(projectId)
        toast.info('Loaded the latest changes from disk')
      } catch (error) {
        logger.warn('Project file check failed', error)
      } finally {
        busy = false
      }
    }

    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
      setTrackedRevision(projectId, null)
      useProjectSyncStore.getState().setStatus('synced')
    }
  }, [projectId])
}
