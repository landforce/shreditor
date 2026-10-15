import { create } from 'zustand'

export type NoSelectionTab = 'format' | 'canvas' | 'notes'

interface FormatPanelState {
  /** Which tab the Project specs drawer shows: the format (scorecard), the canvas or the notes. */
  tab: NoSelectionTab
  setTab: (tab: NoSelectionTab) => void
  /** The Project specs drawer (format, scorecard, canvas) is open. */
  specsOpen: boolean
  setSpecsOpen: (open: boolean) => void
}

export const useFormatPanelStore = create<FormatPanelState>()((set) => ({
  tab: 'format',
  setTab: (tab) => set({ tab }),
  specsOpen: false,
  setSpecsOpen: (specsOpen) => set({ specsOpen }),
}))

/** Open the Project specs drawer on a tab (the format and its scorecard by default). */
export function openProjectSpecs(tab: NoSelectionTab = 'format'): void {
  useFormatPanelStore.setState({ tab, specsOpen: true })
}
