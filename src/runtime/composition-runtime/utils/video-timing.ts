import {
  getSpeedRamp,
  sourceFramesAtLocalFrame,
  type SpeedRampKey,
} from '@/shared/timeline/speed-ramp.mjs'

/**
 * Snap a source time to the nearest frame boundary to eliminate
 * floating-point drift.  Without this, `(sourceStart / sourceFps) +
 * (localFrame / fps)` can accumulate error that causes
 * `Math.floor(result * sourceFps)` to land on the wrong frame.
 *
 * Uses a tight tolerance (0.001 frames) so only genuine floating-point
 * errors are corrected — times that genuinely fall between frames (e.g.
 * mismatched source/timeline FPS) are left untouched.
 */
export function snapSourceTime(time: number, sourceFps: number): number {
  const sourceFrame = time * sourceFps
  const rounded = Math.round(sourceFrame)
  if (Math.abs(sourceFrame - rounded) < 1e-6) {
    // Add a micro-epsilon (1/10000 of a frame) so that
    // Math.floor(snapped * sourceFps) survives the round-trip.
    // Without this, rounded/sourceFps * sourceFps can land at
    // (rounded - 1e-14), causing Math.floor to return rounded-1.
    return (rounded + 1e-4) / sourceFps
  }
  return time
}

/**
 * Source frames played after `relativeFrame` clip frames: the constant rate,
 * or a speed ramp's integral (src/shared/timeline/speed-ramp.mjs).
 */
function playedSourceFrames(
  relativeFrame: number,
  playbackRate: number,
  sourceFps: number,
  timelineFps: number,
  speedRamp: readonly SpeedRampKey[] | undefined,
): number {
  const keys = getSpeedRamp({ speedRamp })
  if (!keys) return (relativeFrame * playbackRate * sourceFps) / timelineFps
  return sourceFramesAtLocalFrame({ speedRamp: keys, sourceFps }, relativeFrame, timelineFps)
}

/**
 * Calculate source playback time (seconds) for a video clip.
 * Supports shared Sequence rendering by applying a per-item frame offset.
 * A clip with a speed ramp passes its keys; `playbackRate` is then ignored.
 */
export function getVideoTargetTimeSeconds(
  safeTrimBefore: number,
  sourceFps: number,
  sequenceLocalFrame: number,
  playbackRate: number,
  timelineFps: number,
  sequenceFrameOffset: number = 0,
  isReversed: boolean = false,
  reverseSourceEnd?: number,
  speedRamp?: readonly SpeedRampKey[],
): number {
  const relativeFrame = sequenceLocalFrame - sequenceFrameOffset
  const sourceFrameOffset = playedSourceFrames(
    relativeFrame,
    playbackRate,
    sourceFps,
    timelineFps,
    speedRamp,
  )
  if (isReversed) {
    const sourceEnd = reverseSourceEnd ?? safeTrimBefore
    return snapSourceTime(Math.max(0, sourceEnd - sourceFrameOffset - 1) / sourceFps, sourceFps)
  }
  return snapSourceTime(safeTrimBefore / sourceFps + sourceFrameOffset / sourceFps, sourceFps)
}

/**
 * Calculate source playback time (seconds) for an audio clip.
 *
 * IMPORTANT: `trimBefore` is in **source FPS** frames (not timeline FPS).
 * Using timeline FPS to convert trimBefore to seconds will produce the wrong
 * seek position for sources whose FPS differs from the project FPS.
 *
 * This function must produce the same result as `getVideoTargetTimeSeconds`
 * (with sequenceFrameOffset=0) so that video and audio stay in sync.
 */
export function getAudioTargetTimeSeconds(
  trimBefore: number,
  sourceFps: number,
  sequenceLocalFrame: number,
  playbackRate: number,
  timelineFps: number,
  isReversed: boolean = false,
  reverseSourceEnd?: number,
  speedRamp?: readonly SpeedRampKey[],
): number {
  const sourceFrameOffset = playedSourceFrames(
    sequenceLocalFrame,
    playbackRate,
    sourceFps,
    timelineFps,
    speedRamp,
  )
  if (isReversed) {
    const sourceEnd = reverseSourceEnd ?? trimBefore
    return snapSourceTime(Math.max(0, sourceEnd - sourceFrameOffset - 1) / sourceFps, sourceFps)
  }
  return snapSourceTime(trimBefore / sourceFps + sourceFrameOffset / sourceFps, sourceFps)
}
