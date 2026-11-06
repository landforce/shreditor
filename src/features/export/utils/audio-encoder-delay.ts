/**
 * Measure an audio encoder's delay (priming) in samples by a round trip: an
 * impulse is encoded with the export's encoder settings, decoded again, and
 * the decoded impulse's position gives the samples the encoder put before the
 * input. Chrome's AAC encoder measures 2112 (44 ms at 48 kHz), Mediabunny's
 * WASM fallback 1024. The browser does not report this anywhere, and it
 * differs between encoders, so it is measured once per settings and cached.
 * Null when it cannot be measured (no WebCodecs decoder, or an implausible
 * result).
 */

import { createLogger } from '@/shared/logging/logger'

const log = createLogger('AudioEncoderDelay')

const IMPULSE_AT = 4800
const PROBE_FRAMES = 4800 * 4
const MAX_PLAUSIBLE_DELAY = 8192

const cache = new Map<string, Promise<number | null>>()

/** Index of the largest absolute value, or -1 when it is below `floor`. */
export function locateImpulse(samples: Float32Array, floor = 0.2): number {
  let best = floor
  let index = -1
  for (let i = 0; i < samples.length; i++) {
    const magnitude = Math.abs(samples[i]!)
    if (magnitude > best) {
      best = magnitude
      index = i
    }
  }
  return index
}

/** Delay from the decoded impulse position, or null when implausible. */
export function encoderDelayFromImpulse(decodedImpulseIndex: number): number | null {
  if (decodedImpulseIndex < 0) return null
  const delay = decodedImpulseIndex - IMPULSE_AT
  return delay >= 0 && delay <= MAX_PLAUSIBLE_DELAY ? delay : null
}

/**
 * Encode the impulse through Mediabunny, which picks the encoder the export
 * itself uses: the browser's AAC encoder where there is one, otherwise the
 * registered WASM fallback (Chrome on Linux has no AAC encoder; that one
 * primes 1024 samples). Probing WebCodecs directly measured nothing there and
 * left those exports a frame late.
 */
async function encodeProbe(config: AudioEncoderConfig) {
  const mb = await import('mediabunny')
  const { numberOfChannels: channels, sampleRate } = config
  const target = new mb.BufferTarget()
  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target })
  const source = new mb.AudioSampleSource({
    codec: config.codec.startsWith('mp4a') ? 'aac' : 'opus',
    bitrate: config.bitrate ?? 192_000,
  })
  output.addAudioTrack(source)
  await output.start()
  const planes = new Float32Array(PROBE_FRAMES * channels)
  for (let channel = 0; channel < channels; channel++) {
    planes[channel * PROBE_FRAMES + IMPULSE_AT] = 0.9
  }
  const sample = new mb.AudioSample({
    format: 'f32-planar',
    sampleRate,
    numberOfChannels: channels,
    timestamp: 0,
    data: planes,
  })
  try {
    await source.add(sample)
  } finally {
    sample.close()
  }
  await output.finalize()

  const input = new mb.Input({
    source: new mb.BufferSource(target.buffer!),
    formats: mb.ALL_FORMATS,
  })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return { chunks: [], decoderConfig: undefined }
    const decoderConfig = (await track.getDecoderConfig()) ?? undefined
    const chunks: EncodedAudioChunk[] = []
    for await (const packet of new mb.EncodedPacketSink(track).packets()) {
      chunks.push(packet.toEncodedAudioChunk())
    }
    return { chunks, decoderConfig }
  } finally {
    input.dispose()
  }
}

async function decodeFirstChannel(
  chunks: EncodedAudioChunk[],
  decoderConfig: AudioDecoderConfig,
): Promise<Float32Array> {
  const parts: Float32Array[] = []
  let failure: unknown = null
  const decoder = new AudioDecoder({
    output: (audio) => {
      const plane = new Float32Array(audio.numberOfFrames)
      audio.copyTo(plane, { planeIndex: 0, format: 'f32-planar' })
      parts.push(plane)
      audio.close()
    },
    error: (error) => {
      failure = error
    },
  })
  try {
    decoder.configure(decoderConfig)
    for (const chunk of chunks) decoder.decode(chunk)
    await decoder.flush()
  } finally {
    if (decoder.state !== 'closed') decoder.close()
  }
  if (failure) throw failure
  const decoded = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    decoded.set(part, at)
    at += part.length
  }
  return decoded
}

async function measure(config: AudioEncoderConfig): Promise<number | null> {
  if (typeof AudioDecoder === 'undefined') return null
  try {
    const { chunks, decoderConfig } = await encodeProbe(config)
    if (!decoderConfig || chunks.length === 0) return null
    const delay = encoderDelayFromImpulse(
      locateImpulse(await decodeFirstChannel(chunks, decoderConfig)),
    )
    log.info('Measured audio encoder delay', { codec: config.codec, delay })
    return delay
  } catch (error) {
    log.warn('Could not measure audio encoder delay', { codec: config.codec, error })
    return null
  }
}

/** Encoder delay in samples for these settings (cached), or null if unknown. */
export function measureAudioEncoderDelay(config: AudioEncoderConfig): Promise<number | null> {
  const key = JSON.stringify(config)
  let pending = cache.get(key)
  if (!pending) {
    pending = measure(config)
    cache.set(key, pending)
  }
  return pending
}
