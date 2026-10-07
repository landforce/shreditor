import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { usePlaybackShortcuts } from './use-playback-shortcuts'

function Harness() {
  usePlaybackShortcuts({})
  return null
}

function keyEvent(type: 'keydown' | 'keyup', key: string, repeat = false): KeyboardEvent {
  return new KeyboardEvent(type, {
    key,
    code: `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    repeat,
  })
}

function down(key: string, repeat = false) {
  act(() => {
    document.body.dispatchEvent(keyEvent('keydown', key, repeat))
  })
}

function up(key: string) {
  act(() => {
    document.body.dispatchEvent(keyEvent('keyup', key))
  })
}

function transport() {
  const { isPlaying, playbackRate } = usePlaybackStore.getState()
  return { isPlaying, playbackRate }
}

describe('usePlaybackShortcuts J/K/L', () => {
  beforeEach(() => {
    useSourcePlayerStore.setState({ hoveredPanel: null, playerMethods: null })
    usePlaybackStore.setState({
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
      currentFrame: 50,
      previewFrame: null,
    })
  })

  afterEach(() => {
    act(() => {
      usePlaybackStore.getState().pause()
    })
  })

  it('L plays forward and speeds up 1x, 2x, 4x on repeated presses', () => {
    render(<Harness />)
    down('l')
    expect(transport()).toEqual({ isPlaying: true, playbackRate: 1 })
    up('l')
    down('l')
    expect(transport().playbackRate).toBe(2)
    up('l')
    down('l')
    expect(transport().playbackRate).toBe(4)
    up('l')
    // Key repeat from holding L is not another press.
    down('l', true)
    expect(transport().playbackRate).toBe(4)
  })

  it('J plays in reverse and speeds up; L after J goes back to 1x forward', () => {
    render(<Harness />)
    down('j')
    up('j')
    down('j')
    up('j')
    expect(transport()).toEqual({ isPlaying: true, playbackRate: -2 })
    down('l')
    up('l')
    expect(transport()).toEqual({ isPlaying: true, playbackRate: 1 })
  })

  it('K pauses while playing', () => {
    render(<Harness />)
    down('l')
    up('l')
    down('k')
    up('k')
    expect(transport().isPlaying).toBe(false)
  })

  it('K held with J or L steps one frame and pauses', () => {
    render(<Harness />)
    down('l')
    up('l')
    down('k')
    expect(transport().isPlaying).toBe(false)
    const frame = usePlaybackStore.getState().currentFrame

    down('l')
    expect(usePlaybackStore.getState().currentFrame).toBe(frame + 1)
    down('l')
    expect(usePlaybackStore.getState().currentFrame).toBe(frame + 2)
    down('j')
    expect(usePlaybackStore.getState().currentFrame).toBe(frame + 1)
    expect(transport().isPlaying).toBe(false)

    up('k')
    down('l')
    expect(transport().isPlaying).toBe(true)
  })
})
