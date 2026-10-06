import type { ResolvedAudioDeEsserSettings } from '@/types/audio'
import { dbToGain, gainToDb, timeCoefficient, type ClipStreamProcessor } from './dsp-math'

const DE_ESSER_RATIO = 6
const DE_ESSER_ATTACK_MS = 1
const DE_ESSER_RELEASE_MS = 60

/** Second-order Butterworth section (transposed direct form II). */
class ButterworthBiquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private z1 = 0
  private z2 = 0

  constructor(private readonly type: 'lowpass' | 'highpass') {}

  configure(frequencyHz: number, sampleRate: number): void {
    const w0 = (2 * Math.PI * Math.min(frequencyHz, sampleRate * 0.45)) / sampleRate
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2)
    const cos = Math.cos(w0)
    const a0 = 1 + alpha
    const edge = this.type === 'highpass' ? (1 + cos) / 2 : (1 - cos) / 2
    this.b0 = edge / a0
    this.b1 = ((this.type === 'highpass' ? -2 : 2) * edge) / a0
    this.b2 = edge / a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
  }

  next(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

/**
 * Linkwitz-Riley 4th-order crossover for one channel: two cascaded Butterworth
 * sections per side. The low and high outputs are in phase and sum to an
 * all-pass, so with no reduction the magnitude response stays flat.
 */
class CrossoverLR4 {
  private readonly sections = [
    new ButterworthBiquad('lowpass'),
    new ButterworthBiquad('lowpass'),
    new ButterworthBiquad('highpass'),
    new ButterworthBiquad('highpass'),
  ] as const
  low = 0
  high = 0

  configure(frequencyHz: number, sampleRate: number): void {
    for (const section of this.sections) section.configure(frequencyHz, sampleRate)
  }

  split(x: number): void {
    const [low1, low2, high1, high2] = this.sections
    this.low = low2.next(low1.next(x))
    this.high = high2.next(high1.next(x))
  }
}

/**
 * Split-band de-esser: a Linkwitz-Riley crossover at `frequencyHz` splits the
 * signal and only the high band is turned down while its stereo-linked level
 * exceeds the threshold (6:1, capped at `maxReductionDb`). With no reduction
 * the bands sum to a flat (all-pass) response. Zero latency.
 */
export class ClipDeEsser implements ClipStreamProcessor {
  readonly latency = 0
  private crossovers: CrossoverLR4[] = []
  private settings: ResolvedAudioDeEsserSettings
  private envelope = 0
  private readonly attackCoef: number
  private readonly releaseCoef: number

  constructor(
    private readonly sampleRate: number,
    settings: ResolvedAudioDeEsserSettings,
  ) {
    this.settings = settings
    this.attackCoef = timeCoefficient(DE_ESSER_ATTACK_MS, sampleRate)
    this.releaseCoef = timeCoefficient(DE_ESSER_RELEASE_MS, sampleRate)
  }

  configure(settings: ResolvedAudioDeEsserSettings): void {
    this.settings = settings
    for (const crossover of this.crossovers)
      crossover.configure(settings.frequencyHz, this.sampleRate)
  }

  private ensureChannels(count: number): void {
    while (this.crossovers.length < count) {
      const crossover = new CrossoverLR4()
      crossover.configure(this.settings.frequencyHz, this.sampleRate)
      this.crossovers.push(crossover)
    }
  }

  private reductionGain(level: number): number {
    const over = gainToDb(level) - this.settings.thresholdDb
    if (over <= 0) return 1
    const reduction = Math.min(this.settings.maxReductionDb, over * (1 - 1 / DE_ESSER_RATIO))
    return dbToGain(-reduction)
  }

  process(input: readonly Float32Array[], output: Float32Array[], frames: number): void {
    const channelCount = output.length
    this.ensureChannels(channelCount)
    for (let i = 0; i < frames; i++) {
      let peak = 0
      for (let c = 0; c < channelCount; c++) {
        const crossover = this.crossovers[c]!
        crossover.split(input[c]?.[i] ?? 0)
        peak = Math.max(peak, Math.abs(crossover.high))
      }
      const coef = peak > this.envelope ? this.attackCoef : this.releaseCoef
      this.envelope = coef * this.envelope + (1 - coef) * peak
      const gain = this.reductionGain(this.envelope)
      for (let c = 0; c < channelCount; c++) {
        const crossover = this.crossovers[c]!
        output[c]![i] = crossover.low + crossover.high * gain
      }
    }
  }
}
