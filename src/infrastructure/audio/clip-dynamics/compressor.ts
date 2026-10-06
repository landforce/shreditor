import type { ResolvedAudioCompressorSettings } from '@/types/audio'
import {
  dbToGain,
  gainToDb,
  linkedPeak,
  timeCoefficient,
  type ClipStreamProcessor,
} from './dsp-math'

/**
 * Static gain-reduction curve (dB, >= 0) of a soft-knee compressor for an
 * input level `levelDb`.
 */
export function compressorGainReductionDb(
  levelDb: number,
  settings: Pick<ResolvedAudioCompressorSettings, 'thresholdDb' | 'ratio' | 'kneeDb'>,
): number {
  const slope = 1 - 1 / settings.ratio
  const over = levelDb - settings.thresholdDb
  const knee = settings.kneeDb
  if (knee > 0 && Math.abs(over) <= knee / 2) {
    const kneeOver = over + knee / 2
    return (slope * kneeOver * kneeOver) / (2 * knee)
  }
  return over > 0 ? slope * over : 0
}

/**
 * Feed-forward, stereo-linked peak compressor with make-up gain. Gain
 * reduction goes through a smooth decoupled peak detector (log domain): a
 * release-only peak hold, then attack smoothing, so a steady tone settles at
 * the static curve instead of rippling between its peaks. Zero latency.
 */
export class ClipCompressor implements ClipStreamProcessor {
  readonly latency = 0
  private settings: ResolvedAudioCompressorSettings
  private attackCoef = 0
  private releaseCoef = 0
  private makeupGain = 1
  private heldDb = 0
  private envelopeDb = 0

  constructor(
    private readonly sampleRate: number,
    settings: ResolvedAudioCompressorSettings,
  ) {
    this.settings = settings
    this.configure(settings)
  }

  configure(settings: ResolvedAudioCompressorSettings): void {
    this.settings = settings
    this.attackCoef = timeCoefficient(settings.attackMs, this.sampleRate)
    this.releaseCoef = timeCoefficient(settings.releaseMs, this.sampleRate)
    this.makeupGain = dbToGain(settings.makeupDb)
  }

  process(input: readonly Float32Array[], output: Float32Array[], frames: number): void {
    for (let i = 0; i < frames; i++) {
      const target = compressorGainReductionDb(gainToDb(linkedPeak(input, i)), this.settings)
      const released = this.releaseCoef * this.heldDb + (1 - this.releaseCoef) * target
      this.heldDb = Math.max(target, released)
      this.envelopeDb = this.attackCoef * this.envelopeDb + (1 - this.attackCoef) * this.heldDb
      const gain = dbToGain(-this.envelopeDb) * this.makeupGain
      for (let c = 0; c < output.length; c++) {
        output[c]![i] = (input[c]?.[i] ?? 0) * gain
      }
    }
  }
}
