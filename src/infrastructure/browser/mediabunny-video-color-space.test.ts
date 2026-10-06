import { describe, expect, it, vi } from 'vite-plus/test'
import { applyBitstreamColorSpace } from './mediabunny-video-color-space'

// libx264 avcC for yuvj420p tagged bt470bg/pc only in the SPS (no `colr` box).
const BT601_FULL_AVCC =
  '0164000affe1001b6764000aacd94426c05b810102a0000003002000000781e244b2c001000668ebe3cb22c0fdf8f800'
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))

describe('applyBitstreamColorSpace', () => {
  it('makes the track report the bitstream colour space, once per track', async () => {
    const getDecoderConfig = vi.fn(
      async (): Promise<VideoDecoderConfig | null> => ({
        codec: 'avc1.64000a',
        description: bytes(BT601_FULL_AVCC),
      }),
    )
    const track = { getDecoderConfig }
    expect(applyBitstreamColorSpace(track)).toBe(track)
    applyBitstreamColorSpace(track)
    const [first, second] = await Promise.all([track.getDecoderConfig(), track.getDecoderConfig()])
    expect(first?.colorSpace).toEqual({
      fullRange: true,
      matrix: 'bt470bg',
      primaries: 'bt709',
      transfer: 'bt709',
    })
    expect(second).toBe(first)
    expect(getDecoderConfig).toHaveBeenCalledTimes(1)
  })

  it('passes a missing config through', async () => {
    const track = applyBitstreamColorSpace({ getDecoderConfig: async () => null })
    expect(await track.getDecoderConfig()).toBeNull()
  })
})
