import { describe, expect, it } from 'vite-plus/test'
import { speedRampPreset } from '@/shared/timeline/speed-ramp.mjs'
import {
  formatRampSpeed,
  getCombinedSpeedRampRange,
  getSharedSpeedRampState,
  getSpeedRampChoice,
} from './speed-ramp-choices'

const clip = (speedRamp?: ReturnType<typeof speedRampPreset>, durationInFrames = 90) => ({
  durationInFrames,
  speedRamp,
})

describe('getSpeedRampChoice', () => {
  it('is none without a ramp', () => {
    expect(getSpeedRampChoice(clip())).toBe('none')
    expect(getSpeedRampChoice(clip([]))).toBe('none')
  })

  it('recognises each preset built for the clip length, ignoring key ids', () => {
    for (const preset of ['ease-in', 'ease-out', 'hero', 'whip'] as const) {
      const keys = speedRampPreset(preset, { durationInFrames: 90 }).map((key, index) => ({
        ...key,
        id: `k${index}`,
      }))
      expect(getSpeedRampChoice(clip(keys))).toBe(preset)
    }
  })

  it('calls any other curve custom', () => {
    const edited = speedRampPreset('hero', { durationInFrames: 90 }).map((key) =>
      key.frame === 0 ? { ...key, speed: 3 } : key,
    )
    expect(getSpeedRampChoice(clip(edited))).toBe('custom')
    // A preset built for another length is not this clip's preset.
    expect(getSpeedRampChoice(clip(speedRampPreset('whip', { durationInFrames: 60 })))).toBe(
      'custom',
    )
  })
})

describe('getSharedSpeedRampState', () => {
  it('is the shared choice, or mixed when the clips differ', () => {
    const hero = clip(speedRampPreset('hero', { durationInFrames: 90 }))
    expect(getSharedSpeedRampState([])).toBe('none')
    expect(getSharedSpeedRampState([hero, hero])).toBe('hero')
    expect(getSharedSpeedRampState([hero, clip()])).toBe('mixed')
  })
})

describe('getCombinedSpeedRampRange', () => {
  it('spans the ramped clips and skips constant ones', () => {
    expect(getCombinedSpeedRampRange([clip()])).toBeNull()
    const range = getCombinedSpeedRampRange([
      clip(),
      clip(speedRampPreset('hero', { durationInFrames: 90 })),
      clip(speedRampPreset('whip', { durationInFrames: 90 })),
    ])
    expect(range?.min).toBeCloseTo(0.3)
    expect(range?.max).toBeCloseTo(4)
  })
})

describe('formatRampSpeed', () => {
  it('drops trailing zeros and rounds to hundredths', () => {
    expect(formatRampSpeed(2)).toBe('2')
    expect(formatRampSpeed(0.3)).toBe('0.3')
    expect(formatRampSpeed(1.2345)).toBe('1.23')
  })
})
