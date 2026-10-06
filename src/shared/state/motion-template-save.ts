import { create } from 'zustand'

interface MotionTemplateSaveState {
  /** The composition the "Save as template" dialog is open for. */
  compositionId: string | null
  requestSave: (compositionId: string) => void
  close: () => void
}

/**
 * Opens the "Save as template" dialog: the timeline's context menu asks, the
 * motion templates panel shows the dialog.
 */
export const useMotionTemplateSaveStore = create<MotionTemplateSaveState>()((set) => ({
  compositionId: null,
  requestSave: (compositionId) => set({ compositionId }),
  close: () => set({ compositionId: null }),
}))
