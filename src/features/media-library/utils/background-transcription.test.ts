import { describe, expect, it } from 'vitest'
import type { NativeTranscriptionStatus } from '@/types/storage'
import { planBackgroundTranscription } from './background-transcription'

const media = (status?: NativeTranscriptionStatus['status']) => ({
  audioCodec: 'aac',
  ...(status ? { transcription: { status, engine: 'whisper.cpp' as const, updatedAt: 0 } } : {}),
})

describe('planBackgroundTranscription', () => {
  it('never transcribes media that already has a transcript, or no audio', () => {
    for (const nativeAvailable of [true, false]) {
      expect(
        planBackgroundTranscription({ media: media(), hasTranscript: true, nativeAvailable }),
      ).toBe('skip')
      expect(
        planBackgroundTranscription({ media: {}, hasTranscript: false, nativeAvailable }),
      ).toBe('skip')
    }
    expect(
      planBackgroundTranscription({
        media: media('failed'),
        hasTranscript: true,
        nativeAvailable: false,
      }),
    ).toBe('skip')
  })

  it('leaves media the bridge owns to native whisper.cpp', () => {
    for (const status of ['queued', 'running', 'done', 'none'] as const) {
      for (const nativeAvailable of [true, false]) {
        expect(
          planBackgroundTranscription({
            media: media(status),
            hasTranscript: false,
            nativeAvailable,
          }),
        ).toBe('skip')
      }
    }
  })

  it('asks the bridge first when it can transcribe and has no status yet', () => {
    expect(
      planBackgroundTranscription({ media: media(), hasTranscript: false, nativeAvailable: true }),
    ).toBe('native')
  })

  it('falls back to the app only when native is unavailable or failed', () => {
    expect(
      planBackgroundTranscription({ media: media(), hasTranscript: false, nativeAvailable: false }),
    ).toBe('browser')
    for (const status of ['unavailable', 'failed'] as const) {
      expect(
        planBackgroundTranscription({
          media: media(status),
          hasTranscript: false,
          nativeAvailable: true,
        }),
      ).toBe('browser')
    }
  })
})
