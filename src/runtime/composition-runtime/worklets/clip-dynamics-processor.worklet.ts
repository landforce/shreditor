/**
 * Preview half of the clip dynamics chain: one node per active stage
 * (denoise, dynamics, limiter), each running the same
 * `ClipDynamicsStageProcessor` export runs offline.
 */
import { ClipDynamicsStageProcessor } from '@/infrastructure/audio/clip-dynamics/clip-dynamics-stage'
import { RNNOISE_MODEL } from '@/infrastructure/audio/clip-dynamics/rnnoise'
import {
  CLIP_DYNAMICS_PROCESSOR_NAME,
  type ClipDynamicsProcessorMessage,
  type ClipDynamicsProcessorOptions,
} from '../utils/clip-dynamics-shared'

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void

declare const sampleRate: number

class ClipDynamicsProcessor extends AudioWorkletProcessor {
  private readonly processor: ClipDynamicsStageProcessor
  private silence: Float32Array[] = []
  private alive = true

  constructor(options?: unknown) {
    super(options)
    const { stage, dynamics, limiterInputScale } = (
      options as { processorOptions: ClipDynamicsProcessorOptions }
    ).processorOptions
    this.processor = new ClipDynamicsStageProcessor(
      stage,
      sampleRate,
      stage === 'denoise' ? RNNOISE_MODEL : undefined,
    )
    this.processor.update(dynamics)
    this.processor.setLimiterInputScale(limiterInputScale)
    this.port.onmessage = (event: MessageEvent<ClipDynamicsProcessorMessage>) => {
      this.handleMessage(event.data)
    }
  }

  private handleMessage(message: ClipDynamicsProcessorMessage): void {
    if (message.type === 'dispose') {
      this.alive = false
      this.processor.dispose()
      return
    }
    this.processor.update(message.dynamics)
    this.processor.setLimiterInputScale(message.limiterInputScale)
  }

  private silentInput(channels: number, frames: number): Float32Array[] {
    if (this.silence.length !== channels || this.silence[0]?.length !== frames) {
      this.silence = Array.from({ length: channels }, () => new Float32Array(frames))
    }
    return this.silence
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    if (!this.alive || !output || output.length === 0) return this.alive
    const frames = output[0]!.length
    const input = inputs[0]?.length ? inputs[0] : this.silentInput(output.length, frames)
    this.processor.process(input, output, frames)
    return true
  }
}

registerProcessor(CLIP_DYNAMICS_PROCESSOR_NAME, ClipDynamicsProcessor)
