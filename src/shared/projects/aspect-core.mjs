// Aspect ratios as keys ("9:16", "16:9", "1:1", "4:5", else the reduced
// "W:H"), shared by the editor and the agent tools. `aspect.ts` re-exports
// these for the editor.

/** Ratios that a near miss (a 1366x768 or 854x480 canvas) snaps to. */
const NAMED_ASPECTS = [
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['1:1', 1],
  ['4:5', 4 / 5],
]

const SNAP_TOLERANCE = 0.005

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b)
}

/** The aspect key of a canvas: "9:16" for 1080x1920 and 720x1280 alike. */
export function aspectKey(width, height) {
  const w = Math.round(Number(width))
  const h = Math.round(Number(height))
  if (!(w > 0 && h > 0)) throw new RangeError(`Not a canvas size: ${width}x${height}`)
  const ratio = w / h
  const named = NAMED_ASPECTS.find(([, value]) => Math.abs(ratio / value - 1) <= SNAP_TOLERANCE)
  if (named) return named[0]
  const divisor = gcd(w, h)
  return `${w / divisor}:${h / divisor}`
}

function ratioOf(key) {
  const [w, h] = String(key).split(':').map(Number)
  return w > 0 && h > 0 ? w / h : NaN
}

/** The available aspect nearest `target` (by ratio, either way); throws on none. */
export function closestAspect(target, available) {
  const wanted = Math.log(ratioOf(target))
  let best
  let bestDistance = Infinity
  for (const key of available) {
    const distance = Math.abs(Math.log(ratioOf(key)) - wanted)
    if (distance < bestDistance) {
      best = key
      bestDistance = distance
    }
  }
  if (best === undefined) throw new RangeError(`No aspect to choose from for ${target}`)
  return best
}
