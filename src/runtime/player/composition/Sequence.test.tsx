import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { ClockBridgeProvider, useClock } from '../clock'
import type { Clock } from '../clock/Clock'
import { Sequence } from './Sequence'
import { SequenceFrameRemapContext, useSequenceContext } from './sequence-context'

describe('Sequence frame subscriptions', () => {
  it('keeps premounted children stable until the sequence becomes active', () => {
    let clock: Clock | null = null
    const childFrames: number[] = []

    function ClockProbe() {
      clock = useClock()
      return null
    }

    const Child = vi.fn(() => {
      childFrames.push(useSequenceContext()?.localFrame ?? Number.NaN)
      return null
    })

    render(
      <ClockBridgeProvider fps={30} durationInFrames={200}>
        <ClockProbe />
        <Sequence from={100} durationInFrames={20} premountFor={25}>
          <Child />
        </Sequence>
      </ClockBridgeProvider>,
    )

    expect(clock).not.toBeNull()
    expect(Child).not.toHaveBeenCalled()

    act(() => clock!.seekToFrame(75))
    expect(childFrames).toEqual([-1])

    act(() => {
      clock!.seekToFrame(76)
      clock!.seekToFrame(90)
      clock!.seekToFrame(99)
    })
    expect(childFrames).toEqual([-1])

    act(() => clock!.seekToFrame(100))
    act(() => clock!.seekToFrame(101))
    expect(childFrames).toEqual([-1, 0, 1])

    act(() => clock!.seekToFrame(120))
    expect(Child).toHaveBeenCalledTimes(3)
  })

  it('reads the clock through a frame remap (a held template instance freezes its children)', () => {
    let clock: Clock | null = null
    const childFrames: number[] = []

    function ClockProbe() {
      clock = useClock()
      return null
    }

    function Child() {
      childFrames.push(useSequenceContext()?.localFrame ?? Number.NaN)
      return null
    }

    // Frames 0..9 play, 10..29 hold on 10, then play on from 11.
    const remap = (frame: number) => (frame < 10 ? frame : frame < 30 ? 10 : frame - 19)
    render(
      <ClockBridgeProvider fps={30} durationInFrames={200}>
        <ClockProbe />
        <SequenceFrameRemapContext.Provider value={remap}>
          <Sequence from={0} durationInFrames={60}>
            <Child />
          </Sequence>
        </SequenceFrameRemapContext.Provider>
      </ClockBridgeProvider>,
    )

    act(() => clock!.seekToFrame(9))
    act(() => clock!.seekToFrame(15))
    act(() => clock!.seekToFrame(25))
    act(() => clock!.seekToFrame(31))
    // The hold renders once: no new frame while the clock runs through it.
    expect(childFrames.slice(-3)).toEqual([9, 10, 12])
  })
})
