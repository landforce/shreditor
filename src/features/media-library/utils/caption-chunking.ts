/**
 * Split a word-timed transcript into on-screen caption chunks.
 *
 * One chunker for every caption path: the transcript captions the editor
 * makes (default limits) and the captions made with a caption style (the
 * style's word, line and character limits).
 *
 * Break points are chosen for the whole transcript at once (dynamic
 * programming over the word boundaries), not greedily: each possible chunk
 * has a cost (word count against the range, text that won't fit, too short or
 * too long on screen, a lone word) and each boundary a score from
 * `caption-phrase-boundaries` (good: sentence and clause ends, pauses, a new
 * phrase; bad: after "a", "to", "is", inside a number or a name). The cheapest
 * segmentation wins. Timing is unchanged: a chunk runs from its first word's
 * start to its last word's end.
 */

import { joinTranscriptWords, needsTranscriptWordSeparator } from '@/shared/utils/transcript-text'
import type { MediaTranscriptSegment, MediaTranscriptWord } from '@/types/storage'
import {
  scoreCaptionBoundaries,
  usesEnglishPhraseRules,
  type CaptionBoundaries,
  type TimedWord,
} from './caption-phrase-boundaries'

export interface CaptionChunkLimits {
  maxWords: number
  /** Fewest words a chunk should have (a punch word set off by pauses may stand alone). */
  minWords: number
  maxCharsPerLine: number
  maxLines: number
  /** Longest a chunk's speech should run. */
  maxSeconds: number
  /** Shortest a chunk should stay on screen (until the next one starts). */
  minSeconds: number
  /**
   * `phrase` (default): break where an editor would, by phrase. `words`: fill
   * chunks up to `maxWords`, breaking only at pauses and punctuation.
   */
  breakOn?: 'phrase' | 'words'
  /** The transcript's language; without it, English is detected from the words. */
  language?: string
}

export const DEFAULT_CAPTION_CHUNK_LIMITS: CaptionChunkLimits = {
  maxWords: 8,
  minWords: 2,
  maxCharsPerLine: 42,
  maxLines: 1,
  maxSeconds: 2.2,
  minSeconds: 0.4,
}

/** Every chunk costs this much, so fewer chunks win a tie. */
const CHUNK_COST = 0.5
/** Mild pull towards the middle of the word range, which also evens chunk sizes. */
const SIZE_WEIGHT = 0.12
const BELOW_MIN_WORDS_COST = 2
const OVER_MAX_SECONDS_COST = 6
const UNDER_MIN_SECONDS_COST = 10
/** Lines of a chunk: how much an uneven split costs against a phrase boundary. */
const LINE_BALANCE_WEIGHT = 6

type Word = MediaTranscriptWord

function sanitizeWord(word: Word): Word {
  return {
    text: word.text.trim(),
    start: word.start,
    end: word.end,
    ...(typeof word.confidence === 'number' ? { confidence: word.confidence } : {}),
  }
}

/** Greedy word wrap: the lines a chunk's text takes at `maxChars` per line (the fewest lines). */
export function wrapCaptionLines(words: readonly string[], maxChars: number): string[] {
  const lines: string[][] = []
  for (const word of words) {
    const line = lines.at(-1)
    if (line && joinTranscriptWords([...line, word]).length <= maxChars) line.push(word)
    else lines.push([word])
  }
  return lines.map((line) => joinTranscriptWords(line))
}

interface Segmentation {
  words: Word[]
  limits: CaptionChunkLimits
  boundaries: CaptionBoundaries
  /** `chars[k]`: characters of words 0 .. k-1 joined, separators included. */
  chars: number[]
  target: number
}

function prefixChars(words: readonly Word[]): number[] {
  const chars = [0]
  words.forEach((word, index) => {
    const previous = words[index - 1]
    const separator = previous && needsTranscriptWordSeparator(previous.text, word.text) ? 1 : 0
    chars.push(chars[index]! + separator + word.text.length)
  })
  return chars
}

/** Characters of words `i .. j-1` on one line. */
function lineChars(s: Segmentation, i: number, j: number): number {
  const separatorBefore = s.chars[i + 1]! - s.chars[i]! - s.words[i]!.text.length
  return s.chars[j]! - s.chars[i]! - separatorBefore
}

function fitsText(s: Segmentation, i: number, j: number): boolean {
  if (lineChars(s, i, j) <= s.limits.maxCharsPerLine) return true
  if (s.limits.maxLines === 1) return false
  const texts = s.words.slice(i, j).map((word) => word.text)
  return wrapCaptionLines(texts, s.limits.maxCharsPerLine).length <= s.limits.maxLines
}

function sizeCost(s: Segmentation, i: number, count: number): number {
  const evenness = SIZE_WEIGHT * (count - s.target) ** 2
  if (count >= s.limits.minWords) return evenness
  if (count > 1) return evenness + (s.limits.minWords - count) * BELOW_MIN_WORDS_COST
  return evenness + s.boundaries.loneWordCost[i]!
}

function timeCost(s: Segmentation, i: number, j: number): number {
  const first = s.words[i]!
  const speech = s.words[j - 1]!.end - first.start
  const onScreen = (s.words[j]?.start ?? s.words[j - 1]!.end) - first.start
  const over = Math.max(0, speech - s.limits.maxSeconds) * OVER_MAX_SECONDS_COST
  return over + Math.max(0, s.limits.minSeconds - onScreen) * UNDER_MIN_SECONDS_COST
}

/** The cost of breaking after the chunk `i .. j-1` (nothing at the end). */
function breakCost(s: Segmentation, i: number, j: number): number {
  if (j >= s.words.length) return 0
  return s.boundaries.cost[j]! + (j - i >= 2 ? s.boundaries.longChunkBonus[j]! : 0)
}

function chunkCost(s: Segmentation, i: number, j: number): number {
  return CHUNK_COST + sizeCost(s, i, j - i) + timeCost(s, i, j) + breakCost(s, i, j)
}

/** Best chunk ending before word `j`: tries every start back to the word and text limits. */
function relaxChunksEndingAt(s: Segmentation, j: number, best: number[], from: number[]): void {
  const lowest = Math.max(0, j - s.limits.maxWords)
  for (let i = j - 1; i >= lowest; i--) {
    // Text only grows going back; a single word always fits.
    if (i < j - 1 && !fitsText(s, i, j)) break
    const total = best[i]! + chunkCost(s, i, j)
    if (total < best[j]!) {
      best[j] = total
      from[j] = i
    }
  }
}

function segmentWords(s: Segmentation): Word[][] {
  const n = s.words.length
  const best = Array.from<number>({ length: n + 1 }).fill(Infinity)
  const from = Array.from<number>({ length: n + 1 }).fill(0)
  best[0] = 0
  for (let j = 1; j <= n; j++) relaxChunksEndingAt(s, j, best, from)
  const groups: Word[][] = []
  for (let j = n; j > 0; j = from[j]!) groups.unshift(s.words.slice(from[j]!, j))
  return groups
}

function phraseMode(limits: CaptionChunkLimits): boolean {
  return (limits.breakOn ?? 'phrase') === 'phrase'
}

function buildSegmentation(words: Word[], limits: CaptionChunkLimits): Segmentation {
  const maxWords = Math.max(1, limits.maxWords)
  const minWords = Math.min(Math.max(1, limits.minWords), maxWords)
  const english = phraseMode(limits) && usesEnglishPhraseRules(words, limits.language)
  return {
    words,
    limits: { ...limits, maxWords, minWords },
    boundaries: scoreCaptionBoundaries(words, english),
    chars: prefixChars(words),
    target: phraseMode(limits) ? (minWords + maxWords) / 2 : maxWords,
  }
}

function segmentFromWords(words: Word[]): MediaTranscriptSegment | null {
  const first = words[0]
  const last = words.at(-1)
  if (!first || !last) return null
  return {
    text: joinTranscriptWords(words.map((word) => word.text)),
    start: first.start,
    end: last.end,
    words,
  }
}

/**
 * Chunks with `words` (each chunk one caption). Segments without word timing
 * pass through whole.
 */
export function chunkTranscriptForCaptions(
  segments: readonly MediaTranscriptSegment[],
  limits: CaptionChunkLimits = DEFAULT_CAPTION_CHUNK_LIMITS,
): MediaTranscriptSegment[] {
  const wordsBySegment = segments.map((segment) =>
    (segment.words?.map(sanitizeWord) ?? []).filter(
      (word) => word.text.length > 0 && word.end > word.start,
    ),
  )
  const words = wordsBySegment.flat().toSorted((left, right) => left.start - right.start)
  if (words.length === 0) {
    return segments.map((segment) => ({
      text: segment.text.trim(),
      start: segment.start,
      end: segment.end,
    }))
  }

  const chunks = segmentWords(buildSegmentation(words, limits))
    .map(segmentFromWords)
    .filter((segment): segment is MediaTranscriptSegment => segment !== null)
  segments.forEach((segment, index) => {
    if ((wordsBySegment[index]?.length ?? 0) > 0) return
    const text = segment.text.trim()
    if (text.length > 0) chunks.push({ text, start: segment.start, end: segment.end })
  })
  return chunks.toSorted((left, right) => left.start - right.start)
}

interface LineBreaking {
  texts: readonly string[]
  maxChars: number
  cost: readonly number[]
  ideal: number
}

function lineCost(b: LineBreaking, i: number, j: number): number {
  const length = joinTranscriptWords(b.texts.slice(i, j)).length
  if (length > b.maxChars && j - i > 1) return Infinity
  const balance = LINE_BALANCE_WEIGHT * ((length - b.ideal) / b.ideal) ** 2
  return balance + (j < b.texts.length ? b.cost[j]! : 0)
}

type Table = number[][]

/** Best way to put words `.. j-1` on `l` lines, from the best on `l - 1` lines. */
function relaxLinesEndingAt(b: LineBreaking, best: Table, from: Table, l: number, j: number) {
  for (let i = l - 1; i < j; i++) {
    const total = best[l - 1]![i]! + lineCost(b, i, j)
    if (total < best[l]![j]!) {
      best[l]![j] = total
      from[l]![j] = i
    }
  }
}

/** Cheapest split of the words into exactly `lineCount` lines: where each line ends. */
function balancedBreaks(b: LineBreaking, lineCount: number): number[] {
  const n = b.texts.length
  // best[l][j]: words 0 .. j-1 on l lines.
  const best: Table = Array.from({ length: lineCount + 1 }, () =>
    Array.from<number>({ length: n + 1 }).fill(Infinity),
  )
  const from: Table = best.map((row) => row.map(() => 0))
  best[0]![0] = 0
  for (let l = 1; l <= lineCount; l++) {
    for (let j = l; j <= n; j++) relaxLinesEndingAt(b, best, from, l, j)
  }
  if (best[lineCount]![n] === Infinity) return []
  const ends: number[] = []
  for (let l = lineCount, j = n; l > 0; j = from[l]![j]!, l--) ends.unshift(j)
  return ends
}

/**
 * The lines of a chunk at `maxChars` per line: as few lines as the text
 * needs, split at the best phrase boundary with lines of balanced length.
 * `texts` are the words as shown (cased, punctuation stripped); `words` the
 * spoken words they come from, which carry the punctuation and pauses the
 * boundaries are scored on.
 */
export function breakCaptionLines(
  words: readonly TimedWord[],
  texts: readonly string[],
  maxChars: number,
  english: boolean,
): string[] {
  const greedy = wrapCaptionLines(texts, maxChars)
  if (greedy.length < 2) return greedy
  const breaking: LineBreaking = {
    texts,
    maxChars,
    cost: scoreCaptionBoundaries(words, english).cost,
    ideal: joinTranscriptWords(texts).length / greedy.length,
  }
  const breaks = balancedBreaks(breaking, greedy.length)
  if (breaks.length === 0) return greedy
  return breaks.map((end, index) => joinTranscriptWords(texts.slice(breaks[index - 1] ?? 0, end)))
}
