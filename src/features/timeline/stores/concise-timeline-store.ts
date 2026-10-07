/**
 * Timeline-local view state for the Concise workspace.
 *
 * `conciseFullHeaders` swaps the 72px track labels back to the full track
 * headers. It is a per-viewer preference, persisted to localStorage.
 */
import { create } from 'zustand'

const STORAGE_KEY = 'timeline:conciseFullHeaders'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeStored(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    /* noop */
  }
}

interface ConciseTimelineState {
  conciseFullHeaders: boolean
  toggleConciseFullHeaders: () => void
  setConciseFullHeaders: (value: boolean) => void
}

export const useConciseTimelineStore = create<ConciseTimelineState>((set, get) => ({
  conciseFullHeaders: readStored(),
  toggleConciseFullHeaders: () => get().setConciseFullHeaders(!get().conciseFullHeaders),
  setConciseFullHeaders: (value) => {
    writeStored(value)
    set({ conciseFullHeaders: value })
  },
}))
