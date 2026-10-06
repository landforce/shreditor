/**
 * Streaming sample-rate converter using 4-point Catmull-Rom (cubic Hermite)
 * interpolation. Used only to carry the denoiser's wet path to RNNoise's fixed
 * 48 kHz and back when the clip runs at another rate. Delay: two input samples.
 */
export class StreamResampler {
  private readonly step: number
  private phase = 0
  private x0 = 0
  private x1 = 0
  private x2 = 0
  private x3 = 0

  constructor(inputRate: number, outputRate: number) {
    this.step = inputRate / outputRate
  }

  /** Push one input sample; calls `emit` for each output sample it completes. */
  push(sample: number, emit: (value: number) => void): void {
    this.x0 = this.x1
    this.x1 = this.x2
    this.x2 = this.x3
    this.x3 = sample
    while (this.phase < 1) {
      emit(this.interpolate(this.phase))
      this.phase += this.step
    }
    this.phase -= 1
  }

  private interpolate(t: number): number {
    const { x0, x1, x2, x3 } = this
    const a = -0.5 * x0 + 1.5 * x1 - 1.5 * x2 + 0.5 * x3
    const b = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3
    const c = -0.5 * x0 + 0.5 * x2
    return ((a * t + b) * t + c) * t + x1
  }
}
