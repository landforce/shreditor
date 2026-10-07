/**
 * Playhead and selection edits: Cmd/Ctrl+K (add edit), Cmd/Ctrl+D (duplicate),
 * Q / W (ripple trim the clip start / end to the playhead).
 *
 * Every edit goes through a timeline action, so it is one undo step and agent
 * watch mode refuses it like any other edit.
 */

import { useHotkeys } from 'react-hotkeys-hook'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { useSelectionStore } from '@/shared/state/selection'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'
import { useItemsStore } from '../../stores/items-store'
import { splitItemsAtFrame } from '../../stores/actions/edit/split-actions'
import {
  duplicateItemsAfterSelf,
  rippleTrimItemsToFrame,
  type PlayheadTrimSide,
} from '../../stores/actions/edit/playhead-edit-actions'
import { expandSelectionWithLinkedItems } from '../../utils/linked-items'
import {
  findClipAtPlayhead,
  getAddEditTargetIds,
  getSelectableItemIds,
  getSelectedItemIdsInsideFrame,
} from '../../utils/playhead-targets'
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts'

/** Cmd/Ctrl combos the browser also claims: listen in the capture phase, like Alt+C. */
const CAPTURE_HOTKEY_OPTIONS = {
  ...HOTKEY_OPTIONS,
  eventListenerOptions: { capture: true },
} as const

function getPlayheadFrame(): number {
  return usePlaybackStore.getState().currentFrame
}

function getTimelineState() {
  const { items, tracks } = useItemsStore.getState()
  const selectedItemIds = useSelectionStore.getState().selectedItemIds
  return { items, tracks, selectedItemIds }
}

/** Add Edit: cut the selected clips at the playhead, else every unlocked clip there. */
function addEditAtPlayhead(): number {
  const frame = getPlayheadFrame()
  return splitItemsAtFrame(frame, getAddEditTargetIds({ ...getTimelineState(), frame }))
}

/** Duplicate the selected (unlocked) clips, with their linked partners when linked selection is on. */
function duplicateSelection(): void {
  const { items, tracks, selectedItemIds } = getTimelineState()
  const selectable = new Set(getSelectableItemIds(items, tracks))
  const ids = selectedItemIds.filter((id) => selectable.has(id))
  if (ids.length === 0) return
  const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
  const sources = linkedSelectionEnabled
    ? expandSelectionWithLinkedItems(items, ids).filter((id) => selectable.has(id))
    : ids
  duplicateItemsAfterSelf(sources)
}

/** Q / W target: selected clips under the playhead, else the clip there on the active track. */
function getTrimTargetIds(frame: number): string[] {
  const state = getTimelineState()
  const selected = getSelectedItemIdsInsideFrame({ ...state, frame })
  if (selected.length > 0) return selected
  const clip = findClipAtPlayhead({
    items: state.items,
    tracks: state.tracks,
    frame,
    activeTrackId: useSelectionStore.getState().activeTrackId,
    strict: true,
  })
  return clip ? [clip.id] : []
}

function seekTo(frame: number): void {
  usePlaybackStore.getState().setPreviewFrame(null)
  usePreviewBridgeStore.getState().setDisplayedFrame(null)
  usePlaybackStore.getState().setCurrentFrame(frame)
}

/** Ripple trim to the playhead. After Q the playhead moves to the new clip start. */
function rippleTrimToPlayhead(side: PlayheadTrimSide): void {
  const frame = getPlayheadFrame()
  const keptIds = rippleTrimItemsToFrame(getTrimTargetIds(frame), frame, side)
  if (side !== 'before' || keptIds.length === 0) return

  const itemById = useItemsStore.getState().itemById
  const starts = keptIds.flatMap((id) => (itemById[id] ? [itemById[id].from] : []))
  if (starts.length > 0) seekTo(Math.min(...starts))
}

export function usePlayheadEditShortcuts(callbacks: TimelineShortcutCallbacks) {
  const hotkeys = useResolvedHotkeys()

  useHotkeys(
    hotkeys.SPLIT_AT_PLAYHEAD,
    () => {
      if (addEditAtPlayhead() > 0) callbacks.onSplit?.()
    },
    CAPTURE_HOTKEY_OPTIONS,
    [callbacks],
  )

  // Cmd/Ctrl+D: the page takes it from the browser's bookmark shortcut.
  useHotkeys(hotkeys.DUPLICATE_SELECTED, duplicateSelection, CAPTURE_HOTKEY_OPTIONS, [])

  useHotkeys(
    hotkeys.RIPPLE_TRIM_START_TO_PLAYHEAD,
    () => rippleTrimToPlayhead('before'),
    HOTKEY_OPTIONS,
    [],
  )

  useHotkeys(
    hotkeys.RIPPLE_TRIM_END_TO_PLAYHEAD,
    () => rippleTrimToPlayhead('after'),
    HOTKEY_OPTIONS,
    [],
  )
}
