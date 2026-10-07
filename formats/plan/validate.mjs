// Checking a read plan (./schema.mjs) against the project's format and the
// media it names. Pure: the caller resolves each beat's source to media facts.
//
// Errors are what would build a wrong edit (unknown media, an in-point past the
// end of its clip, two beats on one track at once, a role the format doesn't
// have, no hook at frame 0). Everything else is a warning: gaps, length drift,
// story order, a missing takeaway. The format's numbers are guidelines.
import { issueList } from './shape.mjs'

const PICTURE_ROLES = new Set(['speaker', 'images', 'plates', 'broll', 'shots', 'title'])
const AUDIO_ROLES = new Set(['speaker', 'voice', 'music', 'sfx'])

const sec = (frames, fps) => `${(frames / fps).toFixed(2)} s`
const span = ({ start, end }, fps) =>
  `frames ${start}-${end} [${(start / fps).toFixed(2)}-${(end / fps).toFixed(2)} s]`

/**
 * The role of the track a beat goes on: `beat.track` (a format track's name or
 * role), else its media's category in this format, else the format's default
 * for the media kind. null when `beat.track` names nothing usable.
 */
export function beatTrackRole(beat, media, format) {
  const allowed = media.kind === 'audio' ? AUDIO_ROLES : PICTURE_ROLES
  if (beat.track) {
    const wanted = beat.track.toLowerCase()
    const named = format.tracks.find((t) => t.name.toLowerCase() === wanted)?.role ?? wanted
    return allowed.has(named) ? named : null
  }
  const byCategory = format.categoryRoles[media.category]
  if (byCategory && allowed.has(byCategory)) return byCategory
  return format.defaultRoles[media.kind] ?? format.defaultRoles.video
}

/** Story roles (of beats or lines, and `story.structure`) come from the format. */
export function checkRoleNames(plan, entries, format, issues) {
  const roles = format.structure.map((part) => part.role)
  const known = `${format.name} uses ${roles.join(', ')}`
  for (const role of plan.story.structure.filter((r) => !roles.includes(r)))
    issues.error('plan', `story.structure has "${role}": ${known}`)
  for (const entry of entries.filter((e) => e.role && !roles.includes(e.role)))
    issues.error(entry.id, `role "${entry.role}" is not in the format's structure: ${known}`)
}

/** The format's required sections each have a beat (or kept line). */
export function checkRequiredParts(entries, format, issues, noun) {
  const used = new Set(entries.map((entry) => entry.role))
  for (const part of format.structure.filter((p) => p.required && !used.has(p.role)))
    issues.warn('plan', `no ${part.role} ${noun} (${format.name}'s ${part.name}: ${part.note})`)
}

/** v2 only (v1 beats have no roles): the hook opens the video; required sections are there. */
function checkStoryShape(plan, format, issues) {
  if (plan.version < 2) return
  if (!plan.beats.some((beat) => beat.role === 'hook' && beat.start === 0))
    issues.error('plan', 'no hook beat at frame 0: the video opens on its hook')
  checkRequiredParts(plan.beats, format, issues, 'beat')
}

/** Warns where a beat (or line) of `ordered`, in play order, steps back in the format's story. */
export function checkStoryOrder(ordered, format, issues) {
  const rank = (role) => format.structure.findIndex((part) => part.role === role)
  const ranked = ordered.filter((entry) => rank(entry.role) >= 0)
  for (const [i, entry] of ranked.entries()) {
    const before = ranked[i - 1]
    if (before && rank(entry.role) < rank(before.role))
      issues.warn(
        entry.id,
        `${entry.role} after ${before.id} (${before.role}): the format's story runs ${format.structure.map((p) => p.role).join(' → ')}`,
      )
  }
}

/** Warns when the plan's mode is not the one its format plans in (registry `planMode`). */
export function checkPlanMode(plan, format, issues) {
  const expected = format.planMode ?? 'story'
  if (plan.mode === expected) return
  issues.warn(
    'plan',
    expected === 'performance'
      ? `${format.name} has a speaker: its plan is the performance (mode "performance", the speaker's lines kept or cut with visuals per line; shred plan <id> --scaffold <speaker mediaIds> starts one), not a story of beats`
      : `${format.name} plans a story of beats (mode "story"); a performance plan is for the speaker formats, Graphic Yap and Greenscreen`,
  )
}

/** Errors for media that is missing or too short for the beat, and a note when not imported. */
function checkMedia(beat, media, fps, issues) {
  if (!media || media.error) {
    issues.error(beat.id, media?.error ?? 'its source media was not found')
    return false
  }
  if (!media.mediaId)
    issues.warn(
      beat.id,
      `${media.fileName} is catalogued but not imported: shred import it before shred build`,
    )
  if (media.kind === 'image') return true
  const needSec = beat.source.inSec + (beat.end - beat.start) / fps
  const slack = Math.max(0.05, 0.5 / fps)
  if (needSec > media.duration + slack)
    issues.error(
      beat.id,
      `needs ${media.fileName} from ${beat.source.inSec.toFixed(2)} to ${needSec.toFixed(2)} s, but it is ${media.duration.toFixed(2)} s long`,
    )
  return true
}

/** Errors for entries ({ id, start, end }) of one group that overlap. */
export function checkOverlaps(groups, fps, issues) {
  for (const [lane, entries] of groups) {
    const sorted = [...entries].sort((a, b) => a.start - b.start)
    for (const [i, entry] of sorted.entries()) {
      const before = sorted[i - 1]
      if (before && entry.start < before.end)
        issues.error(
          entry.id,
          `overlaps ${before.id} on the ${lane} track: ${span(before, fps)} and ${span(entry, fps)}`,
        )
    }
  }
}

export const groupBy = (entries, key) => {
  const groups = new Map()
  for (const entry of entries) groups.set(key(entry), [...(groups.get(key(entry)) ?? []), entry])
  return groups
}

/** Frames of [0, duration) no picture beat covers, as [start, end) runs. */
function uncovered(beats, duration) {
  const runs = []
  let at = 0
  for (const beat of [...beats].sort((a, b) => a.start - b.start)) {
    if (beat.start > at) runs.push({ start: at, end: beat.start })
    at = Math.max(at, beat.end)
  }
  if (at < duration) runs.push({ start: at, end: duration })
  return runs
}

function checkTiming(plan, pictures, briefTargetSec, issues) {
  const { fps, durationFrames } = plan
  for (const gap of uncovered(pictures, durationFrames)) {
    const next = pictures.find((beat) => beat.start === gap.end)
    if (!next?.gapBefore)
      issues.warn(
        next?.id ?? 'plan',
        `no picture at ${span(gap, fps)} (gapBefore: true if intended)`,
      )
  }
  const end = Math.max(0, ...plan.beats.map((beat) => beat.end))
  if (end !== durationFrames)
    issues.warn(
      'plan',
      `beats end at frame ${end} (${sec(end, fps)}); durationFrames is ${durationFrames} (${sec(durationFrames, fps)})`,
    )
  const targetSec = Number(briefTargetSec)
  if (targetSec > 0 && Math.abs(durationFrames / fps - targetSec) > Math.max(1, targetSec * 0.1))
    issues.warn('plan', `${sec(durationFrames, fps)} long; the brief asks for about ${targetSec} s`)
}

/**
 * Validate a read plan. `resolveMedia(source)` returns `{ mediaId, fileName,
 * kind: 'video'|'image'|'audio', duration, sourceFps, audioCodec, category }`
 * (mediaId null when only catalogued) or `{ error }`. Returns errors, warnings
 * and the beats with their `media` and `trackRole` (null for a beat whose
 * media or track could not be resolved).
 */
export function validatePlan(plan, { format, resolveMedia, briefTargetSec } = {}) {
  const issues = issueList()
  checkPlanMode(plan, format, issues)
  checkRoleNames(plan, plan.beats, format, issues)
  checkStoryShape(plan, format, issues)
  checkStoryOrder(
    [...plan.beats].sort((a, b) => a.start - b.start),
    format,
    issues,
  )
  const beats = plan.beats.map((beat) => {
    const media = resolveMedia(beat.source)
    if (!checkMedia(beat, media, plan.fps, issues)) return { ...beat, media: null, trackRole: null }
    const trackRole = beatTrackRole(beat, media, format)
    if (!trackRole)
      issues.error(beat.id, `track "${beat.track}" is not a ${media.kind} track of ${format.name}`)
    return { ...beat, media, trackRole }
  })
  const placed = beats.filter((beat) => beat.trackRole)
  checkOverlaps(
    groupBy(placed, (beat) => beat.trackRole),
    plan.fps,
    issues,
  )
  const texts = beats.filter((b) => b.text).map((b) => ({ id: b.id, ...b.text }))
  checkOverlaps(
    groupBy(texts, (text) => text.role),
    plan.fps,
    issues,
  )
  const pictures = placed.filter((beat) => beat.media.kind !== 'audio')
  checkTiming(plan, pictures, briefTargetSec, issues)
  return { beats, errors: issues.errors, warnings: issues.warnings }
}
