import { useEffect } from 'react'
import { useLibraryTextStylesStore } from '@/shared/state/text-styles'

const POLL_MS = 1500

/**
 * Keeps the text style library (`app/text-styles.json`) current while the
 * editor is open: the agent writes it too (`shred styles`), so the editor
 * re-reads it when its stamp changes instead of holding a stale copy.
 */
export function useTextStyleLibraryWatcher(): void {
  useEffect(() => {
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        await useLibraryTextStylesStore.getState().refresh()
      } finally {
        busy = false
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [])
}
