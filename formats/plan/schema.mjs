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

function readHeader(raw, version, issues, projectFps) {
  const fps = raw.fps
  if (!(typeof fps === 'number' && fps > 0)) issues.error('plan', '`fps` must be a number above 0')
  else if (projectFps && fps !== projectFps)
    issues.error(
      'plan',
      `fps ${fps} is not the project's ${projectFps}: write frames at the project's fps`,
    )
  if (!(isInt(raw.durationFrames) && raw.durationFrames > 0))
    issues.error('plan', '`durationFrames` must be a whole number of frames above 0')
  const story = raw.story && typeof raw.story === 'object' ? raw.story : {}
  if (version === 1) {
    issues.error(
      'plan',
      'schemaVersion 1 has no story: rewrite it as v2 (request, story.arc, a role and a why per beat) before building',
    )
  } else {
    if (!isText(raw.request))
      issues.error('plan', "`request` is missing: start with the user's ask, in their words")
    if (!isText(story.arc))
      issues.error('plan', '`story.arc` is missing: say the order of the story and why')
  }
  return {
    version,
    fps: typeof fps === 'number' ? fps : 0,
    durationFrames: isInt(raw.durationFrames) ? raw.durationFrames : 0,
    request: isText(raw.request) ? raw.request.trim() : '',
    story: {
      arc: isText(story.arc) ? story.arc.trim() : '',
      structure: Array.isArray(story.structure) ? story.structure.map(String) : [],
    },
    sources: Array.isArray(raw.sources) ? raw.sources : [],
  }
}

function readSource(source, version, fps, where, issues) {
  if (!source || typeof source !== 'object' || !(isText(source.mediaId) || isText(source.asset))) {
    issues.error(where, '`source` needs a `mediaId` (imported) or an `asset` (a catalogued file)')
    return null
  }
  const unit = source.unit ?? (version === 1 ? 'frames' : undefined)
  const given = source.in !== undefined && source.in !== null
  if (given && !(typeof source.in === 'number' && source.in >= 0)) {
    issues.error(where, '`source.in` must be a number, 0 or more')
    return null
  }
  if (given && unit !== 's' && unit !== 'frames') {
    issues.error(where, "`source.unit` says what `in` counts: 's' (seconds) or 'frames' (plan fps)")
    return null
  }
  const at = given ? source.in : 0
  return {
    ...(isText(source.mediaId) ? { mediaId: source.mediaId.trim() } : {}),
    ...(isText(source.asset) ? { asset: source.asset.trim() } : {}),
    inSec: unit === 'frames' ? at / (fps || 1) : at,
  }
}

function readText(text, beat, where, issues) {
  if (text === undefined || text === null || text === '') return null
  const spec = typeof text === 'string' ? { text } : text
  if (!spec || typeof spec !== 'object' || !isText(spec.text)) {
    issues.error(where, '`text` is a string or { text, role?, edit?, style? }')
    return null
  }
  const role = spec.role ?? (beat.role === 'hook' ? 'title' : 'labels')
  if (!TEXT_ROLES.has(role)) {
    issues.error(where, `text role "${role}" is not title or labels`)
    return null
  }
  const span =
    spec.edit === undefined ? { start: beat.start, end: beat.end } : frameRange(spec.edit)
  if (!span) {
    issues.error(where, '`text.edit` must be [start, end) in whole frames, start < end')
    return null
  }
  return { text: spec.text, role, ...span, ...(isText(spec.style) ? { style: spec.style } : {}) }
}

const trimmed = (value) => (isText(value) ? value.trim() : '')
const plain = (value) => (typeof value === 'string' ? value : '')

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
