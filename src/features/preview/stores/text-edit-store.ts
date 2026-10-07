import { create } from 'zustand'
import type { TimelineItem } from '@/types/timeline'

interface TextEditState {
  /** The text item being edited in place on the preview canvas, if any. */
  editingItemId: string | null
  /**
   * The last preview click that selected a text item. The first click of a
   * double-click swaps the hit area for the gizmo, so the browser never fires
   * `dblclick`; the gizmo treats a second click shortly after this as one.
   */
  lastSelectClick: { itemId: string; at: number } | null
  startEditing: (itemId: string) => void
  stopEditing: () => void
  noteSelectClick: (itemId: string) => void
}

/** A second click within this window after selecting a text item starts editing. */
const DOUBLE_CLICK_WINDOW_MS = 450

export const useTextEditStore = create<TextEditState>()((set) => ({
  editingItemId: null,
  lastSelectClick: null,
  startEditing: (itemId) => set({ editingItemId: itemId }),
  noteSelectClick: (itemId) => set({ lastSelectClick: { itemId, at: Date.now() } }),
  stopEditing: () =>
    set((state) => (state.editingItemId === null ? state : { editingItemId: null })),
}))

/**
 * Plain `text` items edit in place. Multi-span items keep their per-span
 * styling in the properties panel, so the canvas leaves them alone rather than
 * flattening the spans.
 */
/** True when `itemId` was selected by a preview click within the double-click window. */
export function wasJustSelectedByClick(itemId: string, now = Date.now()): boolean {
  const last = useTextEditStore.getState().lastSelectClick
  return !!last && last.itemId === itemId && now - last.at < DOUBLE_CLICK_WINDOW_MS
}

export function canEditTextInline(item: TimelineItem): boolean {
  return item.type === 'text' && !(item.textSpans && item.textSpans.length > 0)
}
