import { describe, expect, it } from 'vite-plus/test'
import {
  firstSpsFromAvcC,
  parseAvcSpsVideoSignalType,
  withAvcBitstreamColorSpace,
} from './avc-color-space'

// avcC records from libx264 (ffmpeg) MP4s, which have no `colr` box.
const AVCC = {
  noSignalType: '0142c00affe100176742c00ad90426c044000003000400000300f03c48992001000568cb83cb20',
  // yuvj420p, -colorspace bt470bg -color_range pc (phone-style full-range BT.601)
  bt601Full:
    '0164000affe1001b6764000aacd94426c05b810102a0000003002000000781e244b2c001000668ebe3cb22c0fdf8f800',
  // -colorspace bt709 -color_range tv (primaries/transfer unspecified)
  bt709Limited:
    '0164000affe1001b6764000aacd94426c05a810100a0000003002000000781e244b2c001000668ebe3cb22c0fdf8f800',
  // High 10, BT.2020 matrix
  hdr: '016e000affe1001c676e000aa6cd94426c05a810104a000003000200000300781e244b2c01000668ebe3cb22c0fdfafa00',
  // High 4:4:4 with scaling matrices (cqm=jvt), smpte170m limited
  highProfile444ScalingLists:
    '01f4000affe1001c67f4000a919b2884d80b50202064000003000400000300f03c48965801000868ebe3c44c000440fff8f800',
}

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))
const signalOf = (hex: string) => parseAvcSpsVideoSignalType(firstSpsFromAvcC(bytes(hex))!)
const config = (hex: string, extra: Partial<VideoDecoderConfig> = {}): VideoDecoderConfig => ({
  codec: 'avc1.64000a',
  description: bytes(hex),
  ...extra,
})

describe('parseAvcSpsVideoSignalType', () => {
  it('reads range and colour description from the SPS VUI', () => {
    expect(signalOf(AVCC.bt601Full)).toEqual({
      fullRange: true,
      colourPrimaries: 2,
      transferCharacteristics: 2,
      matrixCoefficients: 5,
    })
    expect(signalOf(AVCC.bt709Limited)).toEqual({
      fullRange: false,
      colourPrimaries: 2,
      transferCharacteristics: 2,
      matrixCoefficients: 1,
    })
    expect(signalOf(AVCC.hdr)).toMatchObject({ matrixCoefficients: 9 })
    expect(signalOf(AVCC.highProfile444ScalingLists)).toMatchObject({
      fullRange: false,
      matrixCoefficients: 6,
    })
  })

  it('returns null without a video signal type or for a non-SPS unit', () => {
    expect(signalOf(AVCC.noSignalType)).toBeNull()
    expect(parseAvcSpsVideoSignalType(Uint8Array.of(0x68, 0xce))).toBeNull()
    expect(parseAvcSpsVideoSignalType(Uint8Array.of(0x67, 0x64))).toBeNull()
  })
})

describe('withAvcBitstreamColorSpace', () => {
  it('gives full-range BT.601 footage its real matrix and range, fully specified', () => {
    expect(withAvcBitstreamColorSpace(config(AVCC.bt601Full)).colorSpace).toEqual({
      fullRange: true,
      matrix: 'bt470bg',
      primaries: 'bt709',
      transfer: 'bt709',
    })
  })

  it('states BT.709 limited for BT.709 limited footage (the decoder default)', () => {
    expect(withAvcBitstreamColorSpace(config(AVCC.bt709Limited)).colorSpace).toEqual({
      fullRange: false,
      matrix: 'bt709',
      primaries: 'bt709',
      transfer: 'bt709',
    })
  })

  it('leaves HDR, untagged, non-H.264 and container-tagged configs alone', () => {
    for (const unchanged of [
      config(AVCC.hdr),
      config(AVCC.noSignalType),
      config(AVCC.bt601Full, { codec: 'hvc1.1.6.L93.B0' }),
      config(AVCC.bt601Full, { colorSpace: { matrix: 'bt709', fullRange: false } }),
    ]) {
      expect(withAvcBitstreamColorSpace(unchanged)).toBe(unchanged)
    }
  })

  it('keeps fields the container gave and fills the rest from the bitstream', () => {
    expect(
      withAvcBitstreamColorSpace(config(AVCC.bt601Full, { colorSpace: { primaries: 'smpte170m' } }))
        .colorSpace,
    ).toEqual({ fullRange: true, matrix: 'bt470bg', primaries: 'smpte170m', transfer: 'bt709' })
  })
})
