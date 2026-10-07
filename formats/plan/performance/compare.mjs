// The edit against its performance plan (`shred check`'s Plan section): kept
// lines no longer on the timeline, kept lines now playing out of the planned
// order, cut lines that are back in, and length drift. A line is found by its
// source: a speaker clip of its media that plays most of it. Never a failure:
// the user's tweaks are decisions.
import { describe, lengthFinding, range } from '../compare.mjs'
import { firstWords } from './build.mjs'

/** Most of a kept line must play for it to count as there. */
const KEPT_SHARE = 0.8
/** A cut line counts as back in when half of it plays, and at least this long. */
const BACK_IN_SHARE = 0.5
const BACK_IN_MIN_SEC = 0.25
const SILENT_REASONS = new Set(['pause', 'dead air'])

/** Speaker clips on the timeline with their source windows in seconds. */
function speakerClips(items, mediaById, fps) {
  return items
    .filter((item) => item.type === 'video' && mediaById.has(item.mediaId))
    .map((item) => {
      const sourceFps = item.sourceFps || mediaById.get(item.mediaId).sourceFps || fps
      const speed = item.speed || 1
      const inSec = (item.sourceStart ?? 0) / sourceFps
      const outSec =
        item.sourceEnd !== undefined
          ? item.sourceEnd / sourceFps
          : inSec + (item.durationInFrames / fps) * speed
      return { item, inSec, outSec, speed }
    })
}

const playedSec = (clip, source) =>
  Math.max(0, Math.min(clip.outSec, source.outSec) - Math.max(clip.inSec, source.inSec))

/** The clip that plays most of a line's source, with how much: `{ clip, sec }` or null. */
function bestClip(line, clips) {
  return (
    clips
      .filter((clip) => clip.item.mediaId === line.source.mediaId)
      .map((clip) => ({ clip, sec: playedSec(clip, line.source) }))
      .sort((a, b) => b.sec - a.sec)[0] ?? null
  )
}

/** The timeline frame a line's source in-point plays at in `clip`. */
const frameIn = (line, clip, fps) =>
  clip.item.from +
  Math.round(((Math.max(line.source.inSec, clip.inSec) - clip.inSec) / clip.speed) * fps)

const lengthOf = (line) => line.source.outSec - line.source.inSec
const name = (line) =>
  `${line.id} ${line.role ?? (line.keep ? 'line' : 'cut')}${line.text ? ` "${firstWords(line.text)}"` : ''}`

function locateKept(kept, clips, fps) {
  return kept.map((line) => {
    const best = bestClip(line, clips)
    const there = best && best.sec >= KEPT_SHARE * lengthOf(line)
    return { line, frame: there ? frameIn(line, best.clip, fps) : null }
  })
}

function missingFindings(located, spans, fps) {
  return located
    .filter(({ frame }) => frame === null)
    .map(({ line }) => {
      const span = spans.get(line.id)
      const planned = range(span.start, span.end)
      return {
        level: 'warn',
        message: `${name(line)} is not on the timeline (planned at ${describe(planned, fps)})`,
        ranges: [planned],
      }
    })
}

function orderFindings(located, fps) {
  const found = located.filter(({ frame }) => frame !== null)
  return found.flatMap((entry, i) => {
    const before = found[i - 1]
    if (!before || entry.frame >= before.frame) return []
    const ranges = [range(entry.frame, entry.frame + 1), range(before.frame, before.frame + 1)]
    return [
      {
        level: 'warn',
        message: `${entry.line.id} now plays before ${before.line.id} (planned ${before.line.id} then ${entry.line.id}) at ${ranges.map((r) => describe(r, fps)).join(' and ')}`,
        ranges,
      },
    ]
  })
}

function backInFindings(cut, clips, fps) {
  return cut.flatMap((line) => {
    const best = bestClip(line, clips)
    if (!best || best.sec < BACK_IN_MIN_SEC || best.sec < BACK_IN_SHARE * lengthOf(line)) return []
    const start = frameIn(line, best.clip, fps)
    const at = range(start, start + Math.max(1, Math.round((best.sec / best.clip.speed) * fps)))
    return [
      {
        level: SILENT_REASONS.has(line.reason) ? 'info' : 'warn',
        message: `${name(line)} was cut (${line.reason ?? 'no reason'}) and is back in at ${describe(at, fps)}`,
        ranges: [at],
      },
    ]
  })
}

/**
 * Compare a timeline with a validated performance plan (`lines` with `media`,
 * `layout` from ./validate.mjs). Returns `{ findings, checked, skipped }` like
 * ../compare.mjs; lines whose media isn't imported are skipped.
 */
export function comparePerformance(plan, lines, layout, timeline) {
  const items = timeline?.items ?? []
  const usable = lines.filter((line) => line.media?.mediaId)
  const mediaById = new Map(usable.map((line) => [line.media.mediaId, line.media]))
  const clips = speakerClips(items, mediaById, plan.fps)
  const kept = usable.filter((line) => line.keep && layout.spans.has(line.id))
  const located = locateKept(kept, clips, plan.fps)
  const findings = [
    ...missingFindings(located, layout.spans, plan.fps),
    ...orderFindings(located, plan.fps),
    ...backInFindings(
      usable.filter((line) => !line.keep),
      clips,
      plan.fps,
    ),
  ]
  const end = Math.max(0, ...items.map((item) => item.from + item.durationInFrames))
  const length = lengthFinding({ fps: plan.fps, durationFrames: layout.durationFrames }, end)
  if (length) findings.push(length)
  return { findings, checked: usable.length, skipped: lines.length - usable.length }
}
