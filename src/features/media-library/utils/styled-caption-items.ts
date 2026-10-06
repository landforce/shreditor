/**
 * Captions made with a caption style: a clip's transcript, mapped through the
 * clip's source window (trim and speed), chunked by the style's rules and
 * written as caption text items that use the style.
 */

import type { MediaTranscriptSegment } from '@/types/storage'
import type { AudioItem, TextItem, VideoItem } from '@/types/timeline'
import type { CaptionChunkRules, TextStyleDefinition } from '@/types/text-style'
import { buildApplyTextStyleUpdates } from '@/shared/typography/text-styles/text-style-resolve'
import { buildCaptionTextItems, getClipSourceBounds } from './caption-items'
import {
  DEFAULT_CAPTION_CHUNK_LIMITS,
  chunkTranscriptForCaptions,
  wrapCaptionLines,
  type CaptionChunkLimits,
} from './caption-chunking'

/** Rules for a caption style that has none of its own. */
export const DEFAULT_CAPTION_RULES: CaptionChunkRules = {
  maxWordsPerChunk: DEFAULT_CAPTION_CHUNK_LIMITS.maxWords,
  maxCharsPerLine: DEFAULT_CAPTION_CHUNK_LIMITS.maxCharsPerLine,
  maxLines: 2,
  minChunkFrames: 12,
}

function limitsFor(rules: CaptionChunkRules): CaptionChunkLimits {
  return {
    ...DEFAULT_CAPTION_CHUNK_LIMITS,
    maxWords: rules.maxWordsPerChunk,
    maxCharsPerLine: rules.maxCharsPerLine,
    maxLines: rules.maxLines,
    minWords: Math.min(DEFAULT_CAPTION_CHUNK_LIMITS.minWords, rules.maxWordsPerChunk),
    // More room on screen holds a chunk longer.
    maxSeconds: DEFAULT_CAPTION_CHUNK_LIMITS.maxSeconds * Math.max(1, rules.maxLines),
  }
}

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

function styleWord(text: string, rules: CaptionChunkRules): string {
  const stripped = rules.punctuation === 'strip' ? text.replace(EDGE_PUNCTUATION, '') : text
  if (rules.case === 'upper') return stripped.toUpperCase()
  if (rules.case === 'lower') return stripped.toLowerCase()
  return stripped
}

function chunkText(chunk: MediaTranscriptSegment, rules: CaptionChunkRules): string {
  const words = (chunk.words?.map((word) => word.text) ?? chunk.text.split(/\s+/))
    .map((word) => styleWord(word, rules))
    .filter(Boolean)
  return wrapCaptionLines(words, rules.maxCharsPerLine).join('\n')
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

/** Hold each caption at least `minFrames`, never into the next one or past the clip. */
function holdMinimum(items: TextItem[], minFrames: number, clipEnd: number): void {
  items.sort((a, b) => a.from - b.from)
  items.forEach((item, index) => {
    if (item.durationInFrames >= minFrames) return
    const limit = Math.min(items[index + 1]?.from ?? clipEnd, clipEnd)
    item.durationInFrames = Math.max(item.durationInFrames, Math.min(minFrames, limit - item.from))
  })
}

interface BuildStyledCaptionItemsOptions {
  clip: AudioItem | VideoItem
  segments: readonly MediaTranscriptSegment[]
  style: TextStyleDefinition
  trackId: string
  timelineFps: number
  canvas: { width: number; height: number }
}

export function buildStyledCaptionItems({
  clip,
  segments,
  style,
  trackId,
  timelineFps,
  canvas,
}: BuildStyledCaptionItemsOptions): TextItem[] {
  const rules = style.caption ?? DEFAULT_CAPTION_RULES
  const bounds = getClipSourceBounds(clip, timelineFps)
  const spoken = wordsInWindow(
    segments,
    bounds.sourceStart / bounds.sourceFps,
    bounds.sourceEnd / bounds.sourceFps,
  )
  const chunks = chunkTranscriptForCaptions(spoken, limitsFor(rules))
    .map((chunk) => ({ ...chunk, text: chunkText(chunk, rules) }))
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
  holdMinimum(items, rules.minChunkFrames, clip.from + clip.durationInFrames)
  return items
}
