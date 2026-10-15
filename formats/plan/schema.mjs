// The plan (`<workspace>/projects/<id>/agent/plan.json`): reading it, in any
// schema version, into one normalized shape. Pure: no files, no format.
//
// v3 adds `mode`: 'story' (the v2 beats below) or 'performance' (a speaker's
// lines, kept or cut, with visuals per line: ./performance/read.mjs). Without a
// `mode`, a plan with `performance` is one, a plan with `beats` is a story, else
// the format's plan mode (`defaultMode`) applies. v2 and v1 are story plans.
//
// v2 (story first):
//   { schemaVersion: 2, fps, durationFrames, request, story: { arc, structure },
//     sources: [...], beats: [{ id, role, edit: [start, end], source: { mediaId | asset,
//     in, unit: 's' | 'frames' }, takeaway, why, treatment, sound, text?, track?, gapBefore? }] }
// v3 may also carry `template: { name, hash, source }` (the edit template it was
// scaffolded from, formats/edit-template/) and per beat `slot` and `targetSeconds`.
// v1 (no schemaVersion): the same beats without role or why, `source.in` in frames.
//
// Frames are at the plan's fps, which must be the project's; `edit` is
// [start, end) on the timeline; `source.in` is where the beat's clip starts in
// its source, in seconds (`unit: 's'`) or frames at the plan's fps (`'frames'`,
// v1's only unit).

import { readPerformance } from './performance/read.mjs'
import { firstProblem, isInt, isObject, issueList, isText, plain, trimmed } from './shape.mjs'

const PLAN_SCHEMA_VERSION = 3
const PLAN_MODES = new Set(['story', 'performance'])
const TEXT_ROLES = new Set(['title', 'labels'])

/** `[start, end)` as whole frames with start < end, else null. */
function frameRange(value) {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [start, end] = value
  return isInt(start) && isInt(end) && start >= 0 && end > start ? { start, end } : null
}

/** A performance plan's length comes from its kept lines: `durationFrames` is optional there. */
function checkDuration(raw, mode, issues) {
  if (mode === 'performance' && raw.durationFrames === undefined) return
  if (!(isInt(raw.durationFrames) && raw.durationFrames > 0))
    issues.error('plan', '`durationFrames` must be a whole number of frames above 0')
}

function checkTiming(raw, mode, projectFps, issues) {
  const fps = raw.fps
  const problem = firstProblem([
    [!(typeof fps === 'number' && fps > 0), '`fps` must be a number above 0'],
    [
      Boolean(projectFps) && fps !== projectFps,
      `fps ${fps} is not the project's ${projectFps}: write frames at the project's fps`,
    ],
  ])
  if (problem) issues.error('plan', problem)
  checkDuration(raw, mode, issues)
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

/** The edit template a plan was scaffolded from (`shred plan --template`), or null. */
function readTemplateRef(value, issues) {
  if (value === undefined || value === null) return null
  if (isObject(value) && isText(value.name))
    return { name: value.name.trim(), ...(isText(value.hash) ? { hash: value.hash } : {}) }
  issues.warn('plan', '`template` is { name, hash?, source? } (shred plan --template writes it)')
  return null
}

function readHeader(raw, version, mode, issues, projectFps) {
  const story = isObject(raw.story) ? raw.story : {}
  checkTiming(raw, mode, projectFps, issues)
  checkStory(raw, story, version, issues)
  return {
    template: readTemplateRef(raw.template, issues),
    version,
    mode,
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
  // From an edit template: the slot this beat fills and that slot's length on the reference.
  slot: trimmed(raw.slot) || null,
  targetSeconds: typeof raw.targetSeconds === 'number' ? raw.targetSeconds : null,
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

/** The plan's mode: v1 and v2 are stories; v3 says, or its shape does, or the format. */
function modeOf(raw, version, defaultMode) {
  if (version < 3) return 'story'
  if (raw.mode !== undefined) return raw.mode
  if (isObject(raw.performance)) return 'performance'
  return Array.isArray(raw.beats) ? 'story' : (defaultMode ?? 'story')
}

function versionProblem(raw, version) {
  if (![1, 2, PLAN_SCHEMA_VERSION].includes(version))
    return `schemaVersion ${version} is unknown (1, 2 or ${PLAN_SCHEMA_VERSION})`
  if (version < 3 && raw.mode === 'performance')
    return 'a performance plan is schemaVersion 3: set "schemaVersion": 3'
  return null
}

const notAPlan = (issues, message) => {
  issues.error('plan', message)
  return { plan: null, errors: issues.errors, warnings: issues.warnings }
}

/**
 * Read a plan (parsed JSON) of any version. Returns the normalized plan and
 * the problems found in its shape; the format, media and timing rules are
 * checked by ./validate.mjs (story) and ./performance/validate.mjs.
 * `defaultMode` is the format's plan mode, for a v3 plan that doesn't say.
 */
export function readPlan(raw, { projectFps, defaultMode } = {}) {
  const issues = issueList()
  if (!isObject(raw)) return notAPlan(issues, 'the plan is a JSON object')
  const version = raw.schemaVersion ?? 1
  const problem = versionProblem(raw, version)
  if (problem) return notAPlan(issues, problem)
  const mode = modeOf(raw, version, defaultMode)
  if (!PLAN_MODES.has(mode)) return notAPlan(issues, `mode "${mode}" is "story" or "performance"`)
  const header = readHeader(raw, version, mode, issues, projectFps)
  if (mode === 'performance') {
    const performance = readPerformance(raw.performance, header.fps, issues)
    return {
      plan: { ...header, beats: [], performance },
      errors: issues.errors,
      warnings: issues.warnings,
    }
  }
  return readStory(raw, header, issues)
}

function readStory(raw, header, issues) {
  if (!Array.isArray(raw.beats) || raw.beats.length === 0) issues.error('plan', 'no beats')
  const beats = (Array.isArray(raw.beats) ? raw.beats : [])
    .map((beat, index) => readBeat(beat, index, header, issues))
    .filter(Boolean)
  const seen = new Set()
  for (const beat of beats) {
    if (seen.has(beat.id)) issues.error(beat.id, 'beat id is used twice')
    seen.add(beat.id)
  }
  return {
    plan: { ...header, beats, performance: null },
    errors: issues.errors,
    warnings: issues.warnings,
  }
}
