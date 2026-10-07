/**
 * Editing commands shared by the keyboard shortcuts and the timeline toolbar,
 * so a button and its hotkey can never drift apart.
 */
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { splitAllItemsAtFrame } from '../stores/actions/item-actions'
import { useTimelineStore } from '../stores/timeline-store'
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store'

/** Split every item under the gray (hover) playhead, or the main playhead. */
export function splitAtPlayhead(): number {
  const { previewFrame, currentFrame } = usePlaybackStore.getState()
  return splitAllItemsAtFrame(previewFrame ?? currentFrame)
}

export interface DeleteSelectionContext {
  /** Another panel (keyframe / transcript editor) owns Delete. */
  ownedByPanel: boolean
  selectedTransitionId: string | null
  selectedMarkerId: string | null
  selectedItemIds: string[]
  removeTransition: (id: string) => void
  removeMarker: (id: string) => void
  removeItems: (ids: string[]) => void
  clearSelection: () => void
  onDelete?: () => void
}

/**
 * `blocked`: a panel owns Delete, nothing removed. `handled`: something was
 * removed. `none`: nothing selected.
 */
export function deleteSelection(ctx: DeleteSelectionContext): 'blocked' | 'handled' | 'none' {
  if (ctx.ownedByPanel) return 'blocked'
  if (ctx.selectedTransitionId) {
    ctx.removeTransition(ctx.selectedTransitionId)
    ctx.clearSelection()
    return 'handled'
  }
  if (ctx.selectedMarkerId) {
    ctx.removeMarker(ctx.selectedMarkerId)
    ctx.clearSelection()
    return 'handled'
  }
  if (ctx.selectedItemIds.length > 0) {
    ctx.removeItems(ctx.selectedItemIds)
    ctx.onDelete?.()
    return 'handled'
  }
  return 'none'
}

/** `deleteSelection` against the live stores, for toolbar buttons. */
export function deleteSelectionFromStores(): 'blocked' | 'handled' | 'none' {
  const selection = useSelectionStore.getState()
  const editor = useEditorStore.getState()
  const timeline = useTimelineStore.getState()
  return deleteSelection({
    ownedByPanel:
      editor.keyframeEditorShortcutScopeActive ||
      (selection.editKeyframePanelOpen &&
        useKeyframeSelectionStore.getState().selectedKeyframes.length > 0) ||
      editor.transcriptEditorShortcutScopeActive,
    selectedTransitionId: selection.selectedTransitionId,
    selectedMarkerId: selection.selectedMarkerId,
    selectedItemIds: selection.selectedItemIds,
    removeTransition: timeline.removeTransition,
    removeMarker: timeline.removeMarker,
    removeItems: timeline.removeItems,
    clearSelection: selection.clearSelection,
  })
}
