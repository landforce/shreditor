// Reading a performance plan's `performance` section (schema v3, mode
// 'performance'): the speaker media and the lines of their performance, each
// kept or cut, with the visuals and on-screen text that go with it. Pure; the
// media, transcript and format rules are checked by ./validate.mjs.
//
//   performance: {
//     speaker: [mediaId, ...],          // the speaker clips (default: the lines' media)
//     padFrames: 2,                     // kept around each cut (default 0)
//     lines: [{
//       id, source: { mediaId, in, out, unit: 's' | 'frames' }, text, keep,
//       reason?: 'flub' | 'retake' | 'pause' | 'tangent' | 'false start' | 'dead air' | 'other',
//       takeOf?: <id of the take this one competes with>, role: <structure role>,
//       visuals?: [{ track?, asset?, toSource?, at?, until?, in?, fit?, note? }],
//       onScreen?: "text" | { text, role?: 'title' | 'labels', at?, until?, style? },
//       takeaway?, why?
//     }]
//   }
//
// A point in a line (`at`, `until`): seconds after its source in, a word or
// phrase the line says ("croissant"), `{ word: n }` (0-based), and for `until`
// also `{ line: id }` (the end of that kept line, to hold across lines).
import { firstProblem, isInt, isObject, isText, plain, trimmed } from '../shape.mjs'

const CUT_REASONS = Object.freeze([
  'flub',
  'retake',
  'pause',
  'tangent',
  'false start',
  'dead air',
  'other',
])
/** Tracks a line's visuals go on. */
export const VISUAL_ROLES = Object.freeze(['images', 'plates', 'broll', 'labels'])
const TEXT_ROLES = new Set(['title', 'labels'])
const FITS = new Set(['contain', 'cover'])

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

function sourceProblem(source) {
  if (!isObject(source) || !isText(source.mediaId))
    return '`source.mediaId` names the speaker clip the line is from'
  return firstProblem([
    [!(isNumber(source.in) && source.in >= 0), '`source.in` must be a number, 0 or more'],
    [!(isNumber(source.out) && source.out > source.in), '`source.out` must be a number after `in`'],
    [
      source.unit !== undefined && source.unit !== 's' && source.unit !== 'frames',
      "`source.unit` is 's' (seconds, the default) or 'frames' (at the plan's fps)",
    ],
  ])
}

function readSource(source, fps, where, issues) {
  const problem = sourceProblem(source)
  if (problem) {
    issues.error(where, problem)
    return null
  }
  const scale = source.unit === 'frames' ? 1 / (fps || 1) : 1
  return { mediaId: source.mediaId.trim(), inSec: source.in * scale, outSec: source.out * scale }
}

const POINT_FORMS = {
  number: (value) => (value >= 0 ? { sec: value } : null),
  string: (value) => (isText(value) ? { phrase: value.trim() } : null),
  object: (value, untilPoint) => {
    if (isInt(value?.word) && value.word >= 0) return { word: value.word }
    if (untilPoint && isText(value?.line)) return { line: value.line.trim() }
    return null
  },
}

/** `at` / `until`: undefined (the line's edge), a point, or `{ error }`. */
function readPoint(value, name) {
  if (value === undefined || value === null) return undefined
  const point = POINT_FORMS[typeof value]?.(value, name === 'until') ?? null
  if (point) return point
  const forms =
    name === 'until'
      ? 'seconds, a phrase, { word: n } or { line: id }'
      : 'seconds, a phrase or { word: n }'
  return { error: `\`${name}\` is ${forms}` }
}

/** at/until of a visual or on-screen text, with errors reported. */
function readSpan(raw, where, issues) {
  const at = readPoint(raw.at, 'at')
  const until = readPoint(raw.until, 'until')
  for (const point of [at, until].filter((p) => p?.error)) issues.error(where, point.error)
  return { at: at?.error ? undefined : at, until: until?.error ? undefined : until }
}

function visualProblem(raw) {
  if (!isObject(raw)) return 'a visual is { track?, asset?, toSource?, at?, until? }'
  return firstProblem([
    [
      !isText(raw.asset) && !isText(raw.toSource),
      'a visual needs an `asset` (a media id or a catalogued file) or `toSource` (what to find or make)',
    ],
    [raw.track !== undefined && !isText(raw.track), '`track` is a track role or name'],
    [raw.in !== undefined && !(isNumber(raw.in) && raw.in >= 0), '`in` is seconds into the asset'],
    [
      raw.fit !== undefined && !FITS.has(raw.fit) && !isObject(raw.fit),
      '`fit` is "contain", "cover" or a transform { x, y, width, height }',
    ],
  ])
}

function readVisual(raw, where, issues) {
  const problem = visualProblem(raw)
  if (problem) {
    issues.error(where, problem)
    return null
  }
  return {
    track: trimmed(raw.track) || null,
    asset: trimmed(raw.asset) || null,
    toSource: trimmed(raw.toSource) || null,
    ...readSpan(raw, where, issues),
    in: raw.in ?? 0,
    fit: raw.fit ?? null,
    note: plain(raw.note),
  }
}

const isEmpty = (value) => value === undefined || value === null || value === ''
const onScreenSpec = (raw) => (typeof raw === 'string' ? { text: raw } : isObject(raw) ? raw : {})

function readOnScreen(raw, where, issues) {
  if (isEmpty(raw)) return null
  const spec = onScreenSpec(raw)
  const problem = firstProblem([
    [!isText(spec.text), '`onScreen` is a string or { text, role?, at?, until?, style? }'],
    [spec.role !== undefined && !TEXT_ROLES.has(spec.role), '`onScreen.role` is title or labels'],
  ])
  if (problem) {
    issues.error(where, problem)
    return null
  }
  return {
    text: spec.text.trim(),
    role: spec.role ?? null,
    ...readSpan(spec, where, issues),
    ...(isText(spec.style) ? { style: spec.style.trim() } : {}),
  }
}

/** The keep / reason / takeOf rules: `[[broken, 'error' | 'warn', message], ...]`. */
const cutRules = (raw) => [
  [
    typeof raw.keep !== 'boolean',
    'error',
    '`keep` is true (the line is in the cut) or false (cut)',
  ],
  [
    raw.reason !== undefined && !CUT_REASONS.includes(raw.reason),
    'error',
    `reason "${raw.reason}" is not one of ${CUT_REASONS.join(', ')}`,
  ],
  [
    raw.keep === false && raw.reason === undefined,
    'warn',
    'cut without a `reason`: say why (flub, retake, pause, tangent...)',
  ],
  [
    raw.takeOf !== undefined && !isText(raw.takeOf),
    'error',
    '`takeOf` is the id of the line this take competes with',
  ],
  [isText(raw.takeOf) && raw.takeOf.trim() === raw.id, 'error', '`takeOf` names the line itself'],
]

function checkCut(raw, where, issues) {
  for (const [broken, level, message] of cutRules(raw)) if (broken) issues[level](where, message)
}

function checkLineWords(raw, where, issues) {
  if (!isText(raw.id)) issues.error(where, '`id` is missing')
  if (raw.keep === true && !isText(raw.role))
    issues.error(
      where,
      '`role` is missing: the structure role this line plays (hook, body, close...)',
    )
  if (raw.visuals !== undefined && !Array.isArray(raw.visuals))
    issues.error(where, '`visuals` is a list')
}

function readLine(raw, index, fps, issues) {
  const id = trimmed(raw?.id) || `line ${index + 1}`
  if (!isObject(raw)) {
    issues.error(id, 'a line is an object')
    return null
  }
  checkLineWords(raw, id, issues)
  checkCut(raw, id, issues)
  const source = readSource(raw.source, fps, id, issues)
  if (!source) return null
  const visuals = (Array.isArray(raw.visuals) ? raw.visuals : [])
    .map((visual) => readVisual(visual, id, issues))
    .filter(Boolean)
  return {
    id,
    index,
    source,
    text: plain(raw.text).trim(),
    keep: raw.keep === true,
    reason: CUT_REASONS.includes(raw.reason) ? raw.reason : null,
    takeOf: trimmed(raw.takeOf) || null,
    role: trimmed(raw.role) || null,
    visuals,
    onScreen: readOnScreen(raw.onScreen, id, issues),
    takeaway: trimmed(raw.takeaway),
    why: trimmed(raw.why),
  }
}

function readPad(raw, issues) {
  if (raw.padFrames === undefined) return 0
  if (isInt(raw.padFrames) && raw.padFrames >= 0) return raw.padFrames
  issues.error('plan', '`performance.padFrames` is a whole number of frames, 0 or more')
  return 0
}

function readSpeakers(raw, lines) {
  const listed = Array.isArray(raw.speaker) ? raw.speaker.filter(isText).map((id) => id.trim()) : []
  return listed.length ? listed : [...new Set(lines.map((line) => line.source.mediaId))]
}

/**
 * The `performance` section, normalized: `{ speaker, padFrames, lines }`
 * (lines in plan order, the unreadable ones dropped and reported), or null.
 */
export function readPerformance(raw, fps, issues) {
  if (!isObject(raw)) {
    issues.error('plan', '`performance` is { speaker: [mediaId], lines: [...] }')
    return null
  }
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) issues.error('plan', 'no lines')
  const lines = (Array.isArray(raw.lines) ? raw.lines : [])
    .map((line, index) => readLine(line, index, fps, issues))
    .filter(Boolean)
  const seen = new Set()
  for (const line of lines) {
    if (seen.has(line.id)) issues.error(line.id, 'line id is used twice')
    seen.add(line.id)
  }
  return { speaker: readSpeakers(raw, lines), padFrames: readPad(raw, issues), lines }
}
