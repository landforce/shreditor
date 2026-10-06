import { describe, expect, it } from 'vite-plus/test'
import { heldTemplateFrame, resolveHeldInstanceFrame } from './instance-time'

// A 60-frame template: in 0..19, hold frame 20, out 21..59.
const T = 60
const frame = { start: 20, end: 20 }
const frames = (instance: number, hold = frame) =>
  Array.from({ length: instance }, (_, t) => heldTemplateFrame(t, instance, T, hold))

describe('held template instance time', () => {
  it('an instance as long as the template plays it straight', () => {
    expect(frames(T)).toEqual(Array.from({ length: T }, (_, t) => t))
  })

  it('a longer instance plays in, freezes on the hold, then plays out to its own end', () => {
    const out = frames(120)
    expect(out.slice(0, 21)).toEqual(Array.from({ length: 21 }, (_, t) => t))
    expect(new Set(out.slice(20, 81))).toEqual(new Set([20]))
    expect(out.slice(81)).toEqual(Array.from({ length: 39 }, (_, t) => 21 + t))
    expect(out.at(-1)).toBe(T - 1)
  })

  it('a hold range plays through, then freezes on its last frame', () => {
    const out = frames(80, { start: 20, end: 29 })
    expect(out.slice(20, 30)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29])
    expect(new Set(out.slice(30, 50))).toEqual(new Set([29]))
    expect(out.slice(50)).toEqual(Array.from({ length: 30 }, (_, t) => 30 + t))
  })

  it('a shorter instance gives up hold frames first, then cuts the end', () => {
    const range = { start: 20, end: 39 } // in 20, hold 20, out 20
    const shorter = frames(50, range)
    expect(shorter.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, t) => t))
    expect(shorter.slice(20, 30)).toEqual(Array.from({ length: 10 }, (_, t) => 20 + t))
    expect(shorter.slice(30)).toEqual(Array.from({ length: 20 }, (_, t) => 40 + t))
    // Below in + out the hold is gone and the out-animation is cut.
    const tiny = frames(30, range)
    expect(tiny.slice(20)).toEqual(Array.from({ length: 10 }, (_, t) => 40 + t))
  })

  it('resolves per instance in composition frames; no hold means the usual mapping', () => {
    const item = { templateHold: frame, durationInFrames: 240, sourceDuration: T }
    // 60 fps timeline, 30 fps template: two timeline frames per template frame.
    expect(resolveHeldInstanceFrame(item, 0, 60, 30)).toBe(0)
    expect(resolveHeldInstanceFrame(item, 100, 60, 30)).toBe(20)
    expect(resolveHeldInstanceFrame(item, 239, 60, 30)).toBeCloseTo(59.5)
    expect(resolveHeldInstanceFrame({ durationInFrames: 30 }, 10, 30, 30)).toBeNull()
  })
})
