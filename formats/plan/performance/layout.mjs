// Where a performance plan's kept lines land in the cut: in plan order, jump
// cut back to back. Kept lines that run on in their source (the next starts
// where this one ends, within two pads) play as one speaker clip, so a run of
// sentences is not chopped into clips that only look like one; elsewhere each
// clip gets `padFrames` of its source on both sides, never reaching into
// another line's speech. Pure.
import { findPhrase } from './words.mjs'

const EPSILON = 1e-3

/** Lines whose speech a pad must not reach: kept lines and cut lines that say something. */
const speaks = (line) => line.keep || Boolean(line.text)

/** How far a kept line's clip may reach before and after it in its source. */
function padRoom(line, lines) {
  const others = lines.filter(
    (other) => other !== line && other.source.mediaId === line.source.mediaId && speaks(other),
  )
  const { inSec, outSec } = line.source
  const before = others.map((o) => o.source.outSec).filter((end) => end <= inSec + EPSILON)
  const after = others.map((o) => o.source.inSec).filter((start) => start >= outSec - EPSILON)
  const duration = line.media?.duration > 0 ? line.media.duration : Infinity
  return {
    minIn: Math.min(inSec, Math.max(0, ...before)),
    maxOut: Math.max(outSec, Math.min(duration, ...after)),
  }
}

function runsOn(previous, line, padSec) {
  if (!previous || previous.source.mediaId !== line.source.mediaId) return false
  const gap = line.source.inSec - previous.source.outSec
  return gap >= -EPSILON && gap <= 2 * padSec + EPSILON
}

function groupRuns(kept, padSec) {
  const groups = []
  for (const line of kept) {
    const group = groups.at(-1)
    if (group && runsOn(group.at(-1), line, padSec)) group.push(line)
    else groups.push([line])
  }
  return groups
}

/**
 * The speaker clips the kept lines make, back to back from frame 0:
 * `{ id, mediaId, media, inSec, outSec, start, end, lines: [line ids] }`.
 */
function speakerRuns(kept, lines, { fps, padFrames }) {
  const padSec = padFrames / fps
  let at = 0
  return groupRuns(kept, padSec).map((group, index) => {
    const [first, last] = [group[0], group.at(-1)]
    const inSec = Math.max(padRoom(first, lines).minIn, first.source.inSec - padSec)
    const outSec = Math.min(padRoom(last, lines).maxOut, last.source.outSec + padSec)
    const frames = Math.max(1, Math.round((outSec - inSec) * fps))
    const run = {
      id: `run${index + 1}`,
      mediaId: first.source.mediaId,
      media: first.media,
      inSec,
      outSec,
      start: at,
      end: at + frames,
      lines: group.map((line) => line.id),
    }
    at += frames
    return run
  })
}

/**
 * Each kept line's frames in the cut: `{ start, end, speechStart, run }`. A
 * line's span runs to the next line's start, so spans tile the cut; its
 * `speechStart` is where its source `in` plays (after the pad on a clip's first line).
 */
function lineSpans(runs, linesById, fps) {
  const spans = new Map()
  for (const run of runs) {
    const speech = run.lines.map(
      (id) => run.start + Math.round((linesById.get(id).source.inSec - run.inSec) * fps),
    )
    const starts = speech.map((frame, i) => (i === 0 ? run.start : frame))
    run.lines.forEach((id, i) =>
      spans.set(id, {
        start: starts[i],
        end: starts[i + 1] ?? run.end,
        speechStart: speech[i],
        run: run.id,
      }),
    )
  }
  return spans
}

const describePoint = (point) =>
  'phrase' in point ? `"${point.phrase}"` : 'word' in point ? `word ${point.word}` : ''

function wordAt(point, words) {
  if ('word' in point)
    return point.word < words.length ? { first: point.word, last: point.word } : null
  return findPhrase(words, point.phrase)
}

/** A word-based point in a line, as a frame; `{ error }` when the line doesn't say it. */
function wordFrame(point, edge, { line, span, words, fps }) {
  if (!words?.length)
    return {
      error: `${edge} ${describePoint(point)} needs the line's transcript words (shred transcript ${line.source.mediaId})`,
    }
  const found = wordAt(point, words)
  if (!found)
    return {
      error: `${edge} ${describePoint(point)} is not in what the line says: ${words.map((w, i) => `${i}:${String(w.text).trim()}`).join(' ')}`,
    }
  const sec = edge === 'at' ? words[found.first].start : words[found.last].end
  return { frame: span.speechStart + Math.round((sec - line.source.inSec) * fps) }
}

const clampTo = (span, result) =>
  result.error ? result : { frame: Math.min(span.end, Math.max(span.start, result.frame)) }

/**
 * A point (`at` or `until`, ./read.mjs) of a kept line as a frame of the cut:
 * `{ frame }` or `{ error }`. No point is the line's edge.
 */
export function pointFrame(point, edge, context) {
  const { span, fps, spans } = context
  if (point === undefined) return { frame: edge === 'at' ? span.start : span.end }
  if ('line' in point) {
    const other = spans.get(point.line)
    return other
      ? { frame: other.end }
      : { error: `until { line: "${point.line}" }: ${point.line} is not a kept line` }
  }
  if ('sec' in point)
    return clampTo(span, { frame: span.speechStart + Math.round(point.sec * fps) })
  return clampTo(span, wordFrame(point, edge, context))
}

/**
 * The cut a performance plan makes: speaker clips, each kept line's span, and
 * the length. `lines` are the plan's lines with `media` resolved (null when
 * missing: such a line is left out).
 */
export function layoutPerformance(plan, lines) {
  const kept = lines.filter((line) => line.keep && line.media)
  const runs = speakerRuns(kept, lines, {
    fps: plan.fps,
    padFrames: plan.performance.padFrames,
  })
  const spans = lineSpans(runs, new Map(lines.map((line) => [line.id, line])), plan.fps)
  return { runs, spans, durationFrames: runs.at(-1)?.end ?? 0 }
}
