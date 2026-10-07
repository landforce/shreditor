import { usePlaybackShortcuts } from './shortcuts/use-playback-shortcuts'
import { useEditingShortcuts } from './shortcuts/use-editing-shortcuts'
import { useToolShortcuts } from './shortcuts/use-tool-shortcuts'
import { useMarkerShortcuts } from './shortcuts/use-marker-shortcuts'
import { useInOutShortcuts } from './shortcuts/use-in-out-shortcuts'
import { useUIShortcuts } from './shortcuts/use-ui-shortcuts'
import { useClipboardShortcuts } from './shortcuts/use-clipboard-shortcuts'
import { useSourceMonitorShortcuts } from './shortcuts/use-source-monitor-shortcuts'
import { useSelectionShortcuts } from './shortcuts/use-selection-shortcuts'
import { usePlayheadEditShortcuts } from './shortcuts/use-playhead-edit-shortcuts'

export interface TimelineShortcutCallbacks {
  onPlay?: () => void
  onPause?: () => void
  onSplit?: () => void
  onDelete?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onZoomToFit?: () => void
}

/**
 * Timeline keyboard shortcuts hook
 *
 * Composes domain-specific shortcut hooks for:
 * - Playback & navigation (Space, J/K/L shuttle, arrows, Home/End, snap points)
 * - Selection (Cmd/Ctrl+A, Cmd/Ctrl+Shift+A, Escape, D)
 * - Editing (Delete, split, join, keyframes)
 * - Playhead edits (Cmd/Ctrl+K add edit, Cmd/Ctrl+D duplicate, Q/W ripple trim)
 * - Tools (V/C/R tool switching)
 * - Markers (M add/remove, [ ] navigate)
 * - In/Out markers (I, O, Shift+I/O, Alt+X)
 * - UI (S snap, Z zoom, undo/redo)
 * - Clipboard (Ctrl+C/X/V)
 *
 * Note: Zoom is handled via Ctrl+Scroll only (see TimelineContent component)
 */
export function useTimelineShortcuts(callbacks: TimelineShortcutCallbacks = {}) {
  usePlaybackShortcuts(callbacks)
  useEditingShortcuts(callbacks)
  useSelectionShortcuts()
  usePlayheadEditShortcuts(callbacks)
  useToolShortcuts(callbacks)
  useMarkerShortcuts()
  useInOutShortcuts()
  useUIShortcuts(callbacks)
  useClipboardShortcuts()
  useSourceMonitorShortcuts()
}
