/**
 * Marker shortcuts: M (add), Shift+M (remove), [ ] (navigate), and N (a
 * comment for the agent at the playhead, in Concise).
 */

import { useHotkeys } from 'react-hotkeys-hook'
import { usePlaybackStore } from '@/shared/state/playback'
import { useMarkersStore } from '../../stores/markers-store'
import { useSelectionStore } from '@/shared/state/selection'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { addMarker, removeMarker } from '../../stores/actions/marker-actions'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'
import { startAgentComment } from '@/shared/state/agent-notes'
import { useEditorStore } from '@/shared/state/editor'
import { normalizeEditorWorkspaceId } from '@/config/editor-workspaces'

/** The workspaces whose timeline has the Notes lane. */
function workspaceShowsNotesLane(workspace: unknown): boolean {
  const id = normalizeEditorWorkspaceId(workspace)
  return id === 'edit' || id === 'concise'
}

export function useMarkerShortcuts() {
  const hotkeys = useResolvedHotkeys()
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const clearSelection = useSelectionStore((s) => s.clearSelection)

  // Markers: M - Add marker at playhead
  useHotkeys(
    hotkeys.ADD_MARKER,
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      addMarker(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  // N - Note for the agent at the playhead (the composer opens on the Notes lane,
  // which the Edit and Concise timelines show)
  useHotkeys(
    hotkeys.COMMENT_FOR_AGENT,
    (event) => {
      if (!workspaceShowsNotesLane(useEditorStore.getState().workspace)) return
      event.preventDefault()
      startAgentComment()
    },
    HOTKEY_OPTIONS,
    [],
  )

  // Markers: Shift+M - Remove selected marker
  useHotkeys(
    hotkeys.REMOVE_MARKER,
    (event) => {
      event.preventDefault()
      const id = useSelectionStore.getState().selectedMarkerId
      if (id) {
        removeMarker(id)
        clearSelection()
      }
    },
    HOTKEY_OPTIONS,
    [clearSelection],
  )

  // Markers: [ - Jump to previous marker
  useHotkeys(
    hotkeys.PREVIOUS_MARKER,
    (event) => {
      event.preventDefault()
      const currentMarkers = useMarkersStore.getState().markers
      if (currentMarkers.length === 0) return
      const currentFrame = usePlaybackStore.getState().currentFrame
      let previousFrame: number | undefined
      for (const marker of currentMarkers) {
        if (marker.frame < currentFrame) {
          if (previousFrame === undefined || marker.frame > previousFrame) {
            previousFrame = marker.frame
          }
        }
      }
      if (previousFrame !== undefined) {
        setCurrentFrame(previousFrame)
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame],
  )

  // Markers: ] - Jump to next marker
  useHotkeys(
    hotkeys.NEXT_MARKER,
    (event) => {
      event.preventDefault()
      const currentMarkers = useMarkersStore.getState().markers
      if (currentMarkers.length === 0) return
      const currentFrame = usePlaybackStore.getState().currentFrame
      let nextFrame: number | undefined
      for (const marker of currentMarkers) {
        if (marker.frame > currentFrame) {
          if (nextFrame === undefined || marker.frame < nextFrame) {
            nextFrame = marker.frame
          }
        }
      }
      if (nextFrame !== undefined) {
        setCurrentFrame(nextFrame)
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame],
  )
}
