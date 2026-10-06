/**
 * The clip dynamics chain is split into three stages because the volume/fade
 * gain and the EQ sit between them:
 *
 *   denoise -> [EQ] -> dynamics (compressor -> de-esser) -> [volume/fades] -> limiter
 *
 * The preview runs each active stage in an AudioWorkletNode
 * (clip-dynamics-processor.worklet.ts) and export runs the very same stage
 * processor over whole buffers (`applyClipDynamicsStageOffline`), so both paths
 * share one implementation.
 */
import type { ResolvedAudioDynamics } from '@/types/audio'
import { ClipCompressor } from './compressor'
import { ClipDeEsser } from './de-esser'
import { ClipDenoiser, type DenoiseModel } from './denoiser'
import { ClipLimiter } from './limiter'
import { runStreamProcessorOffline, type ClipStreamProcessor } from './dsp-math'

export type ClipDynamicsStage = 'denoise' | 'dynamics' | 'limiter'

export function isClipDynamicsStageActive(
  stage: ClipDynamicsStage,
  dynamics: ResolvedAudioDynamics | null | undefined,
): boolean {
  if (!dynamics) return false
  if (stage === 'denoise') return dynamics.denoise !== null
  if (stage === 'limiter') return dynamics.limiter !== null
  return dynamics.compressor !== null || dynamics.deEsser !== null
}

/**
 * One stage of the chain, reconfigurable in place (settings changes keep the
 * envelopes and model state, so dragging a slider does not click).
 */
export class ClipDynamicsStageProcessor implements ClipStreamProcessor {
  private denoiser: ClipDenoiser | null = null
  private compressor: ClipCompressor | null = null
  private deEsser: ClipDeEsser | null = null
  private limiter: ClipLimiter | null = null
  private chain: ClipStreamProcessor[] = []

  constructor(
    readonly stage: ClipDynamicsStage,
    private readonly sampleRate: number,
    private readonly denoiseModel?: DenoiseModel,
  ) {}

  get latency(): number {
    return this.denoiser?.latency ?? this.limiter?.latency ?? 0
  }

  update(dynamics: ResolvedAudioDynamics | null): void {
    if (this.stage === 'denoise') this.updateDenoiser(dynamics?.denoise ?? null)
    else if (this.stage === 'limiter') this.updateLimiter(dynamics?.limiter ?? null)
    else this.updateDynamics(dynamics)
    this.chain = [this.denoiser, this.compressor, this.deEsser, this.limiter].filter(
      (processor): processor is NonNullable<typeof processor> => processor !== null,
    )
  }

  private updateDenoiser(settings: ResolvedAudioDynamics['denoise']): void {
    if (!settings || !this.denoiseModel) {
      this.denoiser?.dispose()
      this.denoiser = null
      return
    }
    if (this.denoiser) this.denoiser.configure(settings)
    else this.denoiser = new ClipDenoiser(this.sampleRate, settings, this.denoiseModel)
  }

  private updateLimiter(settings: ResolvedAudioDynamics['limiter']): void {
    if (!settings) this.limiter = null
    else if (this.limiter) this.limiter.configure(settings)
    else this.limiter = new ClipLimiter(this.sampleRate, settings)
  }

  private updateDynamics(dynamics: ResolvedAudioDynamics | null): void {
    const compressor = dynamics?.compressor ?? null
    const deEsser = dynamics?.deEsser ?? null
    if (!compressor) this.compressor = null
    else if (this.compressor) this.compressor.configure(compressor)
    else this.compressor = new ClipCompressor(this.sampleRate, compressor)
    if (!deEsser) this.deEsser = null
    else if (this.deEsser) this.deEsser.configure(deEsser)
    else this.deEsser = new ClipDeEsser(this.sampleRate, deEsser)
  }

  /** Preview only: see `ClipLimiter.setInputScale`. */
  setLimiterInputScale(scale: number): void {
    this.limiter?.setInputScale(scale)
  }

  process(input: readonly Float32Array[], output: Float32Array[], frames: number): void {
    if (this.chain.length === 0) {
      output.forEach((channel, c) => channel.set((input[c] ?? input[0]!).subarray(0, frames)))
      return
    }
    let source: readonly Float32Array[] = input
    for (const processor of this.chain) {
      processor.process(source, output, frames)
      source = output
    }
  }

  dispose(): void {
    this.denoiser?.dispose()
    this.denoiser = null
  }
}

async function loadDenoiseModel(): Promise<DenoiseModel> {
  const { RNNOISE_MODEL } = await import('./rnnoise')
  return RNNOISE_MODEL
}

/**
 * Export path: run one stage over whole channel buffers, latency-compensated so
 * the output lines up with the input. Returns the input untouched when the
 * stage is off.
 */
export async function applyClipDynamicsStageOffline(
  stage: ClipDynamicsStage,
  channels: Float32Array[],
  sampleRate: number,
  dynamics: ResolvedAudioDynamics | null | undefined,
): Promise<Float32Array[]> {
  if (!isClipDynamicsStageActive(stage, dynamics) || channels.length === 0) return channels
  const model = stage === 'denoise' ? await loadDenoiseModel() : undefined
  const processor = new ClipDynamicsStageProcessor(stage, sampleRate, model)
  processor.update(dynamics ?? null)
  try {
    return runStreamProcessorOffline(processor, channels)
  } finally {
    processor.dispose()
  }
}
