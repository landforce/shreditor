/** Small numeric helpers shared by the clip dynamics processors. */

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export function gainToDb(gain: number): number {
  return gain > 1e-9 ? 20 * Math.log10(gain) : -180
}

/** One-pole smoothing coefficient reaching ~63% of a step in `ms` milliseconds. */
export function timeCoefficient(ms: number, sampleRate: number): number {
  const samples = (Math.max(0.01, ms) / 1000) * sampleRate
  return Math.exp(-1 / Math.max(1, samples))
}

/** Peak magnitude of sample `index` across all channels (stereo-linked detection). */
export function linkedPeak(channels: readonly Float32Array[], index: number): number {
  let peak = 0
  for (const channel of channels) {
    const magnitude = Math.abs(channel[index] ?? 0)
    if (magnitude > peak) peak = magnitude
  }
  return peak
}

/**
 * A streaming processor transforms `frames` samples of `input` into `output`
 * (which may be the same arrays). `latency` is the fixed delay, in samples, it
 * introduces; offline callers compensate for it, the realtime preview cannot.
 */
export interface ClipStreamProcessor {
  readonly latency: number
  process(input: readonly Float32Array[], output: Float32Array[], frames: number): void
}

/**
 * Run a streaming processor over whole buffers with its latency removed, so the
 * result lines up sample-for-sample with the input. This is how export uses
 * exactly the same processor code the preview worklet runs.
 */
export function runStreamProcessorOffline(
  processor: ClipStreamProcessor,
  channels: readonly Float32Array[],
): Float32Array[] {
  const length = channels[0]?.length ?? 0
  const latency = processor.latency
  const output = channels.map(() => new Float32Array(length))
  const blockSize = 1024
  const inBlock = channels.map(() => new Float32Array(blockSize))
  const outBlock = channels.map(() => new Float32Array(blockSize))
  const total = length + latency
  for (let start = 0; start < total; start += blockSize) {
    const frames = Math.min(blockSize, total - start)
    channels.forEach((channel, c) => {
      const block = inBlock[c]!
      block.fill(0)
      if (start < length) block.set(channel.subarray(start, Math.min(length, start + frames)))
    })
    processor.process(inBlock, outBlock, frames)
    copyCompensatedBlock(outBlock, output, start - latency, frames)
  }
  return output
}

function copyCompensatedBlock(
  block: readonly Float32Array[],
  output: Float32Array[],
  writeStart: number,
  frames: number,
): void {
  const length = output[0]?.length ?? 0
  const from = Math.max(0, -writeStart)
  const to = Math.min(frames, length - writeStart)
  if (to <= from) return
  block.forEach((channel, c) => {
    output[c]!.set(channel.subarray(from, to), writeStart + from)
  })
}
