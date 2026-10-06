// The beat plan (`<workspace>/projects/<id>/agent/plan.json`): reading it, in
// either schema version, into one normalized shape. Pure: no files, no format.
//
// v2 (story first):
//   { schemaVersion: 2, fps, durationFrames, request, story: { arc, structure },
//     sources: [...], beats: [{ id, role, edit: [start, end], source: { mediaId | asset,
//     in, unit: 's' | 'frames' }, takeaway, why, treatment, sound, text?, track?, gapBefore? }] }
// v1 (no schemaVersion): the same beats without role or why, `source.in` in frames.
//
// Frames are at the plan's fps, which must be the project's; `edit` is
// [start, end) on the timeline; `source.in` is where the beat's clip starts in
// its source, in seconds (`unit: 's'`) or frames at the plan's fps (`'frames'`,
// v1's only unit).

const PLAN_SCHEMA_VERSION = 2
const TEXT_ROLES = new Set(['title', 'labels'])

const isInt = (value) => Number.isInteger(value)
const isText = (value) => typeof value === 'string' && value.trim().length > 0

/** Collects errors and warnings, each tied to a beat id or 'plan'. */
export function issueList() {
  const errors = []
  const warnings = []
  return {
    errors,
    warnings,
    error: (where, message) => errors.push({ where, message }),
    warn: (where, message) => warnings.push({ where, message }),
  }
}

/** `[start, end)` as whole frames with start < end, else null. */
function frameRange(value) {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [start, end] = value
  return isInt(start) && isInt(end) && start >= 0 && end > start ? { start, end } : null
}

const trimmed = (value) => (isText(value) ? value.trim() : '')
const plain = (value) => (typeof value === 'string' ? value : '')
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The first message whose rule is broken: `[[broken, message], ...]`, else null. */
const firstProblem = (rules) => rules.find(([broken]) => broken)?.[1] ?? null

function checkTiming(raw, projectFps, issues) {
  const fps = raw.fps
  const problem = firstProblem([
    [!(typeof fps === 'number' && fps > 0), '`fps` must be a number above 0'],
    [
      Boolean(projectFps) && fps !== projectFps,
      `fps ${fps} is not the project's ${projectFps}: write frames at the project's fps`,
    ],
  ])
  if (problem) issues.error('plan', problem)
  if (!(isInt(raw.durationFrames) && raw.durationFrames > 0))
    issues.error('plan', '`durationFrames` must be a whole number of frames above 0')
}

function checkStory(raw, story, version, issues) {
  if (version === 1) {
    issues.error(
      'plan',
      'schemaVersion 1 has no story: rewrite it as v2 (request, story.arc, a role and a why per beat) before building',
    )
    return
  }
  if (!isText(raw.request))
    issues.error('plan', "`request` is missing: start with the user's ask, in their words")
  if (!isText(story.arc))
    issues.error('plan', '`story.arc` is missing: say the order of the story and why')
}

function readHeader(raw, version, issues, projectFps) {
  const story = isObject(raw.story) ? raw.story : {}
  checkTiming(raw, projectFps, issues)
  checkStory(raw, story, version, issues)
  return {
    version,
    fps: typeof raw.fps === 'number' ? raw.fps : 0,
    durationFrames: isInt(raw.durationFrames) ? raw.durationFrames : 0,
    request: trimmed(raw.request),
    story: {
      arc: trimmed(story.arc),
      structure: Array.isArray(story.structure) ? story.structure.map(String) : [],
    },
    sources: Array.isArray(raw.sources) ? raw.sources : [],
  }
}

const hasIn = (source) => source.in !== undefined && source.in !== null

function sourceProblem(source, unit) {
  if (!isObject(source) || !(isText(source.mediaId) || isText(source.asset)))
    return '`source` needs a `mediaId` (imported) or an `asset` (a catalogued file)'
  if (!hasIn(source)) return null
  return firstProblem([
    [!(typeof source.in === 'number' && source.in >= 0), '`source.in` must be a number, 0 or more'],
    [
      unit !== 's' && unit !== 'frames',
      "`source.unit` says what `in` counts: 's' (seconds) or 'frames' (plan fps)",
    ],
  ])
}

/** The media a source names: an imported id and/or a catalogued file. */
const sourceRef = (source) => ({
  ...(isText(source.mediaId) ? { mediaId: source.mediaId.trim() } : {}),
  ...(isText(source.asset) ? { asset: source.asset.trim() } : {}),
})
/** `in` in source seconds: frames count at the plan's fps. */
const inSeconds = (source, unit, fps) => {
  const at = hasIn(source) ? source.in : 0
  return unit === 'frames' ? at / fps : at
}
const unitOf = (source, version) => source?.unit ?? (version === 1 ? 'frames' : undefined)

function readSource(source, version, fps, where, issues) {
  const unit = unitOf(source, version)
  const problem = sourceProblem(source, unit)
  if (problem) {
    issues.error(where, problem)
    return null
  }
  return { ...sourceRef(source), inSec: inSeconds(source, unit, fps || 1) }
}

const hasText = (text) => text !== undefined && text !== null && text !== ''
const textSpec = (text) => (typeof text === 'string' ? { text } : isObject(text) ? text : {})
/** A title on the hook, a label elsewhere, unless the text says. */
const textRole = (spec, beat) => spec.role ?? (beat.role === 'hook' ? 'title' : 'labels')
const textSpan = (spec, beat) =>
  spec.edit === undefined ? { start: beat.start, end: beat.end } : frameRange(spec.edit)
const styleOf = (spec) => (isText(spec.style) ? { style: spec.style } : {})

function readText(text, beat, where, issues) {
  if (!hasText(text)) return null
  const spec = textSpec(text)
  const role = textRole(spec, beat)
  const span = textSpan(spec, beat)
  const problem = firstProblem([
    [!isText(spec.text), '`text` is a string or { text, role?, edit?, style? }'],
    [!TEXT_ROLES.has(role), `text role "${role}" is not title or labels`],
    [!span, '`text.edit` must be [start, end) in whole frames, start < end'],
  ])
  if (problem) {
    issues.error(where, problem)
    return null
  }
  return { text: spec.text, role, ...span, ...styleOf(spec) }
}

/** What a beat says beyond its timing and source. */
const beatWords = (raw) => ({
  role: trimmed(raw.role) || null,
  takeaway: trimmed(raw.takeaway),
  why: trimmed(raw.why),
  treatment: plain(raw.treatment),
  sound: plain(raw.sound),
  track: trimmed(raw.track) || null,
  gapBefore: raw.gapBefore === true,
})

function checkBeatWords(raw, id, version, issues) {
  if (!isText(raw.id)) issues.error(id, '`id` is missing')
  if (!isText(raw.takeaway))
    issues.warn(id, "no takeaway: if you can't say what the viewer gets here, cut the beat")
  if (version < 2) return
  if (!isText(raw.role))
    issues.error(id, '`role` is missing: the story section this beat belongs to (hook, body, ...)')
  if (!isText(raw.why)) issues.warn(id, 'no why: say why this beat is here and in this order')
}

function readBeat(raw, index, header, issues) {
  const id = trimmed(raw?.id) || `beat ${index + 1}`
  if (!raw || typeof raw !== 'object') {
    issues.error(id, 'a beat is an object')
    return null
  }
  checkBeatWords(raw, id, header.version, issues)
  const span = frameRange(raw.edit)
  if (!span) issues.error(id, '`edit` must be [start, end) in whole frames, start < end')
  const source = readSource(raw.source, header.version, header.fps, id, issues)
  if (!span || !source) return null
  const beat = { id, ...span, source, ...beatWords(raw) }
  beat.text = readText(raw.text, beat, id, issues)
  return beat
}

/**
 * Read a plan (parsed JSON) of either version. Returns the normalized plan and
 * the problems found in its shape; the format, media and timing rules are
 * checked by ./validate.mjs.
 */
export function readPlan(raw, { projectFps } = {}) {
  const issues = issueList()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.error('plan', 'the plan is a JSON object')
    return { plan: null, ...issues }
  }
  const version = raw.schemaVersion ?? 1
  if (version !== 1 && version !== PLAN_SCHEMA_VERSION) {
    issues.error('plan', `schemaVersion ${version} is unknown (1 or ${PLAN_SCHEMA_VERSION})`)
    return { plan: null, ...issues }
  }
  const header = readHeader(raw, version, issues, projectFps)
  if (!Array.isArray(raw.beats) || raw.beats.length === 0) issues.error('plan', 'no beats')
  const beats = (Array.isArray(raw.beats) ? raw.beats : [])
    .map((beat, index) => readBeat(beat, index, header, issues))
    .filter(Boolean)
  const seen = new Set()
  for (const beat of beats) {
    if (seen.has(beat.id)) issues.error(beat.id, 'beat id is used twice')
    seen.add(beat.id)
  }
  return { plan: { ...header, beats }, errors: issues.errors, warnings: issues.warnings }
}
