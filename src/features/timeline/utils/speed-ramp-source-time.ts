import {
  getSpeedRamp,
  sourceFramesAtLocalFrame,
  type SpeedRampTimedItem,
} from '@/shared/timeline/speed-ramp.mjs'

/**
 * Source seconds a speed-ramped clip has played (from its source start) at a
 * clip-local timeline time in seconds. The filmstrip and waveform take one of
 * these for ramped clips in place of their linear `seconds * speed`.
 */
export type SourceSecondsAt = (timelineSeconds: number) => number

/**
 * The clip's time map in seconds, or undefined when it has no speed ramp (the
 * caller keeps its constant-speed mapping, so unramped clips draw exactly as
 * before).
 */
export function getSpeedRampSourceSecondsAt(
  item: SpeedRampTimedItem,
  fps: number,
): SourceSecondsAt | undefined {
  if (!getSpeedRamp(item)) return undefined
  const timelineFps = fps > 0 ? fps : 30
  const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : timelineFps
  // Keep only what the time map reads, so the closure does not pin the item.
  const timed: SpeedRampTimedItem = {
    speed: item.speed,
    speedRamp: item.speedRamp,
    sourceFps: item.sourceFps,
  }
  return (timelineSeconds) =>
    sourceFramesAtLocalFrame(timed, timelineSeconds * timelineFps, timelineFps) / sourceFps
}

/**
 * Source seconds played at a clip-local timeline time: through the ramp's time
 * map when there is one, else the constant `seconds * speed`.
 */
export function sourceOffsetSeconds(
  timelineSeconds: number,
  speed: number,
  sourceSecondsAt?: SourceSecondsAt,
): number {
  return sourceSecondsAt ? sourceSecondsAt(timelineSeconds) : timelineSeconds * speed
}
