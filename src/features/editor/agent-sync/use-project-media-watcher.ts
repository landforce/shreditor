import { useEffect } from 'react'
import { readProjectMediaVersion } from '@/infrastructure/storage/bridge-fs/bridge-media'
import { createLogger } from '@/shared/logging/logger'
import { useMediaLibraryStore } from '../deps/media-library'

const logger = createLogger('ProjectMediaWatcher')
const POLL_MS = 1000

/** Wait out this tab's own loads and imports; the stamp catches up after. */
function canCheck(projectId: string): boolean {
  const store = useMediaLibraryStore.getState()
  return store.currentProjectId === projectId && !store.isLoading && store.importingIds.length === 0
}

/**
 * Polls the bridge's media change stamp for this project (media-links.json
 * plus each linked metadata.json) so media the agent imports or
 * recategorizes shows in the library without a reload. A no-op when the
 * workspace isn't served by the bridge.
 */
export function useProjectMediaWatcher(projectId: string): void {
  useEffect(() => {
    let seen: string | null = null
    let busy = false
    let stopped = false

    const tick = async () => {
      if (busy || !canCheck(projectId)) return
      busy = true
      try {
        const version = await readProjectMediaVersion(projectId)
        if (stopped || version === null) return
        if (seen !== null && version !== seen) {
          await useMediaLibraryStore.getState().refreshMediaItems()
        }
        seen = version
      } catch (error) {
        logger.warn('Project media check failed', error)
      } finally {
        busy = false
      }
    }

    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [projectId])
}
