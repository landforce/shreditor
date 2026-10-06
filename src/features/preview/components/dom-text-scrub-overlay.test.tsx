import React, { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import type { PlayerRef } from '@/features/preview/deps/player-core'
import { DomTextScrubOverlay } from './dom-text-scrub-overlay'

const seekToMock = vi.fn<(frame: number) => void>()

vi.mock('@/features/preview/deps/player-core', async () => {
  const React = await import('react')
  const HeadlessPlayer = React.forwardRef<
    { seekTo: (frame: number) => void },
    React.PropsWithChildren
  >(({ children }, ref) => {
    React.useImperativeHandle(ref, () => ({ seekTo: seekToMock }), [])
    return <div>{children}</div>
  })
  HeadlessPlayer.displayName = 'HeadlessPlayer'
  return { HeadlessPlayer }
})

vi.mock('@/features/preview/deps/composition-runtime', () => ({
  MainComposition: () => null,
}))

describe('DomTextScrubOverlay', () => {
  let rafId = 0
  let rafCallbacks = new Map<number, FrameRequestCallback>()

  const flushAnimationFrames = () => {
    const callbacks = [...rafCallbacks.values()]
    rafCallbacks.clear()
    for (const callback of callbacks) callback(performance.now())
  }

  beforeEach(() => {
    seekToMock.mockReset()
    rafId = 0
    rafCallbacks = new Map()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++rafId
      rafCallbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id)
    })
    usePlaybackStore.setState({
      currentFrame: 10,
      currentFrameEpoch: 1,
      previewFrame: 10,
      previewFrameEpoch: 1,
      frameUpdateEpoch: 1,
      isPlaying: false,
    })
    usePreviewBridgeStore.setState({ displayedFrame: 10 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const inputProps = {
    fps: 30,
    width: 1920,
    height: 1080,
    tracks: [],
    transitions: [],
    keyframes: [],
  }

  const renderOverlay = (visible: boolean) => (
    <DomTextScrubOverlay
      playerRef={createRef<PlayerRef>()}
      visible={visible}
      durationInFrames={120}
      fps={30}
      renderSize={{ width: 1920, height: 1080 }}
      layoutSize={{ width: 1280, height: 720 }}
      inputProps={inputProps}
    />
  )

  it('hides with opacity so explicitly visible track layers cannot show stale text', () => {
    const { container, rerender } = render(renderOverlay(false))
    const overlay = container.querySelector<HTMLElement>('[data-dom-text-scrub-overlay]')

    // Track layers inside the composition set `visibility: visible`, which
    // overrides an inherited `visibility: hidden`.
    expect(overlay?.style.opacity).toBe('0')
    expect(seekToMock).not.toHaveBeenCalled()

    rerender(renderOverlay(true))
    expect(overlay?.style.opacity).toBe('1')
  })

  it('seeks to the visible frame before paint when it becomes visible', () => {
    const { rerender } = render(renderOverlay(false))
    usePlaybackStore.setState({ currentFrame: 600, previewFrame: 600 })
    usePreviewBridgeStore.setState({ displayedFrame: 600 })

    rerender(renderOverlay(true))
    expect(seekToMock).toHaveBeenCalledOnce()
    expect(seekToMock).toHaveBeenLastCalledWith(600)
  })

  it('waits for the displayed canvas frame before advancing scrub text', () => {
    render(
      <DomTextScrubOverlay
        playerRef={createRef<PlayerRef>()}
        visible
        durationInFrames={120}
        fps={30}
        renderSize={{ width: 1920, height: 1080 }}
        layoutSize={{ width: 1280, height: 720 }}
        inputProps={{
          fps: 30,
          width: 1920,
          height: 1080,
          tracks: [],
          transitions: [],
          keyframes: [],
        }}
      />,
    )

    act(flushAnimationFrames)
    expect(seekToMock).toHaveBeenLastCalledWith(10)
    seekToMock.mockClear()

    act(() => {
      usePlaybackStore.getState().setScrubFrame(20)
      flushAnimationFrames()
    })
    expect(seekToMock).not.toHaveBeenCalled()

    act(() => {
      usePreviewBridgeStore.getState().setDisplayedFrame(20)
      flushAnimationFrames()
    })
    expect(seekToMock).toHaveBeenCalledOnce()
    expect(seekToMock).toHaveBeenLastCalledWith(20)
  })
})
