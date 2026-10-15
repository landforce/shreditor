// Speed ramps: variable speed across a clip, and the time map every consumer
// uses to turn a clip-local timeline frame into source time (and back).
//
// Plain ESM so the editor (TypeScript, via speed-ramp.d.mts), the agent
// service and the scorecard (Node) share one implementation.
//
// Model. A clip's `speedRamp` is a list of keys `{ frame, speed, easing?,
// easingConfig?, id? }`: `frame` is clip-local timeline frames (0 = the
// clip's first frame), `speed` the playback rate there, and `easing` how the
// speed moves TO the next key (the keyframe system's easing types and
// semantics). Before the first key and after the last the speed holds. Keys
// may sit outside [0, durationInFrames): a split or a start trim shifts the
// keys instead of re-sampling the curve, so the shape stays exact. Without
// keys (absent or empty) the clip plays at its constant `speed`.
//
// Time map. The source offset at local frame f (in source frames, from the
// clip's sourceStart) is the integral of the speed curve:
//   S(f) = (sourceFps / fps) * integral from 0 to f of s(t) dt
// which reduces to f * speed * sourceFps / fps for a constant speed. The
// clip's source window is consistent when sourceEnd - sourceStart = S(duration).
// The integral is tabulated per frame once per key list (cached on the array,
// which the stores replace on every change), so per-frame calls are a lookup.

export const MIN_SPEED = 0.1
export const MAX_SPEED = 16
export const DEFAULT_SPEED = 1

/** Editorial presets for setSpeedRamp and the editor's ramp menus. */
export const SPEED_RAMP_PRESETS = Object.freeze(['ease-in', 'ease-out', 'hero', 'whip'])

const EASINGS = new Set([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
  'cubic-bezier',
  'spring',
])

// ---------------------------------------------------------------------------
// Easing (mirrors src/shared/utils/easing.ts; speed-ramp.test.ts keeps them equal)
// ---------------------------------------------------------------------------

const DEFAULT_BEZIER = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }
const DEFAULT_SPRING = { tension: 170, friction: 26, mass: 1 }

function cubicBezier(t, { x1, y1, x2, y2 }) {
  if (t === 0) return 0
  if (t === 1) return 1
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  let tc = t
  for (let i = 0; i < 8; i++) {
    const x = ((ax * tc + bx) * tc + cx) * tc
    const dx = x - t
    if (Math.abs(dx) < 1e-6) break
    const dxdt = (3 * ax * tc + 2 * bx) * tc + cx
    if (Math.abs(dxdt) < 1e-6) break
    tc = Math.max(0, Math.min(1, tc - dx / dxdt))
  }
  return ((ay * tc + by) * tc + cy) * tc
}

function spring(t, { tension, friction, mass }) {
  if (t === 0) return 0
  if (t === 1) return 1
  const omega0 = Math.sqrt(tension / mass)
  const zeta = friction / (2 * Math.sqrt(tension * mass))
  const scaledT = t * (4 / (zeta * omega0))
  let value
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta)
    value =
      1 -
      Math.exp(-zeta * omega0 * scaledT) *
        (Math.cos(omegaD * scaledT) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * scaledT))
  } else if (zeta === 1) {
    value = 1 - Math.exp(-omega0 * scaledT) * (1 + omega0 * scaledT)
  } else {
    const s1 = -omega0 * (zeta - Math.sqrt(zeta * zeta - 1))
    const s2 = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1))
    value = 1 - (s2 * Math.exp(s1 * scaledT) - s1 * Math.exp(s2 * scaledT)) / (s2 - s1)
  }
  return Math.max(0, Math.min(1.2, value))
}

function basicEasing(type, t) {
  switch (type) {
    case 'ease-in':
      return t * t
    case 'ease-out':
      return t * (2 - t)
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    case 'hold':
      return 0
    case 'cubic-bezier':
      return cubicBezier(t, DEFAULT_BEZIER)
    case 'spring':
      return spring(t, DEFAULT_SPRING)
    default:
      return t
  }
}

/** Eased progress 0..1 for a key's easing (and config), as keyframe interpolation does. */
export function easeProgress(t, easing = 'linear', easingConfig) {
  const clamped = Math.max(0, Math.min(1, t))
  if (!easingConfig) return basicEasing(easing, clamped)
  switch (easingConfig.type) {
    case 'cubic-bezier':
      return cubicBezier(clamped, easingConfig.bezier ?? DEFAULT_BEZIER)
    case 'spring':
      return spring(clamped, easingConfig.spring ?? DEFAULT_SPRING)
    default:
      return basicEasing(easingConfig.type, clamped)
  }
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

function clampSpeed(speed) {
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed))
}

/** The clip's ramp keys, or null when it plays at a constant speed. */
export function getSpeedRamp(item) {
  const keys = item?.speedRamp
  return Array.isArray(keys) && keys.length > 0 ? keys : null
}

export function hasSpeedRamp(item) {
  return getSpeedRamp(item) !== null
}

/**
 * Keys sorted by frame, frames rounded to whole frames, speeds clamped, one key
 * per frame (the last given wins), unknown easings dropped to linear. Returns
 * a new array; [] for no keys.
 */
export function normalizeSpeedRamp(keys) {
  if (!Array.isArray(keys)) return []
  const byFrame = new Map()
  for (const key of keys) {
    if (!key || !Number.isFinite(key.frame) || !Number.isFinite(key.speed) || key.speed <= 0) {
      continue
    }
    const frame = Math.round(key.frame)
    const next = { frame, speed: clampSpeed(key.speed) }
    if (key.id) next.id = key.id
    if (key.easing && key.easing !== 'linear' && EASINGS.has(key.easing)) next.easing = key.easing
    if (key.easingConfig && EASINGS.has(key.easingConfig.type)) {
      next.easingConfig = key.easingConfig
    }
    byFrame.set(frame, next)
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame)
}

/** Why these op keys can't be a ramp on a clip this long, or null when they can. */
export function speedRampKeysProblem(keys, durationInFrames) {
  if (!Array.isArray(keys)) return 'keys must be an array'
  for (const [index, key] of keys.entries()) {
    if (!key || typeof key !== 'object') return `keys[${index}] must be an object`
    if (!Number.isInteger(key.frame)) return `keys[${index}].frame must be a whole frame`
    if (key.frame < 0 || key.frame > durationInFrames) {
      return `keys[${index}].frame ${key.frame} is outside the clip (0..${durationInFrames})`
    }
    if (!Number.isFinite(key.speed) || key.speed < MIN_SPEED || key.speed > MAX_SPEED) {
      return `keys[${index}].speed ${key.speed} is outside ${MIN_SPEED}..${MAX_SPEED}`
    }
    if (key.easing !== undefined && !EASINGS.has(key.easing)) {
      return `keys[${index}].easing "${key.easing}" is not one of ${[...EASINGS].join(', ')}`
    }
  }
  const frames = keys.map((key) => key.frame)
  if (new Set(frames).size !== frames.length) return 'two keys share a frame'
  return null
}

/**
 * Drop keys that can't affect [0, durationInFrames): only the nearest key
 * before 0 and the nearest after the end still shape the curve inside it.
 */
export function pruneSpeedRamp(keys, durationInFrames) {
  const sorted = normalizeSpeedRamp(keys)
  const firstInside = sorted.findIndex((key) => key.frame >= 0)
  const start = firstInside === -1 ? sorted.length - 1 : Math.max(0, firstInside - 1)
  const lastInside = sorted.findLastIndex((key) => key.frame <= durationInFrames)
  const end = lastInside === -1 ? 0 : Math.min(sorted.length - 1, lastInside + 1)
  return sorted.slice(start, end + 1)
}

/** Keys moved by `delta` frames (a start trim moves them by -amount, a split's right half by -cut). */
export function shiftSpeedRamp(keys, delta) {
  return keys.map((key) => ({ ...key, frame: key.frame + delta }))
}

/** Keys stretched in time by `frameScale` and in speed by `speedScale` (rate stretch). */
export function scaleSpeedRamp(keys, frameScale, speedScale) {
  return normalizeSpeedRamp(
    keys.map((key) => ({
      ...key,
      frame: key.frame * frameScale,
      speed: key.speed * speedScale,
    })),
  )
}

export function sameSpeedRamp(a, b) {
  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((key, index) => {
    const other = right[index]
    return (
      key.frame === other.frame &&
      Math.abs(key.speed - other.speed) < 1e-9 &&
      (key.easing ?? 'linear') === (other.easing ?? 'linear') &&
      JSON.stringify(key.easingConfig ?? null) === JSON.stringify(other.easingConfig ?? null)
    )
  })
}

// ---------------------------------------------------------------------------
// The curve and its integral
// ---------------------------------------------------------------------------

/** The ramp's speed at a clip-local frame (held before the first key and after the last). */
export function speedAtFrame(keys, frame) {
  const first = keys[0]
  if (!first) return DEFAULT_SPEED
  if (keys.length === 1 || frame <= first.frame) return clampSpeed(first.speed)
  const last = keys[keys.length - 1]
  if (frame >= last.frame) return clampSpeed(last.speed)
  let lo = 0
  let hi = keys.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid].frame <= frame) lo = mid
    else hi = mid
  }
  const prev = keys[lo]
  const next = keys[hi]
  const span = next.frame - prev.frame
  if (span <= 0) return clampSpeed(prev.speed)
  const eased = easeProgress((frame - prev.frame) / span, prev.easing, prev.easingConfig)
  return clampSpeed(prev.speed + (next.speed - prev.speed) * eased)
}

// Subintervals per frame for Simpson's rule. Easings are smooth inside a
// segment and keys sit on whole frames, so this is exact to ~1e-9 frames for
// linear and quadratic easings and far below a sample for the rest.
const STEPS = 8
const EDGE = 1e-9
const integralCache = new WeakMap()

function simpson(keys, a, b) {
  if (b <= a) return 0
  const n = STEPS
  const h = (b - a) / n
  // Evaluate just inside the interval so a hold key's step lands on the right side.
  let sum = speedAtFrame(keys, a + EDGE) + speedAtFrame(keys, b - EDGE)
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * speedAtFrame(keys, a + i * h)
  return (sum * h) / 3
}

/**
 * The ramp's integral: `at(f)` is the area under the speed curve from local
 * frame 0 to f (speed x frames; negative for f < 0), `inverse(v)` the frame
 * where it reaches v. Cached per key array.
 */
export function speedRampIntegral(keys) {
  const cached = integralCache.get(keys)
  if (cached) return cached
  const first = keys[0]?.frame ?? 0
  const last = keys[keys.length - 1]?.frame ?? 0
  const gridStart = Math.floor(Math.min(0, first))
  const gridEnd = Math.ceil(Math.max(0, last, gridStart + 1))
  const cells = gridEnd - gridStart
  const table = new Float64Array(cells + 1)
  for (let i = 0; i < cells; i++) {
    table[i + 1] = table[i] + simpson(keys, gridStart + i, gridStart + i + 1)
  }
  const headSpeed = speedAtFrame(keys, gridStart)
  const tailSpeed = speedAtFrame(keys, gridEnd)
  const fromGridStart = (f) => {
    if (f <= gridStart) return (f - gridStart) * headSpeed
    if (f >= gridEnd) return table[cells] + (f - gridEnd) * tailSpeed
    const cell = Math.floor(f - gridStart)
    const cellStart = gridStart + cell
    return table[cell] + (f === cellStart ? 0 : simpson(keys, cellStart, f))
  }
  const zero = fromGridStart(0)
  const at = (f) => fromGridStart(f) - zero
  const inverse = (value) => {
    const target = value + zero
    if (target <= 0) return gridStart + target / headSpeed
    if (target >= table[cells]) return gridEnd + (target - table[cells]) / tailSpeed
    let lo = 0
    let hi = cells
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (table[mid] <= target) lo = mid
      else hi = mid
    }
    // Newton inside the frame, kept in the frame by bisection.
    let low = gridStart + lo
    let high = low + 1
    let f = low + (target - table[lo]) / Math.max(1e-12, table[lo + 1] - table[lo])
    for (let i = 0; i < 24; i++) {
      const error = fromGridStart(f) - target
      if (Math.abs(error) < 1e-10) break
      if (error > 0) high = f
      else low = f
      const step = f - error / speedAtFrame(keys, f)
      f = step > low && step < high ? step : (low + high) / 2
    }
    return f
  }
  const result = { at, inverse }
  integralCache.set(keys, result)
  return result
}

// ---------------------------------------------------------------------------
// Items: source time through the ramp (or the constant speed)
// ---------------------------------------------------------------------------

const ratioOf = (item, fps) => {
  const timelineFps = fps > 0 ? fps : 30
  const sourceFps = item?.sourceFps > 0 ? item.sourceFps : timelineFps
  return sourceFps / timelineFps
}

/**
 * Source frames played from the clip's sourceStart to clip-local frame
 * `localFrame` (fractional, unrounded). Forward playback; a reversed clip
 * reads the same distance back from its sourceEnd.
 */
export function sourceFramesAtLocalFrame(item, localFrame, fps) {
  const keys = getSpeedRamp(item)
  const ratio = ratioOf(item, fps)
  if (!keys) return localFrame * (item?.speed || DEFAULT_SPEED) * ratio
  return speedRampIntegral(keys).at(localFrame) * ratio
}

/** The clip-local frame where `sourceFrames` (from sourceStart) have played. */
export function localFrameAtSourceFrames(item, sourceFrames, fps) {
  const keys = getSpeedRamp(item)
  const ratio = ratioOf(item, fps)
  if (!keys) return sourceFrames / ratio / (item?.speed || DEFAULT_SPEED)
  return speedRampIntegral(keys).inverse(sourceFrames / ratio)
}

/** Source frames the clip plays over its whole length (fractional). */
export function sourceSpanFrames(item, fps, durationInFrames = item?.durationInFrames ?? 0) {
  return sourceFramesAtLocalFrame(item, durationInFrames, fps)
}

/** The ramp's lowest and highest speed inside the clip (the constant speed without one). */
export function speedRange(item) {
  const keys = getSpeedRamp(item)
  if (!keys) {
    const speed = item?.speed || DEFAULT_SPEED
    return { min: speed, max: speed }
  }
  const duration = Math.max(1, item.durationInFrames ?? 1)
  let min = Infinity
  let max = -Infinity
  const sample = (frame) => {
    const speed = speedAtFrame(keys, frame)
    min = Math.min(min, speed)
    max = Math.max(max, speed)
  }
  for (let f = 0; f <= duration; f++) sample(f)
  for (const key of keys) if (key.frame >= 0 && key.frame <= duration) sample(key.frame)
  return { min, max }
}

/**
 * The longest clip, in timeline frames, these keys can play from `sourceStart`
 * before running out of media (`sourceDuration`, source frames).
 */
export function maxDurationForMedia(item, sourceStart, sourceDuration, fps) {
  const available = Math.max(0, sourceDuration - sourceStart)
  return Math.max(0, Math.floor(localFrameAtSourceFrames(item, available, fps) + 1e-6))
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const clampFrame = (frame, duration) => Math.max(0, Math.min(duration, Math.round(frame)))

/**
 * Keys for an editorial preset on a clip `durationInFrames` long.
 *  - ease-in: slow to fast (`startSpeed` 0.5 -> `endSpeed` 2, accelerating).
 *  - ease-out: fast to slow (`startSpeed` 2 -> `endSpeed` 0.5, settling).
 *  - hero: fast, slow motion on a moment, fast again: `frame` (the moment,
 *    default the middle), `speed` (slow motion, 0.3), `baseSpeed` (2),
 *    `holdFrames` (slow motion around the moment, a quarter of the clip) and
 *    `rampFrames` (each speed change, a tenth of the clip).
 *  - whip: a speed burst at `frame` (default the middle): `baseSpeed` (1) up
 *    to `speed` (4) and back, `rampFrames` each way (a tenth of the clip).
 * Throws on an unknown preset.
 */
export function speedRampPreset(name, options = {}) {
  const duration = Math.max(1, Math.round(options.durationInFrames ?? 1))
  const pick = (value, fallback) => (Number.isFinite(value) ? value : fallback)
  const defaultRamp = Math.max(2, Math.round(duration * 0.1))
  switch (name) {
    case 'ease-in':
      return normalizeSpeedRamp([
        { frame: 0, speed: pick(options.startSpeed, 0.5), easing: 'ease-in' },
        { frame: duration, speed: pick(options.endSpeed, 2) },
      ])
    case 'ease-out':
      return normalizeSpeedRamp([
        { frame: 0, speed: pick(options.startSpeed, 2), easing: 'ease-out' },
        { frame: duration, speed: pick(options.endSpeed, 0.5) },
      ])
    case 'hero': {
      const moment = clampFrame(pick(options.frame, duration / 2), duration)
      const slow = pick(options.speed, 0.3)
      const fast = pick(options.baseSpeed, 2)
      const hold = Math.max(0, Math.round(pick(options.holdFrames, duration * 0.25)))
      const ramp = Math.max(1, Math.round(pick(options.rampFrames, defaultRamp)))
      const slowStart = clampFrame(moment - hold / 2, duration)
      const slowEnd = clampFrame(moment + hold / 2, duration)
      const keys = [
        { frame: 0, speed: fast },
        { frame: Math.max(0, slowStart - ramp), speed: fast, easing: 'ease-in-out' },
        { frame: slowStart, speed: slow },
        { frame: slowEnd, speed: slow, easing: 'ease-in-out' },
        { frame: Math.min(duration, slowEnd + ramp), speed: fast },
        { frame: duration, speed: fast },
      ]
      return normalizeSpeedRamp(dedupeKeepingEasing(keys))
    }
    case 'whip': {
      const moment = clampFrame(pick(options.frame, duration / 2), duration)
      const peak = pick(options.speed, 4)
      const base = pick(options.baseSpeed, 1)
      const ramp = Math.max(1, Math.round(pick(options.rampFrames, defaultRamp)))
      const keys = [
        { frame: 0, speed: base },
        { frame: Math.max(0, moment - ramp), speed: base, easing: 'ease-in' },
        { frame: moment, speed: peak, easing: 'ease-out' },
        { frame: Math.min(duration, moment + ramp), speed: base },
        { frame: duration, speed: base },
      ]
      return normalizeSpeedRamp(dedupeKeepingEasing(keys))
    }
    default:
      throw new Error(`Unknown speed ramp preset "${name}". Presets: ${SPEED_RAMP_PRESETS.join(', ')}`)
  }
}

// Keys that land on one frame (a moment at the clip edge): keep the later key's
// speed but the earlier one's easing when the later has none.
function dedupeKeepingEasing(keys) {
  const out = []
  for (const key of keys) {
    const previous = out[out.length - 1]
    if (previous && previous.frame === key.frame) {
      out[out.length - 1] = { ...key, easing: key.easing ?? previous.easing }
    } else {
      out.push(key)
    }
  }
  return out
}

/**
 * The ramp of two adjacent clips joined into one (left then right), or null
 * when their curves don't continue each other (only the halves of one ramped
 * clip do). Undefined when neither is ramped.
 */
export function joinedSpeedRamp(left, right) {
  const leftKeys = getSpeedRamp(left)
  const rightKeys = getSpeedRamp(right)
  if (!leftKeys && !rightKeys) return undefined
  if (!leftKeys || !rightKeys) return null
  const offset = left.durationInFrames
  const total = offset + right.durationInFrames
  const union = normalizeSpeedRamp([...leftKeys, ...shiftSpeedRamp(rightKeys, offset)])
  for (let frame = 0; frame <= total; frame++) {
    const expected =
      frame <= offset ? speedAtFrame(leftKeys, frame) : speedAtFrame(rightKeys, frame - offset)
    if (Math.abs(speedAtFrame(union, frame) - expected) > 1e-6) return null
  }
  return pruneSpeedRamp(union, total)
}
