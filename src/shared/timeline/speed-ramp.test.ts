import { describe, expect, it } from 'vite-plus/test'
import { applyEasing, applyEasingConfig } from '@/shared/utils/easing'
import type { EasingType } from '@/types/keyframe'
import {
  easeProgress,
  localFrameAtSourceFrames,
  maxDurationForMedia,
  normalizeSpeedRamp,
  pruneSpeedRamp,
  shiftSpeedRamp,
  sourceFramesAtLocalFrame,
  sourceSpanFrames,
  speedAtFrame,
  speedRampIntegral,
  speedRampKeysProblem,
  speedRampPreset,
  speedRange,
  type SpeedRampKey,
} from './speed-ramp.mjs'

const linearRamp: SpeedRampKey[] = [
  { frame: 0, speed: 1 },
  { frame: 30, speed: 3 },
]

describe('speed ramp easing', () => {
  it('matches the shared keyframe easing for every type', () => {
    const types: EasingType[] = [
      'linear',
      'ease-in',
      'ease-out',
      'ease-in-out',
      'hold',
      'cubic-bezier',
      'spring',
    ]
    for (const type of types) {
      for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        expect(easeProgress(t, type)).toBeCloseTo(applyEasing(t, type), 12)
      }
    }
    const bezier = { type: 'cubic-bezier' as const, bezier: { x1: 0.2, y1: 0.8, x2: 0.3, y2: 1 } }
    const spring = { type: 'spring' as const, spring: { tension: 120, friction: 14, mass: 1 } }
    for (const t of [0.1, 0.4, 0.7]) {
      expect(easeProgress(t, 'linear', bezier)).toBeCloseTo(applyEasingConfig(t, bezier), 12)
      expect(easeProgress(t, 'linear', spring)).toBeCloseTo(applyEasingConfig(t, spring), 12)
    }
  })
})

describe('speed ramp time map', () => {
  it('integrates a linear ramp exactly (area of the trapezoid)', () => {
    const integral = speedRampIntegral(linearRamp)
    expect(integral.at(0)).toBe(0)
    expect(integral.at(30)).toBeCloseTo(60, 9) // (1 + 3) / 2 * 30
    expect(integral.at(15)).toBeCloseTo(22.5, 9) // (1 + 2) / 2 * 15
    // Held after the last key and before the first.
    expect(integral.at(40)).toBeCloseTo(90, 9)
    expect(integral.at(-10)).toBeCloseTo(-10, 9)
  })

  it('is the constant speed with no keys', () => {
    const item = { speed: 2, sourceFps: 60, durationInFrames: 30 }
    expect(sourceFramesAtLocalFrame(item, 30, 30)).toBe(120)
    expect(localFrameAtSourceFrames(item, 120, 30)).toBe(30)
  })

  it('converts to source fps and inverts', () => {
    const item = { speed: 1, sourceFps: 60, durationInFrames: 30, speedRamp: linearRamp }
    expect(sourceSpanFrames(item, 30)).toBeCloseTo(120, 9)
    for (const frame of [0, 1, 7.5, 15, 29, 30, 45, -5]) {
      const source = sourceFramesAtLocalFrame(item, frame, 30)
      expect(localFrameAtSourceFrames(item, source, 30)).toBeCloseTo(frame, 6)
    }
  })

  it('round-trips through eased segments and holds', () => {
    const keys = normalizeSpeedRamp([
      { frame: 0, speed: 0.5, easing: 'ease-in' },
      { frame: 20, speed: 4, easing: 'hold' },
      { frame: 35, speed: 0.25, easing: 'ease-in-out' },
      { frame: 60, speed: 2 },
    ])
    const integral = speedRampIntegral(keys)
    let previous = -Infinity
    for (let frame = -10; frame <= 70; frame += 0.5) {
      const value = integral.at(frame)
      expect(value).toBeGreaterThan(previous)
      previous = value
      expect(integral.inverse(value)).toBeCloseTo(frame, 6)
    }
    // A hold segment plays at its first key's speed until the next key.
    expect(integral.at(35) - integral.at(20)).toBeCloseTo(15 * 4, 6)
    // ease-in: integral of 0.5 + 3.5 t^2 over 20 frames = 20 * (0.5 + 3.5 / 3)
    expect(integral.at(20)).toBeCloseTo(20 * (0.5 + 3.5 / 3), 6)
  })

  it('handles a single key and keys outside the clip', () => {
    expect(speedRampIntegral([{ frame: 10, speed: 2 }]).at(30)).toBeCloseTo(60, 9)
    const shifted = shiftSpeedRamp(linearRamp, -15) // the right half of a split at 15
    const item = { durationInFrames: 15, speedRamp: shifted }
    expect(sourceFramesAtLocalFrame(item, 15, 30)).toBeCloseTo(60 - 22.5, 9)
    expect(speedAtFrame(shifted, 0)).toBeCloseTo(2, 9)
  })

  it('prunes keys that cannot shape the clip', () => {
    const keys = [
      { frame: -40, speed: 1 },
      { frame: -10, speed: 2 },
      { frame: 5, speed: 3 },
      { frame: 50, speed: 4 },
      { frame: 90, speed: 1 },
    ]
    expect(pruneSpeedRamp(keys, 30).map((key) => key.frame)).toEqual([-10, 5, 50])
  })

  it('reports the speed range and the longest clip the media allows', () => {
    const item = { durationInFrames: 30, speedRamp: linearRamp, sourceFps: 30 }
    expect(speedRange(item)).toEqual({ min: 1, max: 3 })
    // 60 source frames after sourceStart are used at frame 30; with 40 left,
    // the clip can run until the integral reaches 40: t + t^2 / 30 = 40.
    const t = (-1 + Math.sqrt(1 + (4 * 40) / 30)) / (2 / 30)
    expect(maxDurationForMedia(item, 0, 40, 30)).toBe(Math.floor(t))
  })
})

describe('speed ramp keys and presets', () => {
  it('validates op keys', () => {
    expect(speedRampKeysProblem(linearRamp, 30)).toBeNull()
    expect(speedRampKeysProblem([{ frame: 31, speed: 1 }], 30)).toMatch(/outside the clip/)
    expect(speedRampKeysProblem([{ frame: 0, speed: 40 }], 30)).toMatch(/outside 0.1..16/)
    expect(speedRampKeysProblem([{ frame: 1.5, speed: 1 }], 30)).toMatch(/whole frame/)
    expect(
      speedRampKeysProblem(
        [
          { frame: 2, speed: 1 },
          { frame: 2, speed: 2 },
        ],
        30,
      ),
    ).toMatch(/share a frame/)
  })

  it('builds the editorial presets inside the clip', () => {
    for (const name of ['ease-in', 'ease-out', 'hero', 'whip']) {
      const keys = speedRampPreset(name, { durationInFrames: 90 })
      expect(speedRampKeysProblem(keys, 90)).toBeNull()
      expect(keys[0]!.frame).toBe(0)
      expect(keys.at(-1)!.frame).toBe(90)
    }
    const hero = speedRampPreset('hero', { durationInFrames: 90, frame: 30, speed: 0.25 })
    expect(speedAtFrame(hero, 30)).toBeCloseTo(0.25, 9)
    expect(speedAtFrame(hero, 0)).toBe(2)
    expect(speedAtFrame(hero, 90)).toBe(2)
    const whip = speedRampPreset('whip', { durationInFrames: 60, speed: 5 })
    expect(speedAtFrame(whip, 30)).toBe(5)
    expect(speedAtFrame(whip, 0)).toBe(1)
    expect(() => speedRampPreset('zoom', { durationInFrames: 10 })).toThrow(/Unknown speed ramp/)
  })
})
