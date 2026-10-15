/**
 * Temporal stability for per-sample mattes. Single-image models flicker at the
 * edges from sample to sample, and we have no recurrent state (RVM, which
 * carries one, is GPL). So while analysing a contiguous run, each new alpha is
 * pulled toward the previous (already smoothed) one wherever the picture itself
 * did not change: an exponential moving average gated per pixel by the frame
 * difference. Where the subject moves, the gate opens and the new matte wins,
 * so motion never drags a ghost behind it.
 */

/** Rec. 709 luma of RGBA pixels, 0..1. */
export function lumaOf(rgba: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(rgba.length / 4)
  for (let i = 0; i < out.length; i++) {
    out[i] = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) / 255
  }
  return out
}

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/**
 * Blend `alpha` toward `previousAlpha` by up to `strength` where the luma did
 * not move (difference under ~2%, fading out by ~8%). Arrays are the same size.
 */
export function smoothAlpha(
  alpha: Float32Array,
  previousAlpha: Float32Array,
  luma: Float32Array,
  previousLuma: Float32Array,
  strength: number,
): Float32Array {
  const out = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) {
    const motion = Math.abs(luma[i]! - previousLuma[i]!)
    const keep = strength * (1 - smoothstep(0.02, 0.08, motion))
    out[i] = alpha[i]! + (previousAlpha[i]! - alpha[i]!) * keep
  }
  return out
}

/** Share of pixels above half: how much of the frame the subject covers. */
export function alphaCoverage(alpha: Float32Array): number {
  if (alpha.length === 0) return 0
  let count = 0
  for (const value of alpha) if (value > 0.5) count++
  return count / alpha.length
}

/** Fit `width` x `height` inside `longEdge`, keeping the aspect ratio. */
export function maskSize(
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
