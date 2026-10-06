/** Probe results are evidence, not promises of successful playback. */
type Capability = 'supported' | 'unsupported' | 'unknown'

export async function probeFrameDecoding(track: {
  canDecode?: () => Promise<boolean>
}): Promise<Capability> {
  if (!track.canDecode) return 'unknown'
  try {
    return (await track.canDecode()) ? 'supported' : 'unsupported'
  } catch {
    return 'unknown'
  }
}

/** DOM file playback is independent of registered WASM frame decoders. */
export async function probeDomPlayback(config: VideoConfiguration): Promise<Capability> {
  if (typeof navigator === 'undefined' || !navigator.mediaCapabilities) return 'unknown'
  try {
    const result = await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: config })
    return result.supported ? 'supported' : 'unsupported'
  } catch {
    return 'unknown'
  }
}
