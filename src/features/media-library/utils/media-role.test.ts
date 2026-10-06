import { describe, expect, it } from 'vitest'
import { classifyMediaRole, computeSpeechCoverage } from './media-role'

const caption = (text: string, subjects: string[] = []) => ({
  timeSec: 0,
  text,
  sceneData: { subjects },
})

const AUDIO = { audioCodec: 'aac' }

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

describe('classifyMediaRole', () => {
  it('is pending until the transcript is ready and read', () => {
    expect(
      classifyMediaRole({
        media: AUDIO,
        transcriptStatus: 'transcribing',
        speechCoverage: undefined,
      }),
    ).toBe('pending')
    expect(
      classifyMediaRole({ media: AUDIO, transcriptStatus: 'ready', speechCoverage: undefined }),
    ).toBe('pending')
  })

  it('treats mostly-speech clips as speaker', () => {
    expect(
      classifyMediaRole({ media: AUDIO, transcriptStatus: 'ready', speechCoverage: 0.7 }),
    ).toBe('speaker')
    expect(
      classifyMediaRole({
        media: { ...AUDIO, aiCaptions: [caption('a man talks to the camera', ['man'])] },
        transcriptStatus: 'ready',
        speechCoverage: 0.7,
      }),
    ).toBe('speaker')
  })

  it('keeps failed transcriptions pending rather than guessing', () => {
    expect(
      classifyMediaRole({ media: AUDIO, transcriptStatus: 'error', speechCoverage: undefined }),
    ).toBe('pending')
  })

  it('trusts a native no-speech result', () => {
    expect(
      classifyMediaRole({
        media: { ...AUDIO, transcription: { status: 'none', engine: 'whisper.cpp', updatedAt: 0 } },
        transcriptStatus: 'idle',
        speechCoverage: undefined,
      }),
    ).toBe('broll')
  })

  it('treats silent clips, quiet clips and voiceover-only footage as b-roll', () => {
    expect(
      classifyMediaRole({ media: {}, transcriptStatus: 'idle', speechCoverage: undefined }),
    ).toBe('broll')
    expect(
      classifyMediaRole({ media: AUDIO, transcriptStatus: 'ready', speechCoverage: 0.1 }),
    ).toBe('broll')
    expect(
      classifyMediaRole({
        media: { ...AUDIO, aiCaptions: [caption('an empty warehouse floor', ['warehouse'])] },
        transcriptStatus: 'ready',
        speechCoverage: 0.9,
      }),
    ).toBe('broll')
  })
})
