import { describe, expect, it } from 'vitest'
import type { ResolvedAudioDynamics } from '@/types/audio'
import { compressorGainReductionDb } from './compressor'
import { ClipDenoiser, type DenoiseFrameProcessor, type DenoiseModel } from './denoiser'
import { runStreamProcessorOffline } from './dsp-math'
import {
  ClipDynamicsStageProcessor,
  applyClipDynamicsStageOffline,
  isClipDynamicsStageActive,
} from './clip-dynamics-stage'

const RATE = 48000

function sine(frequencyHz: number, amplitude: number, seconds: number, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / rate)
  }
  return out
}

function peakDb(samples: Float32Array, from = 0): number {
  let peak = 0
  for (let i = from; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!))
  return 20 * Math.log10(peak)
}

function rmsDb(samples: Float32Array, from = 0): number {
  let sum = 0
  for (let i = from; i < samples.length; i++) sum += samples[i]! ** 2
  return 10 * Math.log10(sum / (samples.length - from))
}

function dynamics(partial: Partial<ResolvedAudioDynamics>): ResolvedAudioDynamics {
  return { denoise: null, compressor: null, deEsser: null, limiter: null, ...partial }
}

const identityModel: DenoiseModel = {
  frameDelay: 0,
  createFrameProcessor: () => ({ process() {}, dispose() {} }),
}

/** A model that, like RNNoise, returns the frame from two frames back. */
function delayedModel(): DenoiseModel {
  return {
    frameDelay: 960,
    createFrameProcessor: () => {
      const history: Float32Array[] = [new Float32Array(480), new Float32Array(480)]
      return {
        process(frame) {
          history.push(frame.slice())
          frame.set(history.shift()!)
        },
        dispose() {},
      }
    },
  }
}

describe('compressorGainReductionDb', () => {
  const settings = { thresholdDb: -18, ratio: 4, kneeDb: 6 }
  it('is zero below the knee and (1 - 1/ratio) * overshoot above it', () => {
    expect(compressorGainReductionDb(-30, settings)).toBe(0)
    expect(compressorGainReductionDb(-6, settings)).toBeCloseTo(9, 6)
  })
  it('is continuous through the soft knee', () => {
    expect(compressorGainReductionDb(-21, settings)).toBeCloseTo(0, 6)
    expect(compressorGainReductionDb(-15, settings)).toBeCloseTo(2.25, 6)
    expect(compressorGainReductionDb(-18, settings)).toBeCloseTo(0.5625, 6)
  })
})

describe('clip dynamics stages', () => {
  it('reports which stages are active', () => {
    const limiterOnly = dynamics({ limiter: { ceilingDb: -1, releaseMs: 60 } })
    expect(isClipDynamicsStageActive('limiter', limiterOnly)).toBe(true)
    expect(isClipDynamicsStageActive('dynamics', limiterOnly)).toBe(false)
    expect(isClipDynamicsStageActive('denoise', null)).toBe(false)
  })

  it('compresses a steady -6 dBFS tone by the static curve plus make-up', async () => {
    const input = sine(1000, 10 ** (-6 / 20), 1)
    const [out] = await applyClipDynamicsStageOffline(
      'dynamics',
      [input],
      RATE,
      dynamics({
        compressor: {
          thresholdDb: -18,
          ratio: 4,
          attackMs: 5,
          releaseMs: 100,
          makeupDb: 2,
          kneeDb: 6,
        },
      }),
    )
    const settled = RATE / 2
    // Peak detection on a sine: reduction follows the peak level (-6 dB -> 9 dB).
    expect(peakDb(out!, settled) - peakDb(input, settled)).toBeCloseTo(-9 + 2, 0)
  })

  it('holds the limiter ceiling on 0 dBFS and +6 dB peaks, with latency removed', async () => {
    const input = sine(220, 2, 0.5)
    for (let i = 0; i < input.length; i += 997) input[i] = (i % 2 ? 1 : -1) * 2
    const [out] = await applyClipDynamicsStageOffline(
      'limiter',
      [input],
      RATE,
      dynamics({ limiter: { ceilingDb: -1, releaseMs: 60 } }),
    )
    expect(peakDb(out!)).toBeLessThanOrEqual(-1 + 1e-4)

    const quiet = sine(220, 0.1, 0.2)
    const [quietOut] = await applyClipDynamicsStageOffline(
      'limiter',
      [quiet],
      RATE,
      dynamics({ limiter: { ceilingDb: -1, releaseMs: 60 } }),
    )
    expect(Array.from(quietOut!)).toEqual(Array.from(quiet))
  })

  it('de-esses only the band above its frequency', async () => {
    const settings = dynamics({
      deEsser: { frequencyHz: 6000, thresholdDb: -30, maxReductionDb: 8 },
    })
    const [low] = await applyClipDynamicsStageOffline(
      'dynamics',
      [sine(300, 0.5, 0.5)],
      RATE,
      settings,
    )
    expect(rmsDb(low!, RATE / 4)).toBeCloseTo(rmsDb(sine(300, 0.5, 0.5), RATE / 4), 1)
    const hiss = sine(10000, 0.5, 0.5)
    const [high] = await applyClipDynamicsStageOffline('dynamics', [hiss], RATE, settings)
    expect(rmsDb(high!, RATE / 4) - rmsDb(hiss, RATE / 4)).toBeLessThan(-6)
  })

  it('aligns the denoiser output with its input at 48 kHz and resampled rates', () => {
    for (const [rate, model] of [
      [48000, identityModel],
      [44100, identityModel],
      [48000, delayedModel()],
      [44100, delayedModel()],
    ] as const) {
      const input = sine(440, 0.5, 0.3, rate)
      const denoiser = new ClipDenoiser(rate, { amount: 100 }, model)
      const [out] = runStreamProcessorOffline(denoiser, [input])
      let maxError = 0
      for (let i = 2000; i < input.length - 2000; i++) {
        maxError = Math.max(maxError, Math.abs(out![i]! - input[i]!))
      }
      expect(maxError, `rate ${rate}, model delay ${model.frameDelay}`).toBeLessThan(0.01)
    }
  })

  it('mixes dry and wet by amount without comb filtering', () => {
    const input = sine(3000, 0.5, 0.3)
    const silenceWet: DenoiseModel = {
      frameDelay: 0,
      createFrameProcessor: (): DenoiseFrameProcessor => ({
        process: (frame) => frame.fill(0),
        dispose() {},
      }),
    }
    const denoiser = new ClipDenoiser(RATE, { amount: 25 }, silenceWet)
    const [out] = runStreamProcessorOffline(denoiser, [input])
    expect(rmsDb(out!, 2000)).toBeCloseTo(rmsDb(input, 2000) + 20 * Math.log10(0.75), 1)
  })

  it('keeps a partial amount comb-free when the model has its own delay', () => {
    const input = sine(2500, 0.5, 0.3)
    const [out] = runStreamProcessorOffline(
      new ClipDenoiser(RATE, { amount: 50 }, delayedModel()),
      [input],
    )
    expect(rmsDb(out!, 4000)).toBeCloseTo(rmsDb(input, 4000), 1)
  })

  it('suppresses steady white noise with the real RNNoise model', async () => {
    let seed = 1
    const noise = new Float32Array(RATE)
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      noise[i] = (seed / 2147483648 - 0.5) * 0.02
    }
    const [out] = await applyClipDynamicsStageOffline(
      'denoise',
      [noise],
      RATE,
      dynamics({ denoise: { amount: 100 } }),
    )
    expect(rmsDb(out!, RATE / 2) - rmsDb(noise, RATE / 2)).toBeLessThan(-20)
  })

  it('passes audio through untouched when its stage has nothing enabled', () => {
    const stage = new ClipDynamicsStageProcessor('dynamics', RATE)
    stage.update(dynamics({ limiter: { ceilingDb: -1, releaseMs: 60 } }))
    const input = [sine(100, 0.5, 0.01)]
    const output = [new Float32Array(input[0]!.length)]
    stage.process(input, output, input[0]!.length)
    expect(Array.from(output[0]!)).toEqual(Array.from(input[0]!))
  })
})
