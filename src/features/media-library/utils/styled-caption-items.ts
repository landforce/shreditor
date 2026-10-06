/**
 * Captions made with a caption style: a clip's transcript, mapped through the
 * clip's source window (trim and speed), chunked by the rules of the style's
 * variant for the canvas and written as caption text items that use the style.
 */

import type { MediaTranscriptSegment, MediaTranscriptWord } from '@/types/storage'
import type { AudioItem, TextItem, VideoItem } from '@/types/timeline'
import type { CaptionChunkRules, TextStyleDefinition } from '@/types/text-style'
import {
  buildApplyTextStyleUpdates,
  requireTextStyleVariant,
} from '@/shared/typography/text-styles/text-style-resolve'
import { buildCaptionTextItems, getClipSourceBounds } from './caption-items'
import {
  DEFAULT_CAPTION_CHUNK_LIMITS,
  breakCaptionLines,
  chunkTranscriptForCaptions,
  wrapCaptionLines,
  type CaptionChunkLimits,
} from './caption-chunking'
import { usesEnglishPhraseRules } from './caption-phrase-boundaries'

/** Rules for a caption style that has none of its own. */
const DEFAULT_CAPTION_RULES: CaptionChunkRules = {
  maxWordsPerChunk: DEFAULT_CAPTION_CHUNK_LIMITS.maxWords,
  maxCharsPerLine: DEFAULT_CAPTION_CHUNK_LIMITS.maxCharsPerLine,
  maxLines: 2,
  minChunkFrames: 12,
}

interface ChunkContext {
  language?: string
  /** Source seconds a timeline frame shows (speed / fps). */
  sourceSecondsPerFrame: number
}

function limitsFor(rules: CaptionChunkRules, context: ChunkContext): CaptionChunkLimits {
  const minWords = rules.minWordsPerChunk ?? DEFAULT_CAPTION_CHUNK_LIMITS.minWords
  return {
    ...DEFAULT_CAPTION_CHUNK_LIMITS,
    maxWords: rules.maxWordsPerChunk,
    maxCharsPerLine: rules.maxCharsPerLine,
    maxLines: rules.maxLines,
    minWords: Math.min(minWords, rules.maxWordsPerChunk),
    // More room on screen holds a chunk longer.
    maxSeconds: DEFAULT_CAPTION_CHUNK_LIMITS.maxSeconds * Math.max(1, rules.maxLines),
    // The style's hold, in the source seconds the chunker works in.
    minSeconds: rules.minChunkFrames * context.sourceSecondsPerFrame,
    breakOn: rules.breakOn ?? 'phrase',
    ...(context.language ? { language: context.language } : {}),
  }
}

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

function styleWord(text: string, rules: CaptionChunkRules): string {
  const stripped = rules.punctuation === 'strip' ? text.replace(EDGE_PUNCTUATION, '') : text
  if (rules.case === 'upper') return stripped.toUpperCase()
  if (rules.case === 'lower') return stripped.toLowerCase()
  return stripped
}

function spokenWords(chunk: MediaTranscriptSegment): MediaTranscriptWord[] {
  if (chunk.words) return chunk.words
  return chunk.text.split(/\s+/).map((text) => ({ text, start: chunk.start, end: chunk.end }))
}

/** The chunk's words as shown, in lines: at the best phrase boundary, or greedily by words. */
function chunkText(chunk: MediaTranscriptSegment, rules: CaptionChunkRules, english: boolean) {
  const shown = spokenWords(chunk)
    .map((word) => ({ word, text: styleWord(word.text, rules) }))
    .filter((entry) => entry.text.length > 0)
  const texts = shown.map((entry) => entry.text)
  const lines =
    rules.breakOn === 'words'
      ? wrapCaptionLines(texts, rules.maxCharsPerLine)
      : breakCaptionLines(
          shown.map((entry) => entry.word),
          texts,
          rules.maxCharsPerLine,
          english,
        )
  return lines.join('\n')
}

/** Only the words spoken inside the clip's source window (by their midpoint). */
function wordsInWindow(
  segments: readonly MediaTranscriptSegment[],
  startSec: number,
  endSec: number,
): MediaTranscriptSegment[] {
  return segments.flatMap((segment) => {
    if (!segment.words?.length) {
      return segment.end > startSec && segment.start < endSec ? [segment] : []
    }
    const words = segment.words.filter((word) => {
      const middle = (word.start + word.end) / 2
      return middle >= startSec && middle < endSec
    })
    return words.length > 0 ? [{ ...segment, words }] : []
  })
}

/**
 * Captions follow each other on one track: end each one where the next
 * starts (word timing rounds outward, so neighbours can share a frame), then
 * hold each at least `minFrames`, never into the next one or past the clip.
 */
function fitCaptionTimes(items: TextItem[], minFrames: number, clipEnd: number): void {
  items.sort((a, b) => a.from - b.from)
  items.forEach((item, index) => {
    const limit = Math.min(items[index + 1]?.from ?? clipEnd, clipEnd)
    const fitted = Math.min(item.durationInFrames, limit - item.from)
    item.durationInFrames = Math.max(1, fitted, Math.min(minFrames, limit - item.from))
  })
}

interface BuildStyledCaptionItemsOptions {
  clip: AudioItem | VideoItem
  segments: readonly MediaTranscriptSegment[]
  style: TextStyleDefinition
  trackId: string
  timelineFps: number
  canvas: { width: number; height: number }
  /** The transcript's language; without it, English is detected from the words. */
  language?: string
}

export function buildStyledCaptionItems({
  clip,
  segments,
  style,
  trackId,
  timelineFps,
  canvas,
  language,
}: BuildStyledCaptionItemsOptions): TextItem[] {
  const rules = requireTextStyleVariant(style, canvas).caption ?? DEFAULT_CAPTION_RULES
  const bounds = getClipSourceBounds(clip, timelineFps)
  const spoken = wordsInWindow(
    segments,
    bounds.sourceStart / bounds.sourceFps,
    bounds.sourceEnd / bounds.sourceFps,
  )
  const limits = limitsFor(rules, {
    language,
    sourceSecondsPerFrame: (clip.speed || 1) / timelineFps,
  })
  const english = usesEnglishPhraseRules(
    spoken.flatMap((segment) => segment.words ?? []),
    language,
  )
  const chunks = chunkTranscriptForCaptions(spoken, limits)
    .map((chunk) => ({ ...chunk, text: chunkText(chunk, rules, english) }))
    .filter((chunk) => chunk.text.length > 0)
  const items = buildCaptionTextItems({
    mediaId: clip.mediaId ?? '',
    trackId,
    segments: chunks,
    clip,
    timelineFps,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  }).map(
    (item): TextItem => ({
      ...item,
      ...buildApplyTextStyleUpdates(item, style, canvas),
      label: item.text.replace(/\s+/g, ' ').slice(0, 48),
      textRole: 'caption',
      formatRole: 'captions',
    }),
  )
  fitCaptionTimes(items, rules.minChunkFrames, clip.from + clip.durationInFrames)
  return items
}
