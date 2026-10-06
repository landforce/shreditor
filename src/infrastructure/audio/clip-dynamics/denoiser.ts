import type { ResolvedAudioDenoiseSettings } from '@/types/audio'
import type { ClipStreamProcessor } from './dsp-math'
import { StreamResampler } from './stream-resampler'

/** RNNoise works on 10 ms frames of 480 samples at 48 kHz, in 16-bit PCM scale. */
export const DENOISE_FRAME_SIZE = 480
const DENOISE_SAMPLE_RATE = 48000
const PCM_SCALE = 32768
/** Headroom so the resampled output queue never runs dry on non-integer frame ratios. */
const RESAMPLED_QUEUE_MARGIN = 8
const RESAMPLER_DELAY_SAMPLES = 2

/** Denoises one 480-sample frame in place (16-bit PCM scale). */
export interface DenoiseFrameProcessor {
  process(frame: Float32Array): void
  dispose(): void
}

/**
 * A frame-based denoising model. `frameDelay` is its own algorithmic delay in
 * 48 kHz samples on top of the framing (RNNoise: 960, i.e. its output frame
 * belongs to the input two frames back).
 */
export interface DenoiseModel {
  frameDelay: number
  createFrameProcessor(): DenoiseFrameProcessor
}

/** Fixed-capacity FIFO of samples. */
class SampleQueue {
  private readonly buffer: Float32Array
  private readIndex = 0
  private count: number

  constructor(capacity: number, prefill: number) {
    this.buffer = new Float32Array(capacity)
    this.count = Math.min(prefill, capacity)
  }

  push(value: number): void {
    if (this.count === this.buffer.length) return
    this.buffer[(this.readIndex + this.count) % this.buffer.length] = value
    this.count++
  }

  shift(): number {
    if (this.count === 0) return 0
    const value = this.buffer[this.readIndex]!
    this.readIndex = (this.readIndex + 1) % this.buffer.length
    this.count--
    return value
  }
}

function getWetLatency(
  sampleRate: number,
  frameDelay: number,
): { prefill: number; latency: number } {
  if (sampleRate === DENOISE_SAMPLE_RATE) {
    return { prefill: DENOISE_FRAME_SIZE, latency: DENOISE_FRAME_SIZE + frameDelay }
  }
  const ratio = sampleRate / DENOISE_SAMPLE_RATE
  const prefill = Math.ceil(DENOISE_FRAME_SIZE * ratio) + RESAMPLED_QUEUE_MARGIN
  const resamplerDelay = RESAMPLER_DELAY_SAMPLES + Math.round(RESAMPLER_DELAY_SAMPLES * ratio)
  return { prefill, latency: prefill + resamplerDelay + Math.round(frameDelay * ratio) }
}

/** One channel: optional resample to 48 kHz, RNNoise framing, resample back. */
class DenoiseLane {
  private readonly frame = new Float32Array(DENOISE_FRAME_SIZE)
  private framePosition = 0
  private readonly queue: SampleQueue
  private readonly toModelRate: StreamResampler | null
  private readonly fromModelRate: StreamResampler | null
  private readonly enqueue = (value: number) => this.queue.push(value)
  private readonly emitModelSample = (value: number) => {
    if (this.fromModelRate) this.fromModelRate.push(value, this.enqueue)
    else this.queue.push(value)
  }
  private readonly acceptModelSample = (value: number) => this.addToFrame(value)

  constructor(
    sampleRate: number,
    prefill: number,
    private readonly frameProcessor: DenoiseFrameProcessor,
  ) {
    const resample = sampleRate !== DENOISE_SAMPLE_RATE
    this.toModelRate = resample ? new StreamResampler(sampleRate, DENOISE_SAMPLE_RATE) : null
    this.fromModelRate = resample ? new StreamResampler(DENOISE_SAMPLE_RATE, sampleRate) : null
    this.queue = new SampleQueue(prefill * 4 + DENOISE_FRAME_SIZE * 4, prefill)
  }

  private addToFrame(value: number): void {
    this.frame[this.framePosition++] = value * PCM_SCALE
    if (this.framePosition < DENOISE_FRAME_SIZE) return
    this.framePosition = 0
    this.frameProcessor.process(this.frame)
    for (let i = 0; i < DENOISE_FRAME_SIZE; i++) {
      this.emitModelSample(this.frame[i]! / PCM_SCALE)
    }
  }

  /** Push one input sample, return the wet (denoised) sample `latency` samples back. */
  next(sample: number): number {
    if (this.toModelRate) this.toModelRate.push(sample, this.acceptModelSample)
    else this.addToFrame(sample)
    return this.queue.shift()
  }

  dispose(): void {
    this.frameProcessor.dispose()
  }
}

/**
 * RNNoise noise reduction with a wet/dry `amount`. The dry signal is delayed by
 * the wet path's latency so partial amounts mix without comb filtering. Fully
 * silent input skips the model (paused clips cost nothing).
 */
export class ClipDenoiser implements ClipStreamProcessor {
  readonly latency: number
  private readonly prefill: number
  private lanes: DenoiseLane[] = []
  private dryLines: Float32Array[] = []
  private dryIndex = 0
  private wetMix = 1
  private silentRun = 0

  constructor(
    private readonly sampleRate: number,
    settings: ResolvedAudioDenoiseSettings,
    private readonly model: DenoiseModel,
  ) {
    const { prefill, latency } = getWetLatency(sampleRate, model.frameDelay)
    this.prefill = prefill
    this.latency = latency
    this.configure(settings)
  }

  configure(settings: ResolvedAudioDenoiseSettings): void {
    this.wetMix = Math.min(1, Math.max(0, settings.amount / 100))
  }

  private ensureChannels(count: number): void {
    while (this.lanes.length < count) {
      this.lanes.push(
        new DenoiseLane(this.sampleRate, this.prefill, this.model.createFrameProcessor()),
      )
      this.dryLines.push(new Float32Array(this.latency + 1))
    }
  }

  private isSilentBlock(input: readonly Float32Array[], frames: number): boolean {
    for (const channel of input) {
      for (let i = 0; i < frames; i++) if (channel[i] !== 0) return false
    }
    return true
  }

  process(input: readonly Float32Array[], output: Float32Array[], frames: number): void {
    const silent = this.isSilentBlock(input, frames)
    this.silentRun = silent ? this.silentRun + frames : 0
    if (silent && this.silentRun > this.latency + 2 * DENOISE_FRAME_SIZE) {
      for (const channel of output) channel.fill(0, 0, frames)
      return
    }
    const channelCount = output.length
    this.ensureChannels(channelCount)
    const size = this.latency + 1
    const dryMix = 1 - this.wetMix
    for (let i = 0; i < frames; i++) {
      const readIndex = (this.dryIndex + 1) % size
      for (let c = 0; c < channelCount; c++) {
        const sample = input[c]?.[i] ?? 0
        const dryLine = this.dryLines[c]!
        dryLine[this.dryIndex] = sample
        const wet = this.lanes[c]!.next(sample)
        output[c]![i] = wet * this.wetMix + dryLine[readIndex]! * dryMix
      }
      this.dryIndex = readIndex
    }
  }

  dispose(): void {
    for (const lane of this.lanes) lane.dispose()
    this.lanes = []
  }
}
