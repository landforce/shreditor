/**
 * The smart brush's painting state, shared by the clip panel (tool, size,
 * Painting toggle), the preview overlay that takes the strokes, and the
 * renderer, which shows the clip being painted with its removed area dimmed
 * instead of transparent.
 */
import type { CutoutStrokeTool } from '@/types/cutout'
import { notifyCutoutStoreChange } from './cutout-store'

export interface CutoutPaintState {
  /** The clip being painted, or null when not painting. */
  itemId: string | null
  tool: CutoutStrokeTool
  /** Brush radius as a fraction of the source frame's short side. */
  size: number
}

let paint: CutoutPaintState = { itemId: null, tool: 'smartEraser', size: 0.03 }
const listeners = new Set<() => void>()

export function getCutoutPaint(): CutoutPaintState {
  return paint
}

export function subscribeCutoutPaint(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setCutoutPaint(patch: Partial<CutoutPaintState>): void {
  const before = paint.itemId
  paint = { ...paint, ...patch }
  for (const listener of listeners) listener()
  // The preview redraws cut-out clips on store changes: the highlight follows.
  if (paint.itemId !== before) notifyCutoutStoreChange()
}
