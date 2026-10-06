// Canvas aspect ratios as short keys ("9:16", "16:9", "1:1", "4:5", else the
// reduced "W:H"). Shared by the editor and the agent tools (Node), so both name
// a canvas the same way: motion template variants and text style variants are
// keyed by it.

/** The aspect ratios Shreditor names; a canvas within 1% of one gets its key. */
const NAMED_ASPECTS = Object.freeze(['9:16', '16:9', '1:1', '4:5'])
const SNAP_TOLERANCE = 0.01

const gcd = (a, b) => {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) [x, y] = [y, x % y]
  return x || 1
}

/** Width over height of an aspect key ("16:9" -> 1.777...). */
export function aspectRatio(key) {
  const [w, h] = String(key).split(':').map(Number)
  if (!(w > 0) || !(h > 0)) throw new Error(`"${key}" is not an aspect ratio (like 16:9)`)
  return w / h
}

/** The aspect key of a canvas: a named one when within 1%, else the reduced "W:H". */
export function aspectKey(width, height) {
  const w = Math.round(Number(width))
  const h = Math.round(Number(height))
  if (!(w > 0) || !(h > 0)) throw new Error(`${width}x${height} is not a canvas size`)
  const ratio = w / h
  const named = NAMED_ASPECTS.find(
    (key) => Math.abs(aspectRatio(key) / ratio - 1) <= SNAP_TOLERANCE,
  )
  if (named) return named
  const divisor = gcd(w, h)
  return `${w / divisor}:${h / divisor}`
}

/** Read "16:9", "16x9" or "16/9" (or a canvas size like "1920x1080") as an aspect key. */
export function parseAspect(text) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(text ?? ''))
  if (!match) throw new Error(`"${text}" is not an aspect ratio (use 9:16, 16:9, 1:1, 4:5 or W:H)`)
  const w = Number(match[1])
  const h = Number(match[2])
  if (!(w > 0) || !(h > 0)) throw new Error(`"${text}" is not an aspect ratio`)
  // Scale fractional ratios ("2.39:1") to whole numbers before reducing.
  const scale = Number.isInteger(w) && Number.isInteger(h) ? 1 : 1000
  return aspectKey(w * scale, h * scale)
}

/** The candidate key nearest the target ratio (compared on a log scale), or null. */
export function closestAspect(target, candidates) {
  const wanted = Math.log(aspectRatio(target))
  let best = null
  let bestDistance = Infinity
  for (const key of candidates ?? []) {
    const distance = Math.abs(Math.log(aspectRatio(key)) - wanted)
    if (distance < bestDistance) {
      best = key
      bestDistance = distance
    }
  }
  return best
}

/** Named aspects first (in NAMED_ASPECTS order), then the rest widest first. */
export function sortAspects(keys) {
  const rank = (key) => {
    const index = NAMED_ASPECTS.indexOf(key)
    return index === -1 ? NAMED_ASPECTS.length : index
  }
  return [...keys].sort((a, b) => rank(a) - rank(b) || aspectRatio(b) - aspectRatio(a))
}

/** A canvas of the given aspect whose short side matches `shortSide` (even sizes). */
export function canvasForAspect(key, shortSide) {
  const ratio = aspectRatio(key)
  const even = (value) => Math.max(2, Math.round(value / 2) * 2)
  return ratio >= 1
    ? { width: even(shortSide * ratio), height: even(shortSide) }
    : { width: even(shortSide), height: even(shortSide / ratio) }
}
