/**
 * Split a word-timed transcript into on-screen caption chunks.
 *
 * One chunker for every caption path: the transcript captions the editor
 * makes (default limits) and the captions made with a caption style (the
 * style's word, line and character limits).
 */

import { joinTranscriptWords } from '@/shared/utils/transcript-text'
import type { MediaTranscriptSegment, MediaTranscriptWord } from '@/types/storage'

export interface CaptionChunkLimits {
  maxWords: number
  maxCharsPerLine: number
  maxLines: number
  maxSeconds: number
  /** A sentence end closes a chunk once it is this long. */
  preferredSeconds: number
  /** Chunks shorter than this (in words) never break early. */
  minWords: number
  /** A pause this long between words is a phrase boundary. */
  breakGapSeconds: number
}

export const DEFAULT_CAPTION_CHUNK_LIMITS: CaptionChunkLimits = {
  maxWords: 8,
  maxCharsPerLine: 42,
  maxLines: 1,
  maxSeconds: 2.2,
  preferredSeconds: 1.4,
  minWords: 2,
  // A short but audible pause is a better phrase boundary than a blanket timing offset.
  breakGapSeconds: 0.18,
}

const SENTENCE_END_PATTERN = /[.!?。！？]$/

type Word = MediaTranscriptWord

function sanitizeWord(word: Word): Word {
  return {
    text: word.text.trim(),
    start: word.start,
    end: word.end,
    ...(typeof word.confidence === 'number' ? { confidence: word.confidence } : {}),
  }
}

/** Greedy word wrap: the lines a chunk's text takes at `maxChars` per line. */
export function wrapCaptionLines(words: readonly string[], maxChars: number): string[] {
  const lines: string[][] = []
  for (const word of words) {
    const line = lines.at(-1)
    if (line && joinTranscriptWords([...line, word]).length <= maxChars) line.push(word)
    else lines.push([word])
  }
  return lines.map((line) => joinTranscriptWords(line))
}

function fitsText(words: readonly Word[], limits: CaptionChunkLimits): boolean {
  const texts = words.map((word) => word.text)
  if (limits.maxLines === 1) return joinTranscriptWords(texts).length <= limits.maxCharsPerLine
  return wrapCaptionLines(texts, limits.maxCharsPerLine).length <= limits.maxLines
}

function shouldBreak(current: Word[], next: Word, limits: CaptionChunkLimits): boolean {
  const first = current[0]
  const previous = current.at(-1)
  if (!first || !previous) return false
  const longEnough = current.length >= limits.minWords
  if (longEnough && next.start - previous.end >= limits.breakGapSeconds) return true
  if (
    longEnough &&
    (current.length >= limits.maxWords ||
      !fitsText([...current, next], limits) ||
      next.end - first.start > limits.maxSeconds)
  ) {
    return true
  }
  return (
    previous.end - first.start >= limits.preferredSeconds &&
    SENTENCE_END_PATTERN.test(previous.text)
  )
}

function fitsLimits(words: Word[], limits: CaptionChunkLimits): boolean {
  const first = words[0]
  const last = words.at(-1)
  if (!first || !last) return false
  const hasGap = words.some(
    (word, index) => index > 0 && word.start - words[index - 1]!.end >= limits.breakGapSeconds,
  )
  return (
    words.length <= limits.maxWords &&
    fitsText(words, limits) &&
    last.end - first.start <= limits.maxSeconds &&
    !hasGap
  )
}

/** Avoid ending on a one-word flash: rebalance with the preceding chunk when it fits. */
function rebalanceTrailingWord(groups: Word[][], limits: CaptionChunkLimits): void {
  const trailing = groups.at(-1)
  const previous = groups.at(-2)
  if (trailing?.length !== 1 || !previous) return
  if (previous.length >= 3) {
    const shortened = previous.slice(0, -1)
    const rebalanced = [previous.at(-1)!, ...trailing]
    if (fitsLimits(shortened, limits) && fitsLimits(rebalanced, limits)) {
      groups.splice(-2, 2, shortened, rebalanced)
    }
  } else if (fitsLimits([...previous, ...trailing], limits)) {
    previous.push(...trailing)
    groups.pop()
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

  const groups: Word[][] = []
  let current: Word[] = []
  for (const word of words) {
    if (current.length > 0 && shouldBreak(current, word, limits)) {
      groups.push(current)
      current = []
    }
    current.push(word)
  }
  if (current.length > 0) groups.push(current)
  rebalanceTrailingWord(groups, limits)

  const chunks = groups
    .map(segmentFromWords)
    .filter((segment): segment is MediaTranscriptSegment => segment !== null)
  segments.forEach((segment, index) => {
    if ((wordsBySegment[index]?.length ?? 0) > 0) return
    const text = segment.text.trim()
    if (text.length > 0) chunks.push({ text, start: segment.start, end: segment.end })
  })
  return chunks.toSorted((left, right) => left.start - right.start)
}
