import { describe, expect, it } from 'vite-plus/test'
import { sourceFramesAtLocalFrame } from '@/shared/timeline/speed-ramp.mjs'
import { getSpeedRampSourceSecondsAt, sourceOffsetSeconds } from './speed-ramp-source-time'

describe('getSpeedRampSourceSecondsAt', () => {
  it('is undefined for a clip without a ramp, so callers keep their linear mapping', () => {
    expect(getSpeedRampSourceSecondsAt({ speed: 2 }, 30)).toBeUndefined()
    expect(getSpeedRampSourceSecondsAt({ speed: 1, speedRamp: [] }, 30)).toBeUndefined()
  })

  it('maps timeline seconds through the ramp integral', () => {
    // 1x rising to 3x over 60 frames (2 s at 30 fps).
    const item = {
      speed: 1,
      sourceFps: 30,
      speedRamp: [
        { frame: 0, speed: 1 },
        { frame: 60, speed: 3 },
      ],
    }
    const at = getSpeedRampSourceSecondsAt(item, 30)!
    expect(at(0)).toBeCloseTo(0)
    // First second: (1 + 2) / 2 = 1.5 source seconds.
    expect(at(1)).toBeCloseTo(1.5)
    // Two seconds: (1 + 3) / 2 * 2 = 4.
    expect(at(2)).toBeCloseTo(4)
    // Held at 3x after the last key.
    expect(at(3)).toBeCloseTo(7)
  })

  it('agrees with the shared time map for a different source frame rate', () => {
    const item = {
      sourceFps: 60,
      speedRamp: [
        { frame: 0, speed: 0.5, easing: 'ease-in' as const },
        { frame: 45, speed: 2 },
      ],
    }
    const at = getSpeedRampSourceSecondsAt(item, 30)!
    for (const seconds of [0.25, 0.9, 1.4, 2]) {
      expect(at(seconds)).toBeCloseTo(sourceFramesAtLocalFrame(item, seconds * 30, 30) / 60, 9)
    }
  })
})

describe('sourceOffsetSeconds', () => {
  it('is the constant-speed product without a ramp', () => {
    expect(sourceOffsetSeconds(1.5, 2)).toBe(3)
  })

  it('uses the ramp time map when given', () => {
    expect(sourceOffsetSeconds(1.5, 2, (seconds) => seconds + 10)).toBe(11.5)
  })
})
