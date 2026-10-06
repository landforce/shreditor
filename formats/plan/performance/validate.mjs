// Checking a read performance plan (./read.mjs) against the format, the media
// it names and the speakers' transcripts, and laying out the cut it makes
// (./layout.mjs): each kept line's frames, its visuals and on-screen text.
// Pure: the caller resolves media and transcript words.
//
// Errors are what would build a wrong edit: unknown media, a line past the end
// of its clip, two takes of one line both kept, a role the format doesn't have,
// a cut that doesn't open on its hook, a visual with nothing to show, two
// visuals on one track at once. Everything else is a warning: a line's text not
// matching what is said, lengths, story order.
import { issueList } from '../shape.mjs'
import {
  checkOverlaps,
  checkPlanMode,
  checkRequiredParts,
  checkRoleNames,
  checkStoryOrder,
  groupBy,
} from '../validate.mjs'
import { VISUAL_ROLES } from './read.mjs'
import { layoutPerformance, pointFrame } from './layout.mjs'
import { joinText, similarity, wordsIn } from './words.mjs'

/** Below this, a kept line's text is not what its transcript says (./words.mjs similarity). */
const TEXT_MATCH = 0.6
const SLACK_SEC = 0.05

const sec = (value) => `${value.toFixed(2)} s`
const frames = (count, fps) => sec(count / fps)

function speechMedia(line, resolveMedia, issues) {
  const media = resolveMedia({ mediaId: line.source.mediaId })
  if (!media || media.error) {
    issues.error(line.id, media?.error ?? 'its source media was not found')
    return null
  }
  if (media.kind === 'image') {
    issues.error(line.id, `${media.fileName} is a still: a line comes from a speaker clip`)
    return null
  }
  if (line.source.outSec > media.duration + SLACK_SEC)
    issues.error(
      line.id,
      `runs to ${sec(line.source.outSec)}, but ${media.fileName} is ${sec(media.duration)} long`,
    )
  return media
}

function checkText(line, issues) {
  if (!line.keep || !line.words) return
  const said = joinText(line.words)
  const where = `${sec(line.source.inSec)}-${sec(line.source.outSec)}`
  if (!line.text) issues.warn(line.id, `no text: the transcript at ${where} says "${said}"`)
  else if (similarity(line.text, said) < TEXT_MATCH)
    issues.warn(
      line.id,
      `the text is not what is said at ${where}; the transcript says "${said || '(nothing)'}"`,
    )
}

/** Each line with its `media` and the transcript `words` it covers (null: no transcript). */
function resolveLines(lines, { resolveMedia, wordsFor }, issues) {
  const untranscribed = new Set()
  const resolved = lines.map((line) => {
    const media = speechMedia(line, resolveMedia, issues)
    const all = media ? wordsFor(media.mediaId) : null
    if (media && !all) untranscribed.add(media.fileName)
    const words = all ? wordsIn(all, line.source.inSec, line.source.outSec) : null
    const entry = { ...line, media, words }
    checkText(entry, issues)
    return entry
  })
  for (const name of untranscribed)
    issues.warn(
      'plan',
      `no transcript for ${name}: its lines' text and word points are not checked (shred transcript <mediaId>)`,
    )
  return resolved
}

/** Lines linked by `takeOf`, as groups of two or more takes. */
function takeGroups(lines) {
  const parent = new Map(lines.map((line) => [line.id, line.id]))
  const root = (id) => (parent.get(id) === id ? id : root(parent.get(id)))
  for (const line of lines.filter((l) => l.takeOf && parent.has(l.takeOf)))
    parent.set(root(line.id), root(line.takeOf))
  return [...groupBy(lines, (line) => root(line.id)).values()].filter((group) => group.length > 1)
}

function checkTakes(lines, issues) {
  const ids = new Set(lines.map((line) => line.id))
  for (const line of lines.filter((l) => l.takeOf && !ids.has(l.takeOf)))
    issues.error(line.id, `takeOf "${line.takeOf}" is not a line of the plan`)
  for (const group of takeGroups(lines)) {
    const names = group.map((line) => line.id).join(', ')
    const kept = group.filter((line) => line.keep)
    if (kept.length > 1)
      issues.error(
        kept[1].id,
        `${names} are takes of one line and ${kept.map((line) => line.id).join(' and ')} are kept: keep one`,
      )
    if (!kept.length) issues.warn(group[0].id, `every take of ${names} is cut: none of it plays`)
  }
}

function checkSpeakers(plan, lines, resolveMedia, issues) {
  const { speaker } = plan.performance
  for (const id of speaker) {
    const media = resolveMedia({ mediaId: id })
    if (!media || media.error) issues.error('plan', `speaker ${id}: ${media?.error ?? 'not found'}`)
  }
  for (const line of lines.filter((l) => !speaker.includes(l.source.mediaId)))
    issues.warn(line.id, `${line.source.mediaId} is not in performance.speaker`)
}

function checkShape(kept, format, issues) {
  const first = kept[0]
  if (!first) {
    issues.error('plan', 'no kept lines: the cut would be empty')
    return
  }
  if (first.role !== 'hook')
    issues.error(
      first.id,
      `the first kept line plays ${first.role ?? 'no role'}: the video opens on its hook (role "hook")`,
    )
  checkRequiredParts(kept, format, issues, 'line')
  checkStoryOrder(kept, format, issues)
}

/** The visual's media: an imported id, else a catalogued or imported file. */
function assetMedia(asset, resolveMedia) {
  if (!asset) return null
  const byId = resolveMedia({ mediaId: asset })
  return byId && !byId.error ? byId : resolveMedia({ asset })
}

/** The track role a visual goes on: its `track` (role or format track name), else its category's, else the format's for stills. */
function visualTrackRole(visual, media, format) {
  if (visual.track) {
    const wanted = visual.track.toLowerCase()
    const named = format.tracks.find((t) => t.name.toLowerCase() === wanted)?.role ?? wanted
    return VISUAL_ROLES.includes(named) ? named : null
  }
  const byCategory = media ? format.categoryRoles[media.category] : null
  if (VISUAL_ROLES.includes(byCategory)) return byCategory
  const still = format.defaultRoles.image
  return VISUAL_ROLES.includes(still) ? still : 'images'
}

/** `{ start, end }` frames of a visual or text in its line's span, or null with the error reported. */
function timed(entry, line, context, where, issues) {
  const at = { line, span: context.spans.get(line.id), words: line.words, ...context }
  const start = pointFrame(entry.at, 'at', at)
  const end = pointFrame(entry.until, 'until', at)
  const problem =
    start.error ??
    end.error ??
    (end.frame <= start.frame
      ? `ends at frame ${end.frame}, not after it starts (${start.frame})`
      : null)
  if (problem) {
    issues.error(where, problem)
    return null
  }
  return { start: start.frame, end: end.frame }
}

function visualMediaProblem(visual, media, length, fps) {
  if (!visual.asset) return null
  if (!media || media.error) return media?.error ?? `${visual.asset} was not found`
  if (media.kind === 'audio') return `${media.fileName} is audio: a visual is a picture`
  const needSec = visual.in + length / fps
  if (media.kind === 'video' && needSec > media.duration + SLACK_SEC)
    return `needs ${media.fileName} from ${sec(visual.in)} to ${sec(needSec)}, but it is ${sec(media.duration)} long`
  return null
}

const usable = (media) => (media && !media.error ? media : null)

function warnUnimported(id, media, issues) {
  if (media && !media.mediaId)
    issues.warn(
      id,
      `${media.fileName} is catalogued but not imported: shred import it before shred build`,
    )
}

/** `{ start, end }` of a visual whose media fits, or null with the error reported. */
function visualSpan(visual, media, line, context, id, issues) {
  const span = timed(visual, line, context, id, issues)
  const problem = span && visualMediaProblem(visual, media, span.end - span.start, context.fps)
  if (problem) issues.error(id, problem)
  return problem ? null : span
}

function placeVisual(visual, k, line, context, issues) {
  const id = `${line.id}-v${k + 1}`
  const media = assetMedia(visual.asset, context.resolveMedia)
  const trackRole = visualTrackRole(visual, usable(media), context.format)
  if (!trackRole) {
    issues.error(id, `track "${visual.track}" is not one of ${VISUAL_ROLES.join(', ')}`)
    return null
  }
  const span = visualSpan(visual, media, line, context, id, issues)
  if (!span) return null
  warnUnimported(id, media, issues)
  const toSource = media ? null : visual.toSource
  return { id, lineId: line.id, visual, media, trackRole, toSource, ...span }
}

function placeText(line, isFirst, context, issues) {
  const spec = line.onScreen
  if (!spec) return null
  const role = spec.role ?? (isFirst && line.role === 'hook' ? 'title' : 'labels')
  const span = timed(spec, line, context, line.id, issues)
  if (!span) return null
  return {
    id: `${line.id}-text`,
    lineId: line.id,
    text: spec.text,
    role,
    ...span,
    ...(spec.style ? { style: spec.style } : {}),
  }
}

function checkCutExtras(lines, issues) {
  for (const line of lines.filter((l) => !l.keep && (l.visuals.length || l.onScreen)))
    issues.warn(line.id, 'is cut: its visuals and on-screen text are left out')
}

function checkLength(plan, durationFrames, briefTargetSec, issues) {
  const { fps } = plan
  if (plan.durationFrames && plan.durationFrames !== durationFrames)
    issues.warn(
      'plan',
      `the kept lines run ${frames(durationFrames, fps)} (${durationFrames} frames); durationFrames says ${plan.durationFrames} (it is optional here: leave it out)`,
    )
  const targetSec = Number(briefTargetSec)
  if (targetSec > 0 && Math.abs(durationFrames / fps - targetSec) > Math.max(1, targetSec * 0.1))
    issues.warn(
      'plan',
      `${frames(durationFrames, fps)} long; the brief asks for about ${targetSec} s`,
    )
}

function checkPad(plan, format, issues) {
  const pause = format.targets.find((target) => target.key === 'pauseMaxSec')?.max
  const padSec = plan.performance.padFrames / plan.fps
  if (pause && 2 * padSec > pause)
    issues.warn(
      'plan',
      `padFrames ${plan.performance.padFrames} leaves up to ${sec(2 * padSec)} of silence at each cut; ${format.name}'s longest pause is ${sec(pause)}`,
    )
}

/**
 * Validate a read performance plan and lay out its cut. `resolveMedia(source)`
 * as for story plans (../validate.mjs); `wordsFor(mediaId)` returns that
 * media's transcript words (`{ text, start, end }`, source seconds) or null.
 * Returns the lines (with `media` and `words`), the layout (`runs`, `spans`,
 * `durationFrames`, `visuals`, `texts`), errors and warnings.
 */
export function validatePerformance(plan, { format, resolveMedia, wordsFor, briefTargetSec }) {
  const issues = issueList()
  checkPlanMode(plan, format, issues)
  const lines = resolveLines(plan.performance.lines, { resolveMedia, wordsFor }, issues)
  checkRoleNames(plan, lines, format, issues)
  checkTakes(lines, issues)
  checkSpeakers(plan, lines, resolveMedia, issues)
  checkCutExtras(lines, issues)
  checkPad(plan, format, issues)
  const kept = lines.filter((line) => line.keep)
  checkShape(kept, format, issues)
  const layout = layoutPerformance(plan, lines)
  const context = { fps: plan.fps, spans: layout.spans, format, resolveMedia }
  const placed = kept.filter((line) => line.media)
  const visuals = placed.flatMap((line) =>
    line.visuals.map((visual, k) => placeVisual(visual, k, line, context, issues)).filter(Boolean),
  )
  const texts = placed.map((line, i) => placeText(line, i === 0, context, issues)).filter(Boolean)
  checkOverlaps(
    groupBy(visuals, (visual) => visual.trackRole),
    plan.fps,
    issues,
  )
  checkOverlaps(
    groupBy(texts, (text) => text.role),
    plan.fps,
    issues,
  )
  checkLength(plan, layout.durationFrames, briefTargetSec, issues)
  return {
    lines,
    layout: { ...layout, visuals, texts },
    errors: issues.errors,
    warnings: issues.warnings,
  }
}
