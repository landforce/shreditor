import { describe, expect, it } from 'vitest'
import { computeSpeechCoverage, suggestVideoCategory } from './media-role'

const caption = (text: string, subjects: string[] = []) => ({
  timeSec: 0,
  text,
  sceneData: { subjects },
})

const AUDIO = { audioCodec: 'aac' }
const native = (status: 'queued' | 'running' | 'none' | 'failed' | 'unavailable') => ({
  ...AUDIO,
  transcription: { status, engine: 'whisper.cpp' as const, updatedAt: 0 },
})

describe('computeSpeechCoverage', () => {
  it('unions overlapping segments and clamps to the duration', () => {
    const segments = [
      { start: 0, end: 4 },
      { start: 3, end: 6 },
      { start: 8, end: 12 },
    ]
    expect(computeSpeechCoverage(segments, 10)).toBeCloseTo(0.8)
  })

  it('is zero without segments or duration', () => {
    expect(computeSpeechCoverage([], 10)).toBe(0)
    expect(computeSpeechCoverage([{ start: 0, end: 1 }], 0)).toBe(0)
  })
})

describe('suggestVideoCategory (maps the analysis onto categories)', () => {
  const on = { analysisEnabled: true }

  it('is pending while a transcript is still coming', () => {
    expect(
      suggestVideoCategory({
        media: AUDIO,
        transcriptStatus: 'transcribing',
        speechCoverage: undefined,
        ...on,
      }),
    ).toBe('pending')
    expect(
      suggestVideoCategory({
        media: AUDIO,
        transcriptStatus: 'ready',
        speechCoverage: undefined,
        ...on,
      }),
    ).toBe('pending')
    for (const status of ['queued', 'running'] as const) {
      expect(
        suggestVideoCategory({
          media: native(status),
          transcriptStatus: 'idle',
          speechCoverage: undefined,
          analysisEnabled: false,
        }),
      ).toBe('pending')
    }
    // Native failed or unavailable: the background pass falls back to the app.
    expect(
      suggestVideoCategory({
        media: native('failed'),
        transcriptStatus: 'idle',
        speechCoverage: undefined,
        ...on,
      }),
    ).toBe('pending')
  })

  it('makes no suggestion when nothing is coming', () => {
    expect(
      suggestVideoCategory({
        media: AUDIO,
        transcriptStatus: 'error',
        speechCoverage: undefined,
        ...on,
      }),
    ).toBeUndefined()
    expect(
      suggestVideoCategory({
        media: native('unavailable'),
        transcriptStatus: 'idle',
        speechCoverage: undefined,
        analysisEnabled: false,
      }),
    ).toBeUndefined()
  })

  it('maps mostly-speech clips to speaker', () => {
    expect(
      suggestVideoCategory({
        media: AUDIO,
        transcriptStatus: 'ready',
        speechCoverage: 0.7,
        ...on,
      }),
    ).toBe('speaker')
    expect(
      suggestVideoCategory({
        media: { ...AUDIO, aiCaptions: [caption('a man talks to the camera', ['man'])] },
        transcriptStatus: 'ready',
        speechCoverage: 0.7,
        ...on,
      }),
    ).toBe('speaker')
  })

  it('maps silent clips, quiet clips and voiceover-over-footage to b-roll', () => {
    expect(
      suggestVideoCategory({
        media: {},
        transcriptStatus: 'idle',
        speechCoverage: undefined,
        ...on,
      }),
    ).toBe('b-roll')
    expect(
      suggestVideoCategory({
        media: native('none'),
        transcriptStatus: 'idle',
        speechCoverage: undefined,
        ...on,
      }),
    ).toBe('b-roll')
    expect(
      suggestVideoCategory({
        media: AUDIO,
        transcriptStatus: 'ready',
        speechCoverage: 0.1,
        ...on,
      }),
    ).toBe('b-roll')
    expect(
      suggestVideoCategory({
        media: { ...AUDIO, aiCaptions: [caption('an empty warehouse floor', ['warehouse'])] },
        transcriptStatus: 'ready',
        speechCoverage: 0.9,
        ...on,
      }),
    ).toBe('b-roll')
  })
})
