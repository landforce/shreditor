/** Where a shot's edges sit against the music's beat. Pure; frames are timeline frames. */

export interface BeatCut {
  /** The beat the edge moves to, in whole frames. */
  beatFrame: number
  /** Frames to hand to trimItemStart / trimItemEnd (positive = later). */
  amount: number
}

/** First beat after the shot's end, rounded to a frame. Null when none follows. */
export function planCutOut(beatFrames: readonly number[], endFrame: number): BeatCut | null {
  for (const beat of beatFrames) {
    const frame = Math.round(beat)
    if (frame > endFrame) return { beatFrame: frame, amount: frame - endFrame }
  }
  return null
}

/** Nearest beat before the shot's start, rounded to a frame. Null when none precedes. */
export function planCutIn(beatFrames: readonly number[], startFrame: number): BeatCut | null {
  for (let i = beatFrames.length - 1; i >= 0; i--) {
    const frame = Math.round(beatFrames[i]!)
    if (frame < startFrame) return { beatFrame: frame, amount: frame - startFrame }
  }
  return null
}

export interface OutPointReadout {
  /** Whole milliseconds the out point is from the nearest beat (0 when on it). */
  ms: number
  direction: 'before' | 'after' | 'on'
  /** The nearest beat, in seconds on the timeline. */
  beatSeconds: number
}

/** How far the out point sits from the nearest beat. Null with no beats. */
export function describeOutPoint(
  beatFrames: readonly number[],
  endFrame: number,
  fps: number,
): OutPointReadout | null {
  let nearest: number | null = null
  for (const beat of beatFrames) {
    if (nearest === null || Math.abs(beat - endFrame) < Math.abs(nearest - endFrame)) nearest = beat
  }
  if (nearest === null) return null
  const ms = Math.round((Math.abs(endFrame - nearest) / fps) * 1000)
  const direction = ms === 0 ? 'on' : endFrame > nearest ? 'after' : 'before'
  return { ms, direction, beatSeconds: nearest / fps }
}
