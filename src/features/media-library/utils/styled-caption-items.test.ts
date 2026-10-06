import { describe, expect, it } from 'vite-plus/test'
import type { MediaTranscriptSegment } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import { buildStyledCaptionItems } from './styled-caption-items'
import { chunkTranscriptForCaptions, DEFAULT_CAPTION_CHUNK_LIMITS } from './caption-chunking'

// "one two three ... twelve", one word every 0.5 s, each 0.4 s long.
const WORDS = 'one two three four five six seven eight nine ten eleven twelve.'.split(' ')
const segments: MediaTranscriptSegment[] = [
  {
    text: WORDS.join(' '),
    start: 0,
    end: 6,
    words: WORDS.map((text, index) => ({ text, start: index * 0.5, end: index * 0.5 + 0.4 })),
  },
]

type CaptionRules = TextStyleDefinition['variants'][number]['caption']

const style = (caption: CaptionRules): TextStyleDefinition => ({
  id: 'caps',
  name: 'Caps',
  role: 'caption',
  variants: [
    {
      aspect: '9:16',
      style: { fontFamily: 'Anton', fontSize: 70, color: '#ffffff' },
      layout: { yRatio: 0.3, widthRatio: 0.8 },
      caption,
    },
  ],
  version: 1,
  updatedAt: 1,
})

function clip(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip',
    type: 'video',
    trackId: 'v1',
    from: 100,
    durationInFrames: 180,
    label: 'clip',
    src: '',
    mediaId: 'm1',
    sourceStart: 0,
    sourceEnd: 180,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  }
}

const build = (rules: CaptionRules, clipOverrides: Partial<VideoItem> = {}) =>
  buildStyledCaptionItems({
    clip: clip(clipOverrides),
    segments,
    style: style(rules),
    trackId: 'captions',
    timelineFps: 30,
    canvas: { width: 1080, height: 1920 },
  })

describe('buildStyledCaptionItems', () => {
  it('chunks by the word limit and makes linked caption items', () => {
    const items = build({
      maxWordsPerChunk: 3,
      maxCharsPerLine: 40,
      maxLines: 1,
      minChunkFrames: 0,
    })
    expect(items.map((item) => item.text)).toEqual([
      'one two three',
      'four five six',
      'seven eight nine',
      'ten eleven twelve.',
    ])
    expect(items[0]).toMatchObject({
      textRole: 'caption',
      formatRole: 'captions',
      textStyleId: 'caps',
      trackId: 'captions',
      fontFamily: 'Anton',
      from: 100,
      captionSource: { type: 'transcript', clipId: 'clip', mediaId: 'm1' },
    })
    expect(items[0]?.transform).toMatchObject({ y: 576, width: 864 })
  })

  it('wraps lines and never exceeds the line limit', () => {
    const items = build({
      maxWordsPerChunk: 10,
      maxCharsPerLine: 10,
      maxLines: 2,
      minChunkFrames: 0,
    })
    for (const item of items) {
      const lines = item.text.split('\n')
      expect(lines.length).toBeLessThanOrEqual(2)
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(10)
    }
    expect(items[0]?.text).toBe('one two\nthree four')
  })

  it('applies case and punctuation rules', () => {
    const items = build({
      maxWordsPerChunk: 3,
      maxCharsPerLine: 40,
      maxLines: 1,
      minChunkFrames: 0,
      case: 'upper',
      punctuation: 'strip',
    })
    expect(items.at(-1)?.text).toBe('TEN ELEVEN TWELVE')
  })

  it('holds short chunks for the minimum without overlapping the next', () => {
    const items = build({
      maxWordsPerChunk: 1,
      maxCharsPerLine: 40,
      maxLines: 1,
      minChunkFrames: 20,
    })
    expect(items).toHaveLength(12)
    items.forEach((item, index) => {
      const next = items[index + 1]
      if (next) expect(item.from + item.durationInFrames).toBeLessThanOrEqual(next.from)
      expect(item.durationInFrames).toBeGreaterThanOrEqual(
        next ? Math.min(20, next.from - item.from) : 1,
      )
    })
    expect(items[0]?.durationInFrames).toBe(15)
  })

  it('never lets neighbouring captions share a frame', () => {
    // Word ends round up and starts round down: 0.4 s -> 12, 0.5 s -> 15 here,
    // but 1/3 s steps would collide without the fit.
    const thirds: MediaTranscriptSegment[] = [
      {
        text: 'a b c d',
        start: 0,
        end: 1.34,
        words: ['a', 'b', 'c', 'd'].map((text, i) => ({ text, start: i / 3, end: i / 3 + 0.34 })),
      },
    ]
    const items = buildStyledCaptionItems({
      clip: clip(),
      segments: thirds,
      style: style({ maxWordsPerChunk: 1, maxCharsPerLine: 40, maxLines: 1, minChunkFrames: 0 }),
      trackId: 'captions',
      timelineFps: 30,
      canvas: { width: 1080, height: 1920 },
    })
    items.slice(1).forEach((item, i) => {
      expect(item.from).toBeGreaterThanOrEqual(items[i]!.from + items[i]!.durationInFrames)
    })
  })

  it('captions only the trimmed source window, starting at the clip', () => {
    // Source 2.0 s to 4.0 s: words five..eight.
    const items = build(
      { maxWordsPerChunk: 2, maxCharsPerLine: 40, maxLines: 1, minChunkFrames: 0 },
      { sourceStart: 60, sourceEnd: 120, durationInFrames: 60 },
    )
    expect(items.map((item) => item.text)).toEqual(['five six', 'seven eight'])
    expect(items[0]?.from).toBe(100)
    expect(items[1]?.from).toBe(130)
  })

  it('maps a sped-up clip onto the timeline at its speed', () => {
    const items = build(
      { maxWordsPerChunk: 2, maxCharsPerLine: 40, maxLines: 1, minChunkFrames: 0 },
      { speed: 2, durationInFrames: 90 },
    )
    expect(items).toHaveLength(6)
    // "three four" starts at 1.0 s of source = 0.5 s of timeline = 15 frames.
    expect(items[1]).toMatchObject({ text: 'three four', from: 115 })
    expect(items.at(-1)!.from + items.at(-1)!.durationInFrames).toBeLessThanOrEqual(190)
  })
})

describe('chunkTranscriptForCaptions defaults', () => {
  it('keeps the editor transcript captions as before (2.2 s at most)', () => {
    const chunks = chunkTranscriptForCaptions(segments, DEFAULT_CAPTION_CHUNK_LIMITS)
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'one two three four',
      'five six seven eight',
      'nine ten eleven twelve.',
    ])
  })
})
