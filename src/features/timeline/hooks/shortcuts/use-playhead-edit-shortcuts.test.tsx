import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { useItemsStore } from '../../stores/items-store'
import { useTimelineCommandStore } from '../../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { usePlayheadEditShortcuts } from './use-playhead-edit-shortcuts'

const onSplit = vi.fn()

function Harness() {
  usePlayheadEditShortcuts({ onSplit })
  return null
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
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    items: [],
    ...overrides,
  }
}

function makeClip(id: string, trackId: string, from: number, duration = 60): TimelineItem {
  return {
    id,
    type: 'video',
    trackId,
    from,
    durationInFrames: duration,
    label: id,
    src: 'clip.mp4',
    mediaId: `media-${id}`,
    sourceStart: 0,
    sourceEnd: duration,
    sourceDuration: 600,
  }
}

function press(key: string, modifiers: { metaKey?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  act(() => {
    document.body.dispatchEvent(event)
  })
  return event
}

function spans(trackId: string): Array<[number, number]> {
  return useItemsStore
    .getState()
    .items.filter((item) => item.trackId === trackId)
    .toSorted((left, right) => left.from - right.from)
    .map((item) => [item.from, item.durationInFrames])
}

function undoCount() {
  return useTimelineCommandStore.getState().undoStack.length
}

describe('usePlayheadEditShortcuts', () => {
  beforeEach(() => {
    onSplit.mockClear()
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useEditorStore.setState({ linkedSelectionEnabled: true })
    useSelectionStore.getState().clearSelection()
    usePlaybackStore.setState({ currentFrame: 20, previewFrame: null, isPlaying: false })
    useItemsStore
      .getState()
      .setTracks([makeTrack('v2', 0), makeTrack('v1', 1), makeTrack('v3', 2, { locked: true })])
    useItemsStore
      .getState()
      .setItems([
        makeClip('top', 'v2', 0),
        makeClip('main', 'v1', 0),
        makeClip('next', 'v1', 60),
        makeClip('locked', 'v3', 0),
      ])
  })

  it('Cmd/Ctrl+K cuts only the selected clip under the playhead', () => {
    render(<Harness />)
    useSelectionStore.getState().selectItems(['main'])

    const event = press('k', { metaKey: true })

    expect(event.defaultPrevented).toBe(true)
    expect(spans('v1')).toEqual([
      [0, 20],
      [20, 40],
      [60, 60],
    ])
    expect(spans('v2')).toEqual([[0, 60]])
    expect(onSplit).toHaveBeenCalledTimes(1)
    expect(undoCount()).toBe(1)
  })

  it('Cmd/Ctrl+K with nothing selected cuts every unlocked clip under the playhead', () => {
    render(<Harness />)
    press('k', { metaKey: true })

    expect(spans('v2')).toEqual([
      [0, 20],
      [20, 40],
    ])
    expect(spans('v1')).toEqual([
      [0, 20],
      [20, 40],
      [60, 60],
    ])
    expect(spans('v3')).toEqual([[0, 60]])
    expect(undoCount()).toBe(1)
  })

  it('Cmd/Ctrl+D duplicates the selection after itself and takes the key from the browser', () => {
    render(<Harness />)
    useSelectionStore.getState().selectItems(['top'])

    const event = press('d', { metaKey: true })

    expect(event.defaultPrevented).toBe(true)
    expect(spans('v2')).toEqual([
      [0, 60],
      [60, 60],
    ])
    expect(useSelectionStore.getState().selectedItemIds).toHaveLength(1)
    expect(useSelectionStore.getState().selectedItemIds[0]).not.toBe('top')
    expect(undoCount()).toBe(1)
  })

  it('Cmd/Ctrl+D ignores selected clips on locked tracks', () => {
    render(<Harness />)
    useSelectionStore.getState().selectItems(['locked'])
    press('d', { metaKey: true })
    expect(spans('v3')).toEqual([[0, 60]])
    expect(undoCount()).toBe(0)
  })

  it('Q trims the active-track clip start to the playhead and moves the playhead to the cut', () => {
    render(<Harness />)
    useSelectionStore.getState().setActiveTrack('v1')
    usePlaybackStore.setState({ currentFrame: 80 })

    press('q')

    expect(spans('v1')).toEqual([
      [0, 60],
      [60, 40],
    ])
    expect(spans('v2')).toEqual([[0, 60]])
    expect(usePlaybackStore.getState().currentFrame).toBe(60)
    expect(undoCount()).toBe(1)
  })

  it('W trims the selected clip end to the playhead and keeps the playhead', () => {
    render(<Harness />)
    useSelectionStore.getState().selectItems(['main'])

    press('w')

    expect(spans('v1')).toEqual([
      [0, 20],
      [20, 60],
    ])
    expect(usePlaybackStore.getState().currentFrame).toBe(20)
    expect(undoCount()).toBe(1)

    useTimelineCommandStore.getState().undo()
    expect(spans('v1')).toEqual([
      [0, 60],
      [60, 60],
    ])
  })

  it('Q falls back to the topmost unlocked clip when the active track has none there', () => {
    render(<Harness />)
    useItemsStore.getState().setItems([makeClip('top', 'v2', 0), makeClip('locked', 'v3', 0)])
    useSelectionStore.getState().setActiveTrack('v3')

    press('q')

    expect(spans('v2')).toEqual([[0, 40]])
    expect(spans('v3')).toEqual([[0, 60]])
  })
})
