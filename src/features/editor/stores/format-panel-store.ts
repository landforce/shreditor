import { create } from 'zustand'

export type NoSelectionTab = 'format' | 'canvas'

interface FormatPanelState {
  /** Which inspector shows in the properties sidebar when nothing is selected. */
  tab: NoSelectionTab
  setTab: (tab: NoSelectionTab) => void
}

export const useFormatPanelStore = create<FormatPanelState>()((set) => ({
  tab: 'format',
  setTab: (tab) => set({ tab }),
}))
