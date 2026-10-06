/**
 * Placing decoded audio samples into a requested source range.
 *
 * A decoder returns whole packets: an AAC frame is 1024 samples and a PCM
 * packet is often 1024 to 4096, so the first sample a range decode yields
 * usually starts before the requested time. Concatenating samples from there
 * puts the requested instant late in the result (and the clip late on the
 * timeline) by up to a packet. Each decoded sample carries its presentation
 * timestamp, so the first one anchors the range: frames before the start are
 * skipped, a source that starts after it gets leading silence, and the result
 * stops at exactly the requested length.
 */

export interface DecodedSampleSlice {
  /** Silent frames to write before this sample's data. */
  padFrames: number
  /** Frames to skip at the start of this sample. */
  skipFrames: number
  /** Frames to copy from this sample after the skipped ones. */
  takeFrames: number
}

/** Frames a range of `startTime..endTime` seconds holds at `sampleRate`. */
export function decodedRangeFrameCount(
  startTime: number,
  endTime: number,
  sampleRate: number,
): number {
  return Math.max(0, Math.round((endTime - startTime) * sampleRate))
}

/**
 * Where one decoded sample lands in the range. `writtenFrames` counts frames
 * already written (padding included); `anchored` is false until a sample has
 * been placed, after which samples are taken as contiguous. A sample without
 * a finite timestamp is treated as starting at the range start.
 */
export function sliceDecodedSampleIntoRange(params: {
  sampleTimestamp: number
  sampleFrames: number
  sampleRate: number
  startTime: number
  endTime: number
  writtenFrames: number
  anchored: boolean
}): DecodedSampleSlice {
  const { sampleFrames, sampleRate, writtenFrames, anchored } = params
  const wanted = decodedRangeFrameCount(params.startTime, params.endTime, sampleRate)
  let padFrames = 0
  let skipFrames = 0
  if (!anchored) {
    const offset = Number.isFinite(params.sampleTimestamp)
      ? Math.round((params.sampleTimestamp - params.startTime) * sampleRate)
      : 0
    padFrames = Math.min(Math.max(0, offset), Math.max(0, wanted - writtenFrames))
    skipFrames = Math.min(sampleFrames, Math.max(0, -offset))
  }
  const remaining = Math.max(0, wanted - writtenFrames - padFrames)
  const takeFrames = Math.min(Math.max(0, sampleFrames - skipFrames), remaining)
  return { padFrames, skipFrames, takeFrames }
}
