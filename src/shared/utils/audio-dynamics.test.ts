import { describe, expect, it } from 'vitest'
import { areAudioDynamicsEqual, hasAudioDynamics, resolveAudioDynamics } from './audio-dynamics'

describe('resolveAudioDynamics', () => {
  it('is null when no stage is enabled (existing projects are untouched)', () => {
    expect(resolveAudioDynamics({})).toBeNull()
    expect(resolveAudioDynamics(undefined)).toBeNull()
    expect(
      resolveAudioDynamics({
        audioDenoise: { enabled: false, amount: 50 },
        audioLimiter: null,
      }),
    ).toBeNull()
    expect(hasAudioDynamics({ audioCompressor: { enabled: false } })).toBe(false)
  })

  it('fills defaults for enabled stages and leaves the others off', () => {
    expect(resolveAudioDynamics({ audioDenoise: { enabled: true } })).toEqual({
      denoise: { amount: 90 },
      compressor: null,
      deEsser: null,
      limiter: null,
    })
    const all = resolveAudioDynamics({
      audioCompressor: { enabled: true },
      audioDeEsser: { enabled: true },
      audioLimiter: { enabled: true },
    })
    expect(all?.compressor).toEqual({
      thresholdDb: -18,
      ratio: 3,
      attackMs: 10,
      releaseMs: 150,
      makeupDb: 0,
      kneeDb: 6,
    })
    expect(all?.deEsser).toEqual({ frequencyHz: 6000, thresholdDb: -30, maxReductionDb: 8 })
    expect(all?.limiter).toEqual({ ceilingDb: -1, releaseMs: 60 })
  })

  it('clamps out-of-range stored values instead of trusting them', () => {
    const resolved = resolveAudioDynamics({
      audioCompressor: { enabled: true, ratio: 400, thresholdDb: -100 },
    })
    expect(resolved?.compressor?.ratio).toBe(20)
    expect(resolved?.compressor?.thresholdDb).toBe(-60)
  })

  it('compares resolved chains by value', () => {
    const left = resolveAudioDynamics({ audioLimiter: { enabled: true, ceilingDb: -2 } })
    const same = resolveAudioDynamics({ audioLimiter: { enabled: true, ceilingDb: -2 } })
    const other = resolveAudioDynamics({ audioLimiter: { enabled: true, ceilingDb: -3 } })
    expect(areAudioDynamicsEqual(left, same)).toBe(true)
    expect(areAudioDynamicsEqual(left, other)).toBe(false)
    expect(areAudioDynamicsEqual(left, null)).toBe(false)
    expect(areAudioDynamicsEqual(null, undefined)).toBe(true)
  })
})
