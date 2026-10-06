import type { ResolvedAudioLimiterSettings } from '@/types/audio'
import { dbToGain, timeCoefficient, type ClipStreamProcessor } from './dsp-math'

const LIMITER_LOOKAHEAD_MS = 1.5
/** Samples the inter-sample peak estimate needs beyond the lookahead. */
const PEAK_ESTIMATE_DELAY = 2

/** Sliding-window minimum over the last `size` pushed values. */
class SlidingMinimum {
  private readonly values: Float64Array
  private writeIndex = 0
  private minValue = 1
  private minAge = 0

  constructor(private readonly size: number) {
    this.values = new Float64Array(size).fill(1)
  }

  push(value: number): number {
    this.values[this.writeIndex] = value
    this.writeIndex = (this.writeIndex + 1) % this.size
    this.minAge++
    if (value <= this.minValue) {
      this.minValue = value
      this.minAge = 0
    } else if (this.minAge >= this.size) {
      this.rescan()
    }
    return this.minValue
  }

  private rescan(): void {
    let min = Infinity
    let age = 0
    for (let back = 0; back < this.size; back++) {
      const index = (this.writeIndex - 1 - back + this.size) % this.size
      const value = this.values[index]!
      if (value < min) {
        min = value
        age = back
      }
    }
    this.minValue = min
    this.minAge = age
  }
}

/** Per-channel history for the 4-tap half-sample (inter-sample peak) estimate. */
class PeakEstimator {
  private h0 = 0
  private h1 = 0
  private h2 = 0
  private h3 = 0
  private previousMid = 0

  /** Push x[n]; returns the estimated peak magnitude around x[n-2]. */
  push(sample: number): number {
    this.h0 = this.h1
    this.h1 = this.h2
    this.h2 = this.h3
    this.h3 = sample
    const mid = (-this.h0 + 9 * this.h1 + 9 * this.h2 - this.h3) / 16
    const peak = Math.max(Math.abs(this.h1), Math.abs(this.previousMid), Math.abs(mid))
    this.previousMid = mid
    return peak
  }
}

/**
 * Lookahead peak limiter (stereo-linked). The required gain for each sample
 * (ceiling / peak, using a half-sample estimate to catch most inter-sample
 * peaks) goes through a sliding minimum over the lookahead window, an
 * exponential release, and a moving average over the lookahead. Because every
 * average contains only values at or below the gain the delayed sample needs,
 * the output's sample peaks never exceed the ceiling.
 */
export class ClipLimiter implements ClipStreamProcessor {
  readonly latency: number
  private readonly lookahead: number
  private readonly minimum: SlidingMinimum
  private readonly box: Float64Array
  private boxIndex = 0
  private boxSum: number
  private released = 1
  private releaseCoef = 0
  private ceiling = 1
  private inputScale = 1
  private estimators: PeakEstimator[] = []
  private delayLines: Float32Array[] = []
  private delayIndex = 0

  constructor(
    private readonly sampleRate: number,
    settings: ResolvedAudioLimiterSettings,
  ) {
    this.lookahead = Math.max(1, Math.round((LIMITER_LOOKAHEAD_MS / 1000) * sampleRate))
    this.latency = this.lookahead + PEAK_ESTIMATE_DELAY
    this.minimum = new SlidingMinimum(this.lookahead + 1)
    this.box = new Float64Array(this.lookahead).fill(1)
    this.boxSum = this.lookahead
    this.configure(settings)
  }

  configure(settings: ResolvedAudioLimiterSettings): void {
    this.ceiling = dbToGain(settings.ceilingDb)
    this.releaseCoef = timeCoefficient(settings.releaseMs, this.sampleRate)
  }

  /**
   * Gain already applied to the input that is NOT part of the clip (preview
   * master bus and monitor volume). The ceiling scales with it, so limiting is
   * the same as export, where those gains come after the limiter.
   */
  setInputScale(scale: number): void {
    this.inputScale = Math.max(0, scale)
  }

  private ensureChannels(count: number): void {
    while (this.estimators.length < count) {
      this.estimators.push(new PeakEstimator())
      this.delayLines.push(new Float32Array(this.latency + 1))
    }
  }

  private requiredGain(peak: number): number {
    const ceiling = this.ceiling * this.inputScale
    if (ceiling <= 1e-9 || peak <= ceiling) return 1
    return ceiling / peak
  }

  private nextGain(peak: number): number {
    const held = this.minimum.push(this.requiredGain(peak))
    this.released = held < this.released ? held : held - (held - this.released) * this.releaseCoef
    this.boxSum += this.released - this.box[this.boxIndex]!
    this.box[this.boxIndex] = this.released
    this.boxIndex = (this.boxIndex + 1) % this.lookahead
    return Math.min(1, this.boxSum / this.lookahead)
  }

  process(input: readonly Float32Array[], output: Float32Array[], frames: number): void {
    const channelCount = output.length
    this.ensureChannels(channelCount)
    const size = this.latency + 1
    for (let i = 0; i < frames; i++) {
      let peak = 0
      for (let c = 0; c < channelCount; c++) {
        const sample = input[c]?.[i] ?? 0
        peak = Math.max(peak, this.estimators[c]!.push(sample))
        this.delayLines[c]![this.delayIndex] = sample
      }
      const gain = this.nextGain(peak)
      const readIndex = (this.delayIndex + 1) % size
      for (let c = 0; c < channelCount; c++) {
        output[c]![i] = this.delayLines[c]![readIndex]! * gain
      }
      this.delayIndex = readIndex
    }
  }
}
