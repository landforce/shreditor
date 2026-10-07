import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { TimelineTrack } from '@/types/timeline'

import { useEditorStore } from '@/shared/state/editor'
import { useItemsStore } from '../stores/items-store'
import { useConciseTimelineStore } from '../stores/concise-timeline-store'
import { TrackHeader } from './track-header'

// Existing suites assume a non-concise workspace (the default is concise).
useEditorStore.setState({ workspace: 'edit' })

vi.mock('../hooks/use-track-drag', () => ({
  useTrackDrag: () => ({
    handleDragStart: () => undefined,
  }),
}))

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'V1',
    kind: 'video',
    height: 72,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: 0,
    items: [],
    ...overrides,
  }
}

function renderTrackHeader(track: TimelineTrack, onToggleDisabled = vi.fn()) {
  const renderResult = render(
    <TrackHeader
      track={track}
      isActive={false}
      isSelected={false}
      canDeleteTrack
      canDeleteEmptyTracks
      onToggleLock={() => undefined}
      onToggleSyncLock={() => undefined}
      onToggleDisabled={onToggleDisabled}
      onToggleSolo={() => undefined}
      onSelect={() => undefined}
      onCloseGaps={() => undefined}
      onAddVideoTrack={() => undefined}
      onAddAudioTrack={() => undefined}
      onDeleteTrack={() => undefined}
      onDeleteEmptyTracks={() => undefined}
    />,
  )

  return { ...renderResult, onToggleDisabled }
}

describe('TrackHeader', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
  })

  it('renders a unified disable control for video tracks', () => {
    const { onToggleDisabled } = renderTrackHeader(
      makeTrack({ kind: 'video', visible: true, muted: false }),
    )

    expect(screen.getByRole('button', { name: 'Disable track' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide track' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mute track' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disable track' }))

    expect(onToggleDisabled).toHaveBeenCalledTimes(1)
  })

  it('derives the disable state from audio mute status', () => {
    const { container } = renderTrackHeader(
      makeTrack({ id: 'track-2', name: 'A1', kind: 'audio', muted: true }),
    )

    expect(screen.getByRole('button', { name: 'Enable track' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show track' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unmute track' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-track-id="track-2"]')).toHaveAttribute(
      'data-track-disabled',
      'true',
    )
  })

  it('calls onToggleDisabled when clicking Enable track on a muted audio track', () => {
    const onToggleDisabled = vi.fn()
    renderTrackHeader(
      makeTrack({ id: 'track-3', name: 'A2', kind: 'audio', muted: true }),
      onToggleDisabled,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Enable track' }))

    expect(onToggleDisabled).toHaveBeenCalledTimes(1)
  })

  it('renders sync lock enabled by default and toggles the label when disabled', () => {
    const { rerender } = render(
      <TrackHeader
        track={makeTrack()}
        isActive={false}
        isSelected={false}
        canDeleteTrack
        canDeleteEmptyTracks
        onToggleLock={() => undefined}
        onToggleSyncLock={() => undefined}
        onToggleDisabled={() => undefined}
        onToggleSolo={() => undefined}
        onSelect={() => undefined}
        onCloseGaps={() => undefined}
        onAddVideoTrack={() => undefined}
        onAddAudioTrack={() => undefined}
        onDeleteTrack={() => undefined}
        onDeleteEmptyTracks={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: 'Disable sync lock' })).toBeInTheDocument()

    rerender(
      <TrackHeader
        track={makeTrack({ syncLock: false })}
        isActive={false}
        isSelected={false}
        canDeleteTrack
        canDeleteEmptyTracks
        onToggleLock={() => undefined}
        onToggleSyncLock={() => undefined}
        onToggleDisabled={() => undefined}
        onToggleSolo={() => undefined}
        onSelect={() => undefined}
        onCloseGaps={() => undefined}
        onAddVideoTrack={() => undefined}
        onAddAudioTrack={() => undefined}
        onDeleteTrack={() => undefined}
        onDeleteEmptyTracks={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: 'Enable sync lock' })).toBeInTheDocument()
  })
})

describe('TrackHeader concise workspace', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
    useEditorStore.setState({ workspace: 'concise' })
    useConciseTimelineStore.setState({ conciseFullHeaders: false })
  })

  afterEach(() => {
    useEditorStore.setState({ workspace: 'edit' })
  })

  it('renders a compact label with a kind icon and only disable + lock actions', () => {
    renderTrackHeader(makeTrack({ name: 'Main video', height: 80 }))

    expect(screen.getByTestId('track-header-concise')).toBeInTheDocument()
    expect(screen.getByText('Main video')).toBeInTheDocument()
    expect(screen.getByTestId('track-kind-icon')).toHaveAttribute('data-kind', 'video')
    expect(screen.getByRole('button', { name: 'Disable track' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lock Track' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Solo Track' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disable sync lock' })).not.toBeInTheDocument()
  })

  it('uses the music icon for audio tracks and the type icon for text-only tracks', () => {
    const { unmount } = renderTrackHeader(makeTrack({ name: 'A1', kind: 'audio' }))
    expect(screen.getByTestId('track-kind-icon')).toHaveAttribute('data-kind', 'audio')
    unmount()

    useItemsStore.getState().setItems([
      {
        id: 'text-1',
        trackId: 'track-1',
        type: 'text',
        from: 0,
        durationInFrames: 30,
        label: 'Hook',
        text: 'Hook',
      } as never,
    ])
    renderTrackHeader(makeTrack({ name: 'Captions' }))
    expect(screen.getByTestId('track-kind-icon')).toHaveAttribute('data-kind', 'text')
  })

  it('fires the disable and lock handlers', () => {
    const onToggleDisabled = vi.fn()
    const onToggleLock = vi.fn()
    render(
      <TrackHeader
        track={makeTrack()}
        isActive={false}
        isSelected={false}
        canDeleteTrack
        canDeleteEmptyTracks
        onToggleLock={onToggleLock}
        onToggleSyncLock={() => undefined}
        onToggleDisabled={onToggleDisabled}
        onToggleSolo={() => undefined}
        onSelect={() => undefined}
        onAddVideoTrack={() => undefined}
        onAddAudioTrack={() => undefined}
        onDeleteTrack={() => undefined}
        onDeleteEmptyTracks={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Disable track' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lock Track' }))

    expect(onToggleDisabled).toHaveBeenCalledTimes(1)
    expect(onToggleLock).toHaveBeenCalledTimes(1)
  })

  it('renders the normal header when full headers are on', () => {
    useConciseTimelineStore.setState({ conciseFullHeaders: true })
    renderTrackHeader(makeTrack())

    expect(screen.queryByTestId('track-header-concise')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Solo Track' })).toBeInTheDocument()
  })
})
