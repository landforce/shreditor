// Checking a read plan (./schema.mjs) against the project's format and the
// media it names. Pure: the caller resolves each beat's source to media facts.
//
// Errors are what would build a wrong edit (unknown media, an in-point past the
// end of its clip, two beats on one track at once, a role the format doesn't
// have, no hook at frame 0). Everything else is a warning: gaps, length drift,
// story order, a missing takeaway. The format's numbers are guidelines.
import { issueList } from './schema.mjs'

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

function checkRoles(plan, format, issues) {
  const roles = format.structure.map((part) => part.role)
  const known = `${format.name} uses ${roles.join(', ')}`
  for (const role of plan.story.structure)
    if (!roles.includes(role)) issues.error('plan', `story.structure has "${role}": ${known}`)
  for (const beat of plan.beats)
    if (beat.role && !roles.includes(beat.role))
      issues.error(beat.id, `role "${beat.role}" is not in the format's structure: ${known}`)
  if (plan.version >= 2 && !plan.beats.some((beat) => beat.role === 'hook' && beat.start === 0))
    issues.error('plan', 'no hook beat at frame 0: the video opens on its hook')
  const used = new Set(plan.beats.map((beat) => beat.role))
  for (const part of format.structure)
    if (part.required && plan.version >= 2 && !used.has(part.role))
      issues.warn('plan', `no ${part.role} beat (${format.name}'s ${part.name}: ${part.note})`)
}

function checkStoryOrder(beats, format, issues) {
  const rank = (role) => format.structure.findIndex((part) => part.role === role)
  const ordered = [...beats].filter((b) => rank(b.role) >= 0).sort((a, b) => a.start - b.start)
  for (const [i, beat] of ordered.entries()) {
    const before = ordered[i - 1]
    if (before && rank(beat.role) < rank(before.role))
      issues.warn(
        beat.id,
        `${beat.role} after ${before.id} (${before.role}): the format's story runs ${format.structure.map((p) => p.role).join(' → ')}`,
      )
  }
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

function checkOverlaps(groups, fps, issues) {
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

const groupBy = (entries, key) => {
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
  checkRoles(plan, format, issues)
  checkStoryOrder(plan.beats, format, issues)
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
