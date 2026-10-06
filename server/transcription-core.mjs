// Pure helpers for native transcription (no I/O): whisper.cpp full JSON to
// FreeCut's transcript envelope, phantom-speech filtering, provenance and
// status rules. The runtime that runs ffmpeg and whisper-cli is
// server/transcription.mjs; this file is unit-tested on its own.

/** Engine marker written into every auto transcript (envelope.service and data.source). */
export const NATIVE_SOURCE = 'whisper.cpp'
/** FreeCut model id for Whisper Large v3 Turbo (label: "Whisper Large v3 Turbo"). */
export const NATIVE_MODEL_VARIANT = 'whisper-large'
export const AI_OUTPUT_SCHEMA_VERSION = 1

export const TRANSCRIPTION_STATUSES = ['queued', 'running', 'done', 'none', 'failed', 'unavailable']

// Statuses a new job may start from (and, from the startup sweep, resume).
const NEXT = {
  queued: new Set(['running', 'failed', 'unavailable', 'none', 'queued']),
  running: new Set(['done', 'none', 'failed', 'unavailable', 'queued']),
  done: new Set(['queued']),
  none: new Set(['queued']),
  failed: new Set(['queued']),
  unavailable: new Set(['queued']),
}

/** Whether a media's transcription status may move from `from` to `to` (`from` undefined = never queued). */
export function canTransition(from, to) {
  if (!TRANSCRIPTION_STATUSES.includes(to)) return false
  if (from === undefined || from === null) return to === 'queued'
  return NEXT[from]?.has(to) ?? false
}

/* ───────────────────────────── Phantom speech ─────────────────────────── */

// Whisper invents these on music, typing, room tone and silence. Extends the
// list `shred catalog` used.
const PHANTOM_PHRASES = new Set([
  'thank you', 'thank you so much', 'thank you very much', 'thanks', 'thanks for watching',
  'thank you for watching', 'thanks for listening', 'thank you for listening', 'you', 'bye',
  'bye bye', 'okay', 'oh', 'hmm', 'music', 'applause', 'laughter', 'silence', 'blank audio',
  'subtitles by the amara org community', 'please subscribe', 'like and subscribe',
  'see you next time', 'see you in the next video', 'i ll see you next time',
])

export function normalizeSpeech(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/'/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Sign-off families whisper produces from nothing ("We'll see you next time").
const PHANTOM_PATTERNS = [
  /^(so )?(we ll |i ll )?see you (all )?(next time|in the next (one|video|episode)|soon|later|tomorrow)( bye)?$/,
  /^thanks? (you )?(so much |very much |all |guys |everyone )?(for (watching|listening|your attention))?( bye)?$/,
  /^(please )?(like (and|&) )?subscribe( to (my|the|our) channel)?$/,
]

export function isPhantomPhrase(text) {
  const t = normalizeSpeech(text)
  return !t || PHANTOM_PHRASES.has(t) || PHANTOM_PATTERNS.some((re) => re.test(t))
}

// Faster than anyone talks: words squeezed into a sliver of time are aligned
// to audio that is not there (whisper's 30 s window running past the end).
const MIN_SECONDS_PER_WORD = 0.06

/**
 * Whether one recognized segment is likely invented. `onlySpeech` is true
 * when it is the only segment left, where a stock phrase alone is enough.
 */
export function isPhantomSegment(segment, { duration = Infinity, onlySpeech = false } = {}) {
  // Judge what whisper said, not what survived clamping into the media.
  const t = normalizeSpeech(segment.rawText ?? segment.text)
  if (!t) return true
  if (segment.start >= duration - 0.05) return true
  const words = t.split(' ').length
  const span = Math.min(segment.end, duration) - segment.start
  // Two words stretched over several seconds: never real speech timing.
  if (words <= 2 && span > 3) return true
  // A short line that runs seconds past the end of the audio is decoded from
  // the silent padding of whisper's 30 s window.
  if ((segment.rawEnd ?? 0) > duration + 2 && (words <= 3 || isPhantomPhrase(t))) return true
  const timed = segment.words?.length ?? 0
  if (timed >= 2) {
    const wordSpan = segment.words.at(-1).end - segment.words[0].start
    if (wordSpan / timed < MIN_SECONDS_PER_WORD) return true
  }
  if (!isPhantomPhrase(t)) return false
  if (onlySpeech) return true
  const confidence = segment.confidence ?? 1
  // A stock phrase inside real speech is kept when it sounds and is timed like speech.
  return confidence < 0.6 || span > 2.5 || segment.rawEnd > duration + 0.5
}

/* ─────────────────────────── Tokens to words ──────────────────────────── */

const SPECIAL_TOKEN = /^\s*(\[_[A-Z]+_?\d*\]|<\|[^|]*\|>)\s*$/

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))
const round3 = (value) => Math.round(value * 1000) / 1000
const MIN_WORD = 0.01
export const DEFAULT_MAX_WORD_SECONDS = 1
// whisper.cpp's DTW onsets land late. Against speech onsets measured with
// ffmpeg silencedetect on a 66 s talking-head clip, the median error was
// +0.09 s raw and +0.02 s with this lead. The plain token offsets put 39 of
// 194 words entirely inside pauses (they bunch words after a silence); DTW
// put none, so DTW minus the lead is used whenever whisper returns it.
export const DTW_LEAD_SECONDS = 0.1

/**
 * Merge whisper.cpp sub-word tokens into words. A token that starts with a
 * space starts a new word; anything else (", 'm, G, P, T") continues the
 * previous one, and a punctuation-only word joins the word before it.
 * Times in seconds: `dtw` is the DTW onset of the word's first token
 * (`t_dtw`, centiseconds; -1 when DTW was off), `from`/`to` the token offsets.
 */
export function groupTokens(tokens) {
  const groups = []
  for (const token of tokens ?? []) {
    const text = typeof token?.text === 'string' ? token.text : ''
    if (!text || SPECIAL_TOKEN.test(text)) continue
    if (/^\s/.test(text) || groups.length === 0) groups.push({ text: '', dtw: -1, from: Infinity, to: -Infinity, ps: [] })
    const group = groups.at(-1)
    if (!group.text && Number(token.t_dtw) >= 0) group.dtw = Number(token.t_dtw) / 100
    group.text += text
    const from = Number(token.offsets?.from) / 1000
    const to = Number(token.offsets?.to) / 1000
    if (Number.isFinite(from)) group.from = Math.min(group.from, from)
    if (Number.isFinite(to)) group.to = Math.max(group.to, to)
    if (typeof token.p === 'number' && Number.isFinite(token.p)) group.ps.push(token.p)
  }
  const words = []
  for (const group of groups) {
    group.text = group.text.trim()
    if (!group.text) continue
    if (!/[\p{L}\p{N}]/u.test(group.text) && words.length > 0) {
      const previous = words.at(-1)
      previous.text += group.text
      previous.to = Math.max(previous.to, group.to)
      previous.ps.push(...group.ps)
      continue
    }
    words.push(group)
  }
  return words
}

/**
 * Word timings for one segment, clamped into the segment (token times drift
 * past segment ends) and into [0, duration], never overlapping. With DTW, a
 * word runs from its onset (less `dtwLeadSeconds`) to the next word's onset,
 * at most `maxWordSeconds`; without it, the token offsets are used.
 * @returns {{ text: string, start: number, end: number, confidence?: number }[]}
 */
export function timeWords(groups, segmentStart, segmentEnd, { duration = Infinity, maxWordSeconds = DEFAULT_MAX_WORD_SECONDS, dtwLeadSeconds = DTW_LEAD_SECONDS } = {}) {
  const lo = clamp(segmentStart, 0, duration)
  const hi = Math.max(lo, Math.min(segmentEnd, duration))
  const useDtw = groups.length > 0 && groups.every((g) => g.dtw >= 0)
  const starts = []
  for (const group of groups) {
    const raw = useDtw ? group.dtw - dtwLeadSeconds : Number.isFinite(group.from) ? group.from : (starts.at(-1) ?? lo)
    starts.push(Math.max(clamp(raw, lo, hi), starts.at(-1) ?? lo))
  }
  const words = []
  let previousEnd = lo
  groups.forEach((group, index) => {
    let start = Math.max(starts[index], previousEnd)
    const next = index + 1 < groups.length ? starts[index + 1] : hi
    let end = useDtw ? Math.min(next, start + maxWordSeconds) : clamp(Number.isFinite(group.to) ? group.to : start, lo, hi)
    if (!useDtw && next > start) end = Math.min(end, next)
    if (end - start < MIN_WORD) {
      if (start + MIN_WORD <= hi) end = start + MIN_WORD
      else {
        start = Math.max(previousEnd, hi - MIN_WORD)
        end = hi
      }
    }
    if (end <= start) return
    previousEnd = end
    const confidence = group.ps.length ? group.ps.reduce((a, b) => a + b, 0) / group.ps.length : undefined
    words.push({ text: group.text, start: round3(start), end: round3(end), ...(confidence === undefined ? {} : { confidence: round3(confidence) }) })
  })
  return words
}

export function tokensToWords(tokens, segmentStart, segmentEnd, options) {
  return timeWords(groupTokens(tokens), segmentStart, segmentEnd, options)
}

/** Longest a DTW-timed word may run: twice the median onset gap, as Whisper's own aligner does. */
export function maxWordSeconds(groupsBySegment) {
  const gaps = []
  for (const groups of groupsBySegment) {
    for (let i = 1; i < groups.length; i++) {
      const gap = groups[i].dtw - groups[i - 1].dtw
      if (groups[i - 1].dtw >= 0 && gap > 0) gaps.push(gap)
    }
  }
  if (gaps.length === 0) return DEFAULT_MAX_WORD_SECONDS
  gaps.sort((a, b) => a - b)
  return 2 * clamp(gaps[Math.floor(gaps.length / 2)], 0.2, 0.7)
}

/** whisper.cpp `--dtw` preset for a ggml model file, or null when it has none. */
export function dtwPreset(modelFile) {
  const m = /ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3-turbo|large-v3)(\.en)?(?:[-.]|$)/.exec(String(modelFile).split('/').pop() ?? '')
  if (!m) return null
  return `${m[1].replace(/-/g, '.')}${m[2] ?? ''}`
}

/* ─────────────────────────── Text joining ─────────────────────────────── */

// Mirrors joinTranscriptWords in src/shared/utils/transcript-text.ts.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const NO_SPACE_BEFORE = /^[\p{P}\p{S}]/u
const NO_SPACE_AFTER = /[\p{Ps}\p{Pi}]$/u

export function joinWords(words) {
  const parts = words.map((w) => String(w).trim()).filter(Boolean)
  return parts.reduce((text, word, index) => {
    if (index === 0) return word
    const prev = Array.from(parts[index - 1]).at(-1) ?? ''
    const next = Array.from(word)[0] ?? ''
    const space = !(CJK.test(prev) || CJK.test(next)) && !NO_SPACE_AFTER.test(prev) && !NO_SPACE_BEFORE.test(next)
    return `${text}${space ? ' ' : ''}${word}`
  }, '')
}

/* ──────────────────────── whisper.cpp JSON to transcript ─────────────── */

/**
 * Convert whisper.cpp `--output-json-full` output into FreeCut transcript
 * segments (seconds, with word timings), dropping phantom speech.
 * @returns {{ language?: string, segments: Array<{ text, start, end, words }>, dropped: string[] }}
 */
export function segmentsFromWhisperJson(json, { duration = Infinity } = {}) {
  const raw = Array.isArray(json?.transcription) ? json.transcription : []
  const grouped = raw.map((seg) => groupTokens(seg.tokens))
  const maxWord = maxWordSeconds(grouped)
  const candidates = []
  raw.forEach((seg, index) => {
    const rawStart = Number(seg.offsets?.from) / 1000
    const rawEnd = Number(seg.offsets?.to) / 1000
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return
    const start = clamp(rawStart, 0, duration)
    const end = clamp(Math.max(rawEnd, rawStart), 0, duration)
    const words = timeWords(grouped[index], start, end, { duration, maxWordSeconds: maxWord })
    const text = words.length ? joinWords(words.map((w) => w.text)) : String(seg.text ?? '').trim()
    const ps = (seg.tokens ?? []).filter((t) => !SPECIAL_TOKEN.test(t.text ?? '') && typeof t.p === 'number').map((t) => t.p)
    const confidence = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : undefined
    candidates.push({ text, rawText: String(seg.text ?? '').trim(), start, end, rawEnd, words, confidence })
  })

  const dropped = []
  let kept = candidates.filter((seg) => {
    if (isPhantomSegment(seg, { duration })) {
      dropped.push(seg.text)
      return false
    }
    return true
  })
  if (kept.length === 1 && isPhantomSegment(kept[0], { duration, onlySpeech: true })) {
    dropped.push(kept[0].text)
    kept = []
  }
  // Everything left is stock phrases: treat the whole track as no speech.
  if (kept.length > 0 && kept.every((seg) => isPhantomPhrase(seg.rawText))) {
    dropped.push(...kept.map((seg) => seg.text))
    kept = []
  }

  const segments = kept
    .filter((seg) => seg.text)
    .map((seg) => ({
      text: seg.text,
      start: round3(seg.words[0]?.start ?? seg.start),
      end: round3(seg.words.at(-1)?.end ?? seg.end),
      ...(seg.words.length ? { words: seg.words } : {}),
    }))
    .filter((seg) => seg.end > seg.start)
  return { language: json?.result?.language || undefined, segments, dropped }
}

/**
 * The transcript envelope FreeCut stores at media/{id}/cache/ai/transcript.json
 * (AiOutput<'transcript'> in workspace-fs/ai-outputs/types.ts).
 */
export function buildTranscriptEnvelope({ mediaId, segments, language, modelName, engineVersion, languageRequested, now = Date.now(), createdAt }) {
  return {
    schemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    kind: 'transcript',
    mediaId,
    service: NATIVE_SOURCE,
    model: modelName,
    params: {
      source: NATIVE_SOURCE,
      auto: true,
      engine: NATIVE_SOURCE,
      ...(engineVersion ? { engineVersion } : {}),
      quantization: 'fp16',
      language,
      languageRequested,
    },
    createdAt: createdAt ?? now,
    updatedAt: now,
    data: {
      language,
      quantization: 'fp16',
      modelVariant: NATIVE_MODEL_VARIANT,
      text: joinWords(segments.map((s) => s.text)),
      segments,
      source: NATIVE_SOURCE,
    },
  }
}

/**
 * Provenance: may the auto-transcriber write over what is stored? Only when
 * nothing is stored, or what is stored was itself written by this engine.
 * Transcripts generated or edited in the app are saved with service
 * 'whisper' (transcriptFromLegacy) and are never replaced unless forced.
 */
export function canAutoWrite(existing, { force = false } = {}) {
  if (force || !existing) return true
  return existing.service === NATIVE_SOURCE && existing.params?.auto === true
}
