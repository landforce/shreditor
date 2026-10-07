import { act, render } from '@testing-library/react'
import { useHotkeys } from 'react-hotkeys-hook'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { useItemsStore } from '../../stores/items-store'
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store'
import { useSelectionShortcuts } from './use-selection-shortcuts'

const clearKeyframesSpy = vi.fn()

function Harness() {
  useSelectionShortcuts()
  // Shift+A (clear keyframes) must not fire on Cmd/Ctrl+Shift+A.
  useHotkeys('shift+a', clearKeyframesSpy, HOTKEY_OPTIONS)
  return <input aria-label="search" data-testid="search" />
}

function makeTrack(
  id: string,
  order: number,
  overrides: Partial<TimelineTrack> = {},
): TimelineTrack {
  return {
    id,
    name: id,
    kind: 'video',
    order,
    height: 60,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    items: [],
    ...overrides,
  }
}

function makeClip(id: string, trackId: string, from: number): TimelineItem {
  return {
    id,
    type: 'video',
    trackId,
    from,
    durationInFrames: 30,
    label: id,
    src: 'clip.mp4',
  }
}

const KEY_CODES: Record<string, string> = { a: 'KeyA', d: 'KeyD', Escape: 'Escape' }

function press(
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  target: EventTarget = document.body,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: KEY_CODES[key] ?? key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function selectedIds() {
  return useSelectionStore.getState().selectedItemIds
}

describe('useSelectionShortcuts', () => {
  beforeEach(() => {
    clearKeyframesSpy.mockClear()
    useSelectionStore.getState().clearSelection()
    useEditorStore.setState({
      linkedSelectionEnabled: true,
      keyframeEditorShortcutScopeActive: false,
      transcriptEditorShortcutScopeActive: false,
    })
    useCompositionNavigationStore.setState({ activeCompositionId: null })
    usePlaybackStore.setState({ currentFrame: 40 })
    useItemsStore
      .getState()
      .setTracks([makeTrack('v1', 0), makeTrack('v2', 1), makeTrack('v3', 2, { locked: true })])
    useItemsStore
      .getState()
      .setItems([makeClip('a', 'v1', 0), makeClip('b', 'v2', 30), makeClip('c', 'v3', 30)])
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('Cmd/Ctrl+A selects every clip on unlocked tracks', () => {
    render(<Harness />)
    const event = press('a', { metaKey: true })
    expect(selectedIds()).toEqual(['a', 'b'])
    expect(event.defaultPrevented).toBe(true)

    useSelectionStore.getState().clearSelection()
    press('a', { ctrlKey: true })
    expect(selectedIds()).toEqual(['a', 'b'])
  })

  it('leaves Cmd/Ctrl+A to a focused text field', () => {
    const { getByTestId } = render(<Harness />)
    const input = getByTestId('search') as HTMLInputElement
    input.focus()

    const event = press('a', { metaKey: true }, input)

    expect(selectedIds()).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('yields Cmd/Ctrl+A to the keyframe and transcript editors', () => {
    render(<Harness />)
    useEditorStore.setState({ transcriptEditorShortcutScopeActive: true })
    const event = press('a', { metaKey: true })
    expect(selectedIds()).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('Cmd/Ctrl+Shift+A deselects without triggering Shift+A', () => {
    render(<Harness />)
    useSelectionStore.getState().selectItems(['a'])

    press('a', { metaKey: true, shiftKey: true })

    expect(selectedIds()).toEqual([])
    expect(clearKeyframesSpy).not.toHaveBeenCalled()

    press('a', { shiftKey: true })
    expect(clearKeyframesSpy).toHaveBeenCalledTimes(1)
  })

  it('Escape deselects when nothing else claims it', () => {
    render(<Harness />)
    useSelectionStore.getState().selectItems(['a'])

    const event = press('Escape')

    expect(selectedIds()).toEqual([])
    expect(event.defaultPrevented).toBe(true)
  })

  it('Escape leaves the selection alone when a dialog, composition or drag has it', () => {
    render(<Harness />)
    useSelectionStore.getState().selectItems(['a'])

    // A dialog or menu already handled it.
    const handled = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    handled.preventDefault()
    act(() => {
      document.body.dispatchEvent(handled)
    })
    expect(selectedIds()).toEqual(['a'])

    // Inside a sub-composition Escape goes up a level first.
    useCompositionNavigationStore.setState({ activeCompositionId: 'comp-1' })
    press('Escape')
    expect(selectedIds()).toEqual(['a'])
    useCompositionNavigationStore.setState({ activeCompositionId: null })

    // A held pointer means Escape is cancelling a drag.
    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
    })
    press('Escape')
    expect(selectedIds()).toEqual(['a'])
    act(() => {
      window.dispatchEvent(new Event('pointerup'))
    })

    // An open modal owns Escape.
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('data-state', 'open')
    document.body.appendChild(dialog)
    press('Escape')
    expect(selectedIds()).toEqual(['a'])
    dialog.remove()

    press('Escape')
    expect(selectedIds()).toEqual([])
  })

  it('Escape with nothing selected does not swallow the key', () => {
    render(<Harness />)
    expect(press('Escape').defaultPrevented).toBe(false)
  })

  it('D selects the clip at the playhead on the active track, else the topmost one', () => {
    render(<Harness />)
    useSelectionStore.getState().setActiveTrack('v2')
    press('d')
    expect(selectedIds()).toEqual(['b'])

    usePlaybackStore.setState({ currentFrame: 10 })
    press('d')
    expect(selectedIds()).toEqual(['a'])
  })

  it('D never selects a clip on a locked track', () => {
    useItemsStore.getState().setItems([makeClip('c', 'v3', 30)])
    render(<Harness />)
    useSelectionStore.getState().setActiveTrack('v3')
    press('d')
    expect(selectedIds()).toEqual([])
  })
})
