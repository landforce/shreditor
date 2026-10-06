/**
 * Colour description of an H.264 stream from its SPS VUI.
 *
 * Mediabunny takes a track's colour space only from the container's `colr`
 * box, which many MP4s (ffmpeg output without primaries/transfer tags, a lot
 * of phone footage) do not have: they carry it only in the bitstream. Chrome's
 * VideoDecoder does not take it from there either and labels every frame
 * BT.709 limited unless the decoder config says otherwise, so full-range
 * BT.601 footage decodes with the wrong matrix (visibly yellow-green). This
 * reads `video_signal_type` from the SPS in the `avcC` description so the
 * decoder config can carry the stream's real matrix and range.
 */

export interface AvcVideoSignalType {
  fullRange: boolean
  /** ISO/IEC 23091-2 code points; undefined when the SPS has no colour description. */
  colourPrimaries?: number
  transferCharacteristics?: number
  matrixCoefficients?: number
}

class BitReader {
  private bit = 0
  constructor(private readonly bytes: Uint8Array) {}

  u(count: number): number {
    let value = 0
    for (let i = 0; i < count; i++) {
      const byte = this.bytes[this.bit >> 3]
      if (byte === undefined) throw new RangeError('SPS ended early')
      value = value * 2 + ((byte >> (7 - (this.bit & 7))) & 1)
      this.bit++
    }
    return value
  }

  ue(): number {
    let zeros = 0
    while (this.u(1) === 0) {
      if (++zeros > 31) throw new RangeError('Invalid Exp-Golomb code')
    }
    return 2 ** zeros - 1 + this.u(zeros)
  }

  se(): number {
    const code = this.ue()
    return code % 2 === 1 ? (code + 1) / 2 : -code / 2
  }
}

/** Remove emulation-prevention bytes (00 00 03 -> 00 00). */
function rbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue
    out.push(nal[i]!)
  }
  return Uint8Array.from(out)
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135])

function skipScalingList(reader: BitReader, size: number): void {
  let last = 8
  let next = 8
  for (let j = 0; j < size; j++) {
    if (next !== 0) next = (last + reader.se() + 256) % 256
    last = next === 0 ? last : next
  }
}

function skipChromaAndScaling(reader: BitReader, profileIdc: number): void {
  if (!HIGH_PROFILES.has(profileIdc)) return
  const chromaFormatIdc = reader.ue()
  if (chromaFormatIdc === 3) reader.u(1) // separate_colour_plane_flag
  reader.ue() // bit_depth_luma_minus8
  reader.ue() // bit_depth_chroma_minus8
  reader.u(1) // qpprime_y_zero_transform_bypass_flag
  if (reader.u(1) === 0) return // seq_scaling_matrix_present_flag
  const lists = chromaFormatIdc === 3 ? 12 : 8
  for (let i = 0; i < lists; i++) {
    if (reader.u(1)) skipScalingList(reader, i < 6 ? 16 : 64)
  }
}

function skipFrameStructure(reader: BitReader): void {
  reader.ue() // log2_max_frame_num_minus4
  const pocType = reader.ue()
  if (pocType === 0) {
    reader.ue() // log2_max_pic_order_cnt_lsb_minus4
  } else if (pocType === 1) {
    reader.u(1) // delta_pic_order_always_zero_flag
    reader.se() // offset_for_non_ref_pic
    reader.se() // offset_for_top_to_bottom_field
    const cycle = reader.ue()
    for (let i = 0; i < cycle; i++) reader.se()
  }
  reader.ue() // max_num_ref_frames
  reader.u(1) // gaps_in_frame_num_value_allowed_flag
  reader.ue() // pic_width_in_mbs_minus1
  reader.ue() // pic_height_in_map_units_minus1
  if (reader.u(1) === 0) reader.u(1) // frame_mbs_only_flag, mb_adaptive_frame_field_flag
  reader.u(1) // direct_8x8_inference_flag
  if (reader.u(1)) for (let i = 0; i < 4; i++) reader.ue() // frame cropping offsets
}

/** `video_signal_type` of one SPS NAL unit (with its header byte), or null. */
export function parseAvcSpsVideoSignalType(sps: Uint8Array): AvcVideoSignalType | null {
  try {
    const reader = new BitReader(rbsp(sps))
    if ((reader.u(8) & 0x1f) !== 7) return null
    const profileIdc = reader.u(8)
    reader.u(16) // constraint flags, level_idc
    reader.ue() // seq_parameter_set_id
    skipChromaAndScaling(reader, profileIdc)
    skipFrameStructure(reader)
    if (reader.u(1) === 0) return null // vui_parameters_present_flag
    if (reader.u(1) && reader.u(8) === 255) reader.u(32) // aspect ratio, Extended_SAR
    if (reader.u(1)) reader.u(1) // overscan
    if (reader.u(1) === 0) return null // video_signal_type_present_flag
    reader.u(3) // video_format
    const fullRange = reader.u(1) === 1
    if (reader.u(1) === 0) return { fullRange }
    return {
      fullRange,
      colourPrimaries: reader.u(8),
      transferCharacteristics: reader.u(8),
      matrixCoefficients: reader.u(8),
    }
  } catch {
    return null
  }
}

/** The first SPS in an `avcC` (AVCDecoderConfigurationRecord), or null. */
export function firstSpsFromAvcC(avcC: Uint8Array): Uint8Array | null {
  if (avcC.length < 8 || avcC[0] !== 1 || (avcC[5]! & 0x1f) === 0) return null
  const length = (avcC[6]! << 8) | avcC[7]!
  return avcC.length >= 8 + length ? avcC.subarray(8, 8 + length) : null
}

const MATRIX: Record<number, VideoMatrixCoefficients> = {
  0: 'rgb',
  1: 'bt709',
  5: 'bt470bg',
  6: 'smpte170m',
}

/**
 * WebCodecs colour space for a signal type: the stream's matrix (BT.709 when
 * unspecified, the decoder default) and range. Primaries and transfer are
 * always BT.709, the values Chrome assumes today: its hardware decoder ignores
 * a colour space with any field missing, and Shreditor does not convert SDR
 * primaries (the native export does not either), so only the YCbCr-to-RGB
 * conversion changes.
 */
function avcSignalTypeToColorSpace(signal: AvcVideoSignalType): VideoColorSpaceInit {
  return {
    fullRange: signal.fullRange,
    matrix: MATRIX[signal.matrixCoefficients ?? -1] ?? 'bt709',
    primaries: 'bt709',
    transfer: 'bt709',
  }
}

/** BT.2020 / P3 primaries or matrix, PQ / HLG transfer (ISO/IEC 23091-2 code points). */
function isHdrSignalType(signal: AvcVideoSignalType): boolean {
  return (
    [9, 11, 12].includes(signal.colourPrimaries ?? -1) ||
    [9, 10, 14].includes(signal.matrixCoefficients ?? -1) ||
    [16, 18].includes(signal.transferCharacteristics ?? -1)
  )
}

const isCompleteColorSpace = (space: VideoColorSpaceInit): boolean =>
  space.matrix != null &&
  space.fullRange != null &&
  space.primaries != null &&
  space.transfer != null

/**
 * The decoder config with the colour space the H.264 bitstream declares filled
 * in where the container gave none or only part of one (a `colr` box with
 * unspecified primaries and transfer). Fields the config already has win. HDR
 * signals and non-H.264 configs are returned unchanged (HDR keeps the
 * browser's existing handling).
 */
export function withAvcBitstreamColorSpace(config: VideoDecoderConfig): VideoDecoderConfig {
  if (!/^avc[13]\./.test(config.codec) || !config.description) return config
  const existing = config.colorSpace ?? {}
  if (isCompleteColorSpace(existing)) return config
  const description = ArrayBuffer.isView(config.description)
    ? new Uint8Array(
        config.description.buffer,
        config.description.byteOffset,
        config.description.byteLength,
      )
    : new Uint8Array(config.description)
  const sps = firstSpsFromAvcC(description)
  const signal = sps ? parseAvcSpsVideoSignalType(sps) : null
  if (!signal || isHdrSignalType(signal)) return config
  const merged: VideoColorSpaceInit = { ...avcSignalTypeToColorSpace(signal) }
  for (const [key, value] of Object.entries(existing)) {
    if (value != null) Object.assign(merged, { [key]: value })
  }
  return { ...config, colorSpace: merged }
}
