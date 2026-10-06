import { useCallback, useEffect, useState } from 'react'
import { listWorkspaceLuts, type WorkspaceLut } from '@/infrastructure/storage'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('WorkspaceLuts')

/**
 * The workspace LUT library (`luts/*.cube`), loaded on mount. `refresh`
 * re-reads it, e.g. after the panel saved an imported LUT or the agent added
 * one. With no workspace open the list is simply empty.
 */
export function useWorkspaceLuts(): { luts: WorkspaceLut[]; refresh: () => Promise<void> } {
  const [luts, setLuts] = useState<WorkspaceLut[]>([])

  const refresh = useCallback(async () => {
    try {
      setLuts(await listWorkspaceLuts())
    } catch (error) {
      logger.warn('Could not list the LUT library', error)
      setLuts([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { luts, refresh }
}
