import { useCallback, useRef } from 'react'

let sessions = 0

/**
 * One undo step per visit to a field: while it has focus, every change it
 * commits carries the same `coalesce` key, and the timeline history folds them
 * into one entry. Leaving the field ends the session.
 */
export function useEditSession() {
  const key = useRef<string | null>(null)
  const current = useCallback(() => {
    key.current ??= `edit-session-${++sessions}`
    return key.current
  }, [])
  const end = useCallback(() => {
    key.current = null
  }, [])
  return { current, end }
}
