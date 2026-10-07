/**
 * Selection shortcuts: Cmd/Ctrl+A (select all clips), Cmd/Ctrl+Shift+A and
 * Escape (deselect), D (select the clip at the playhead).
 *
 * Text fields keep their native behaviour: these bindings are not enabled on
 * form tags or contenteditable, so Cmd/Ctrl+A there still selects the text.
 */

import { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'
import { useItemsStore } from '../../stores/items-store'
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store'
import {
  findClipAtPlayhead,
  getClickSelectionIds,
  getSelectableItemIds,
} from '../../utils/playhead-targets'

/** These handlers decide for themselves whether to swallow the key. */
const SELECTION_HOTKEY_OPTIONS = { ...HOTKEY_OPTIONS, preventDefault: false } as const

/** A focused panel that owns its own selection model (keyframes, transcript words). */
function isSelectionOwnedByPanel(): boolean {
  const { keyframeEditorShortcutScopeActive, transcriptEditorShortcutScopeActive } =
    useEditorStore.getState()
  return keyframeEditorShortcutScopeActive || transcriptEditorShortcutScopeActive
}

function isModalOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]') !== null
  )
}

function hasAnySelection(): boolean {
  const { selectedItemIds, selectedMarkerId, selectedTransitionId } = useSelectionStore.getState()
  return selectedItemIds.length > 0 || selectedMarkerId !== null || selectedTransitionId !== null
}

/**
 * Escape is shared: dialogs, menus, pickers, drags and the composition breadcrumb
 * all use it. Deselect only when none of them is in play.
 */
function shouldEscapeDeselect(event: KeyboardEvent, pointerHeld: boolean): boolean {
  if (event.defaultPrevented || pointerHeld) return false
  if (isSelectionOwnedByPanel() || isModalOpen()) return false
  if (useSelectionStore.getState().dragState) return false
  // Escape exits a sub-composition (timeline.tsx); that keeps priority.
  if (useCompositionNavigationStore.getState().activeCompositionId !== null) return false
  return hasAnySelection()
}

function selectAllTimelineItems(): void {
  const { items, tracks } = useItemsStore.getState()
  useSelectionStore.getState().selectItems(getSelectableItemIds(items, tracks))
}

function deselectAllTimelineItems(): void {
  useSelectionStore.getState().selectItems([])
}

/** Select the clip under the playhead (active track first). Returns its id. */
function selectClipAtPlayhead(): string | null {
  const { items, tracks } = useItemsStore.getState()
  const clip = findClipAtPlayhead({
    items,
    tracks,
    frame: usePlaybackStore.getState().currentFrame,
    activeTrackId: useSelectionStore.getState().activeTrackId,
  })
  if (!clip) return null
  const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
  useSelectionStore
    .getState()
    .selectItems(getClickSelectionIds(items, clip.id, linkedSelectionEnabled))
  return clip.id
}

/** Tracks whether a pointer button is down, so Escape can cancel a drag instead. */
function usePointerHeldRef() {
  const pointerHeldRef = useRef(false)
  useEffect(() => {
    const press = () => {
      pointerHeldRef.current = true
    }
    const release = () => {
      pointerHeldRef.current = false
    }
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      window.removeEventListener('blur', release)
    }
  }, [])
  return pointerHeldRef
}

export function useSelectionShortcuts() {
  const hotkeys = useResolvedHotkeys()
  const pointerHeldRef = usePointerHeldRef()

  useHotkeys(
    hotkeys.SELECT_ALL,
    (event) => {
      if (isSelectionOwnedByPanel() || isModalOpen()) return
      event.preventDefault()
      selectAllTimelineItems()
    },
    SELECTION_HOTKEY_OPTIONS,
    [],
  )

  useHotkeys(
    hotkeys.DESELECT_ALL,
    (event) => {
      if (isSelectionOwnedByPanel() || isModalOpen()) return
      event.preventDefault()
      deselectAllTimelineItems()
    },
    SELECTION_HOTKEY_OPTIONS,
    [],
  )

  useHotkeys(
    hotkeys.DESELECT_ALL_ALT,
    (event) => {
      if (!shouldEscapeDeselect(event, pointerHeldRef.current)) return
      event.preventDefault()
      deselectAllTimelineItems()
    },
    SELECTION_HOTKEY_OPTIONS,
    [pointerHeldRef],
  )

  useHotkeys(
    hotkeys.SELECT_CLIP_AT_PLAYHEAD,
    (event) => {
      if (isSelectionOwnedByPanel()) return
      event.preventDefault()
      selectClipAtPlayhead()
    },
    SELECTION_HOTKEY_OPTIONS,
    [],
  )
}
