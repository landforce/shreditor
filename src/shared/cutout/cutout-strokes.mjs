// Brush corrections to a cutout (docs/background-removal.md, Smart brush).
// Shared by the editor, the headless harness and the agent tools; pure.
//
// A stroke is painted on one source frame: `{ tool, at, size, points }`, with
// `at` in source seconds, `size` the brush radius as a fraction of the source
// frame's short side and `points` [[x, y], ...] as fractions of the source
// frame. `brush` and `eraser` are plain discs along the path. `smartBrush` and
// `smartEraser` prompt SlimSAM with points along the path, keep the region it
// finds and track that region through the clip; the regions are stored as
// masks beside the auto masks:
//   media/<mediaId>/cache/cutout/<fingerprint>-slimsam-r<rate>-<strokeHash>/s0000123.png
// and listed under `regions` in the media's index.json.
import {
  SAM_MAX_POINTS,
  SAM_MIN_TRACK_IOU,
  interiorPoints,
  pickSamCandidate,
  regionStats,
} from './cutout-sam.mjs'

const CUTOUT_STROKE_TOOLS = ['brush', 'eraser', 'smartBrush', 'smartEraser']
const SMART_TOOLS = new Set(['smartBrush', 'smartEraser'])
const ERASE_TOOLS = new Set(['eraser', 'smartEraser'])
export const CUTOUT_MAX_STROKES = 64
const CUTOUT_MAX_STROKE_POINTS = 512
const MAX_SIZE = 0.5

export const isSmartStroke = (stroke) => SMART_TOOLS.has(stroke?.tool)
export const isEraseStroke = (stroke) => ERASE_TOOLS.has(stroke?.tool)

/** 32-bit FNV-1a, hex. */
export function fnv1a(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const isFraction = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const isPoint = (p) => Array.isArray(p) && p.length === 2 && isFraction(p[0]) && isFraction(p[1])

/** Field rules for one stroke: [field, valid?, what it must be]. */
const STROKE_RULES = [
  ['tool', (v) => CUTOUT_STROKE_TOOLS.includes(v), `one of ${CUTOUT_STROKE_TOOLS.join(', ')}`],
  ['at', (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0, 'source seconds (>= 0)'],
  ['size', (v) => typeof v === 'number' && v > 0 && v <= MAX_SIZE, `a radius from 0 to ${MAX_SIZE} of the frame's short side`],
  [
    'points',
    (v) => Array.isArray(v) && v.length > 0 && v.length <= CUTOUT_MAX_STROKE_POINTS && v.every(isPoint),
    `1 to ${CUTOUT_MAX_STROKE_POINTS} [x, y] pairs, fractions of the source frame (0..1)`,
  ],
]

/** A problem with one stroke (named `label`), or null. */
function cutoutStrokeProblem(stroke, label = 'stroke') {
  if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) return `${label}: must be an object`
  const extra = Object.keys(stroke).find((key) => !STROKE_RULES.some(([field]) => field === key))
  if (extra) return `${label}.${extra}: unknown field`
  const bad = STROKE_RULES.find(([field, valid]) => !valid(stroke[field]))
  return bad ? `${label}.${bad[0]}: must be ${bad[2]}` : null
}

/** A problem with a cutout's strokes array, or null. */
export function cutoutStrokesProblem(strokes) {
  if (!Array.isArray(strokes)) return 'cutout.strokes: must be an array'
  if (strokes.length > CUTOUT_MAX_STROKES) return `cutout.strokes: at most ${CUTOUT_MAX_STROKES} strokes`
  for (let i = 0; i < strokes.length; i++) {
    const problem = cutoutStrokeProblem(strokes[i], `cutout.strokes[${i}]`)
    if (problem) return problem
  }
  return null
}

/** The stroke's identity: its stored region masks are keyed by it. */
export function cutoutStrokeHash(stroke) {
  const round = (v) => Math.round(v * 1e5) / 1e5
  const points = stroke.points.map(([x, y]) => [round(x), round(y)])
  return `k${fnv1a(JSON.stringify([stroke.tool, round(stroke.at), round(stroke.size), points]))}`
}

/**
 * Thin a painted path: drop points closer than `minStep` (frame fractions) to
 * the last one kept, then keep at most `max`, evenly. Rounded to 1e-4.
 */
export function simplifyStroke(points, minStep, max = CUTOUT_MAX_STROKE_POINTS) {
  const kept = []
  for (const point of points) {
    const last = kept.at(-1)
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= minStep) kept.push(point)
  }
  const step = Math.max(1, kept.length / max)
  const out = []
  for (let i = 0; i < kept.length && out.length < max; i += step) out.push(kept[Math.floor(i)])
  const clamp = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4
  return out.map(([x, y]) => [clamp(x), clamp(y)])
}

/** Up to `max` points evenly spaced along the path (by length): the smart stroke's prompt. */
export function strokePromptPoints(points, max = SAM_MAX_POINTS) {
  if (points.length <= 1) return points.slice(0, 1)
  const lengths = [0]
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    lengths.push(lengths[i - 1] + Math.hypot(bx - ax, by - ay))
  }
  const total = lengths.at(-1)
  if (total === 0) return [points[0]]
  const count = Math.min(max, points.length)
  const out = []
  let seg = 1
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1)
    while (seg < points.length - 1 && lengths[seg] < target) seg++
    const span = lengths[seg] - lengths[seg - 1] || 1
    const t = Math.min(1, Math.max(0, (target - lengths[seg - 1]) / span))
    const [ax, ay] = points[seg - 1]
    const [bx, by] = points[seg]
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t])
  }
  return out
}

/** Distance from (px, py) to segment a-b. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Distance from a pixel to a path given in pixels. */
function pathDistance(px, py, path) {
  let best = Infinity
  for (let i = 0; i < path.length; i++) {
    const [ax, ay] = path[i]
    const [bx, by] = path[Math.min(i + 1, path.length - 1)]
    best = Math.min(best, segmentDistance(px, py, ax, ay, bx, by))
  }
  return best
}

/**
 * The painted area of a stroke as a 0/1 mask of `width` x `height` (a mask of
 * the source frame): discs of the brush radius along the path. The smart
 * stroke keeps the SlimSAM candidate that overlaps it best.
 */
export function strokeRaster(stroke, width, height) {
  const radius = Math.max(0.5, stroke.size * Math.min(width, height))
  const path = stroke.points.map(([x, y]) => [x * width, y * height])
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pathDistance(x + 0.5, y + 0.5, path) <= radius) out[y * width + x] = 1
    }
  }
  return out
}

/**
 * The sample range a smart stroke's region is tracked over: the clip's
 * samples plus the stroke's own frame, [first, last], with `start` the sample
 * the stroke was painted on.
 */
export function regionTrackRange(stroke, rate, need, maxIndex = Infinity) {
  const start = Math.min(maxIndex, Math.max(0, Math.round(stroke.at * rate)))
  const first = Math.min(start, need?.[0] ?? start)
  const last = Math.max(start, need?.[1] ?? start)
  return { start, first, last }
}

/** Segment one sample, keep the candidate closest to `reference(size)`. */
async function segmentStep(segment, index, points, reference) {
  const result = await segment(index, points)
  if (!result) return null
  const size = { width: result.width, height: result.height }
  const pick = pickSamCandidate(result.candidates, result.scores, reference(size))
  const mask = result.candidates[pick.index]
  return { index, mask, ...size, iou: pick.iou, stats: regionStats(mask, size.width, size.height) }
}

/**
 * Track a smart stroke's region over samples [first, last]: on `start` (the
 * frame it was painted on) prompt with up to 16 points along the stroke and
 * keep the candidate that best overlaps the painted area; then forward to
 * `last` and backward to `first`, prompting each next sample with interior
 * points of the previous region and keeping the candidate that overlaps it
 * best. A direction stops when that overlap drops below `minIoU` (the region
 * is lost) or a frame is missing. `segment(index, points)` runs the model:
 * { candidates, scores, width, height } or null. Yields each kept region.
 */
export async function* trackRegion({ stroke, start, first, last, segment, minIoU = SAM_MIN_TRACK_IOU }) {
  const painted = (size) => strokeRaster(stroke, size.width, size.height)
  const seed = await segmentStep(segment, start, strokePromptPoints(stroke.points), painted)
  if (!seed?.stats) return
  yield seed
  for (const step of [1, -1]) {
    let previous = seed
    for (let index = start + step; index >= first && index <= last; index += step) {
      const prompt = interiorPoints(previous.mask, previous.width, previous.height)
      const next = await segmentStep(segment, index, prompt, () => previous.mask)
      if (!next?.stats || next.iou < minIoU) break
      yield next
      previous = next
    }
  }
}

/** Whether a region entry has been tracked over all of [first, last]. */
export function regionCovers(entry, first, last) {
  return (entry?.covered ?? []).some(([a, b]) => a <= first && b >= last)
}

/** The stored sample nearest to `index` (ties go to the earlier one), or null. */
function nearestStat(stats, index) {
  let best = null
  for (const key of Object.keys(stats)) {
    const i = Number(key)
    if (best === null || Math.abs(i - index) < Math.abs(best - index)) best = i
  }
  return best === null ? null : stats[best]
}

/** A region's stats at `seconds`: interpolated between its two samples, else the nearest. */
function statsAt(stats, rate, seconds) {
  const position = Math.max(0, seconds * rate)
  const i0 = Math.floor(position)
  const a = stats[i0]
  const b = stats[i0 + 1]
  if (a && b) {
    const t = position - i0
    return a.map((v, k) => v + (b[k] - v) * t)
  }
  return a ?? nearestStat(stats, Math.round(position))
}

const strokeCentre = (stroke) => {
  const n = stroke.points.length
  return stroke.points.reduce(([sx, sy], [x, y]) => [sx + x / n, sy + y / n], [0, 0])
}

const boxArea = (s) => (s[4] - s[2]) * (s[5] - s[3])
const inBox = ([x, y], s) => x >= s[2] && x <= s[4] && y >= s[3] && y <= s[5]

/**
 * How far a plain stroke moves at `seconds`: it follows the tracked region
 * whose box held the stroke's centre on the frame it was painted on (the
 * smallest such box), by that region's centroid motion. [0, 0] when no tracked
 * region holds it (the stroke then applies where it was painted, on every frame).
 */
export function strokeFollowOffset(stroke, regions, seconds) {
  const centre = strokeCentre(stroke)
  let host = null
  for (const region of regions) {
    const then = statsAt(region.stats ?? {}, region.rate, stroke.at)
    if (!then || !inBox(centre, then)) continue
    if (!host || boxArea(then) < boxArea(host.then)) host = { region, then }
  }
  if (!host) return [0, 0]
  const now = statsAt(host.region.stats, host.region.rate, seconds)
  return now ? [now[0] - host.then[0], now[1] - host.then[1]] : [0, 0]
}

/** Add a stroke to cutout settings (a new cutout starts on, auto subject). */
export function withCutoutStroke(current, stroke) {
  const base = current ?? { enabled: true, subject: 'auto' }
  return { ...base, strokes: [...(base.strokes ?? []), stroke] }
}

/** Cutout settings without strokes. */
export function withoutCutoutStrokes(current) {
  if (!current) return current
  const { strokes: _strokes, ...rest } = current
  return rest
}
