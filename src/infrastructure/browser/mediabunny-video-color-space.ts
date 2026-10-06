import { withAvcBitstreamColorSpace } from '@/shared/media/avc-color-space'

interface DecoderConfigTrack {
  getDecoderConfig(): Promise<VideoDecoderConfig | null>
}

const applied = new WeakSet<object>()

/**
 * Make the sinks created for this Mediabunny video track decode with the
 * colour space its H.264 bitstream declares when the container has no `colr`
 * box (see avc-color-space.ts); otherwise Chrome decodes full-range BT.601
 * footage as BT.709. Mediabunny's sinks read the config through the track's
 * `getDecoderConfig`, so that one method is wrapped on this instance.
 */
export function applyBitstreamColorSpace<T extends DecoderConfigTrack>(track: T): T {
  if (applied.has(track)) return track
  applied.add(track)
  const original = track.getDecoderConfig.bind(track)
  let config: Promise<VideoDecoderConfig | null> | null = null
  track.getDecoderConfig = () =>
    (config ??= original().then((value) => value && withAvcBitstreamColorSpace(value)))
  return track
}
