// A first draft of a performance plan from the speakers' transcripts (`shred
// plan <id> --scaffold <mediaId...>`): the speech split into lines on sentence
// ends and pauses, the obvious cuts marked (long silences, a sentence said
// again: the earlier take, a filler-only fragment or a restart), everything
// else kept, no visuals. A starting point: the agent reviews every line. Pure.
import { commonLength, joinText, tokens } from './words.mjs'

const SENTENCE_END = /[.?!…][”"')\]]*$|[-–—]$/
const FILLERS = new Set([
  'um',
  'umm',
  'uh',
  'uhm',
  'uhh',
  'er',
  'erm',
  'ah',
  'eh',
  'hmm',
  'mm',
  'mhm',
])
const CONNECTIVES = new Set([
  'so',
  'and',
  'but',
  'like',
  'okay',
  'ok',
  'well',
  'yeah',
  'right',
  'anyway',
  'alright',
])
const FILLER_PHRASES = new Set(['you know', 'i mean'])
/** A restart is at most this many words, all said again at the start of the next line. */
const RESTART_WORDS = 4
/** Retakes: the shorter line's words, in order, in the longer (and at least half of it). */
const RETAKE_SHARE = 0.8
const RETAKE_MIN_WORDS = 3
const RETAKE_WINDOW = 3
const DEAD_AIR_SEC = 2

const round3 = (value) => Math.round(value * 1000) / 1000

/** The speech split into lines: after a sentence end (or a cut-off word), or at a pause. */
function splitSpeech(words, pauseSec) {
  const lines = []
  let current = []
  for (const [i, word] of words.entries()) {
    current.push(word)
    const next = words[i + 1]
    const ends = SENTENCE_END.test(String(word.text).trim())
    if (!next || ends || next.start - word.end >= pauseSec) {
      lines.push(...splitRestarts(current))
      current = []
    }
  }
  return lines
}

/** Where a line says two to four words and then says them again: `{ at, size }`, or null. */
function restartAt(said) {
  for (let at = 0; at < said.length; at += 1)
    for (let size = RESTART_WORDS; size >= 2; size -= 1) {
      const first = said.slice(at, at + size).join(' ')
      if (at + 2 * size <= said.length && first === said.slice(at + size, at + 2 * size).join(' '))
        return { at, size }
    }
  return null
}

/**
 * A restart inside a line ("so the, so the freezer...") splits it: what came
 * before, the words said twice (marked `restart`, to be cut) and the rest.
 */
function splitRestarts(group) {
  const found = restartAt(group.map((word) => tokens(word.text).join('')))
  if (!found) return [group]
  const { at, size } = found
  const before = group.slice(0, at)
  const twice = Object.assign(group.slice(at, at + size), { restart: true })
  return [...(before.length ? [before] : []), twice, ...splitRestarts(group.slice(at + size))]
}

const silence = (mediaId, inSec, outSec) => ({
  mediaId,
  inSec,
  outSec,
  text: '',
  keep: false,
  reason: outSec - inSec >= DEAD_AIR_SEC ? 'dead air' : 'pause',
})

/** One speaker's lines in source order: speech, and silences of `pauseSec` or more. */
function speakerLines(speaker, pauseSec) {
  const lines = []
  let cursor = 0
  for (const group of splitSpeech(speaker.words, pauseSec)) {
    const inSec = group[0].start
    if (inSec - cursor >= pauseSec) lines.push(silence(speaker.mediaId, cursor, inSec))
    lines.push({
      mediaId: speaker.mediaId,
      inSec,
      outSec: group.at(-1).end,
      text: joinText(group),
      keep: true,
      restart: group.restart === true,
    })
    cursor = group.at(-1).end
  }
  if (speaker.duration - cursor >= pauseSec)
    lines.push(silence(speaker.mediaId, cursor, speaker.duration))
  return lines
}

/** Only fillers ("um", "uh"), connectives ("so", "and") or "you know" / "I mean". */
export function isFiller(text) {
  const said = tokens(text).filter((token) => !FILLERS.has(token))
  return said.every((token) => CONNECTIVES.has(token)) || FILLER_PHRASES.has(said.join(' '))
}

/** A short fragment the next line starts by saying again ("So the" → "So the best way..."). */
function isRestart(line, next) {
  if (!next) return false
  const [a, b] = [tokens(line.text), tokens(next.text)]
  return a.length <= RESTART_WORDS && b.length > a.length && a.every((token, i) => b[i] === token)
}

/** The same sentence said again: most of the shorter one's words, in order, in the other. */
export function isRetake(a, b) {
  const [x, y] = [tokens(a), tokens(b)]
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length < RETAKE_MIN_WORDS) return false
  const common = commonLength(x, y)
  return common >= RETAKE_SHARE * short.length && common >= 0.5 * long.length
}

function markFalseStarts(speech) {
  for (const [i, line] of speech.entries())
    if (line.restart || isFiller(line.text) || isRestart(line, speech[i + 1]))
      Object.assign(line, { keep: false, reason: 'false start' })
}

/** The earlier of two takes is cut, pointing at the later one (people retake to fix the first). */
function markRetakes(speech) {
  for (const [i, line] of speech.entries()) {
    if (!line.keep) continue
    const later = speech
      .slice(i + 1, i + 1 + RETAKE_WINDOW)
      .find((other) => other.keep && isRetake(line.text, other.text))
    if (later) Object.assign(line, { keep: false, reason: 'retake', takeOf: later.id })
  }
}

/** Roles for the kept lines: the first is the hook, the last the close, a setup when the format has one. */
function assignRoles(lines, format) {
  const kept = lines.filter((line) => line.keep)
  const has = (role) => format.structure.some((part) => part.role === role)
  kept.forEach((line, i) => {
    line.role = 'body'
    if (i === 0) line.role = 'hook'
    else if (i === 1 && has('setup') && kept.length > 3) line.role = 'setup'
    else if (i === kept.length - 1 && kept.length > 2 && has('close')) line.role = 'close'
  })
  const byId = new Map(lines.map((line) => [line.id, line]))
  for (const line of lines.filter((l) => l.takeOf)) line.role = byId.get(line.takeOf).role
}

function planLine(line) {
  return {
    id: line.id,
    source: { mediaId: line.mediaId, in: round3(line.inSec), out: round3(line.outSec), unit: 's' },
    text: line.text,
    keep: line.keep,
    ...(line.reason ? { reason: line.reason } : {}),
    ...(line.takeOf ? { takeOf: line.takeOf } : {}),
    ...(line.role ? { role: line.role } : {}),
    ...(line.keep ? { visuals: [] } : {}),
  }
}

const count = (lines, reason) => lines.filter((line) => line.reason === reason).length

/**
 * A draft performance plan (schema v3) from the speakers' transcripts.
 * `speakers`: `[{ mediaId, duration, words: [{ text, start, end }] }]` (source
 * seconds), in the order they play. `pauseSec`: silences this long split lines
 * and are cut. Returns `{ plan, counts }`; `request` and `story.arc` are left
 * empty for the agent to write.
 */
export function scaffoldPerformance(speakers, { format, fps, padFrames = 0, pauseSec }) {
  const lines = speakers.flatMap((speaker) => {
    const own = speakerLines(speaker, pauseSec)
    const speech = own.filter((line) => line.text)
    markFalseStarts(speech)
    return own
  })
  lines.forEach((line, i) => {
    line.id = `l${String(i + 1).padStart(2, '0')}`
  })
  for (const speaker of speakers)
    markRetakes(lines.filter((line) => line.text && line.mediaId === speaker.mediaId))
  assignRoles(lines, format)
  const plan = {
    schemaVersion: 3,
    mode: 'performance',
    fps,
    request: '',
    story: { arc: '', structure: format.structure.filter((p) => p.required).map((p) => p.role) },
    performance: {
      speaker: speakers.map((speaker) => speaker.mediaId),
      padFrames,
      lines: lines.map(planLine),
    },
  }
  return {
    plan,
    counts: {
      lines: lines.length,
      kept: lines.filter((line) => line.keep).length,
      retakes: count(lines, 'retake'),
      falseStarts: count(lines, 'false start'),
      pauses: count(lines, 'pause') + count(lines, 'dead air'),
    },
  }
}
