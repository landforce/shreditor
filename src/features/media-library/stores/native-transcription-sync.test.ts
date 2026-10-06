import { describe, expect, it } from 'vite-plus/test'
import type { MediaMetadata, NativeTranscriptionStatus } from '@/types/storage'
import { findNewNativeTranscripts } from './native-transcription-sync'

const media = (id: string, transcription?: Partial<NativeTranscriptionStatus>) =>
  ({
    id,
    ...(transcription
      ? { transcription: { engine: 'whisper.cpp', updatedAt: 1, ...transcription } }
      : {}),
  }) as MediaMetadata

describe('findNewNativeTranscripts', () => {
  it('reports media whose native transcript just finished or was rewritten', () => {
    const before = [
      media('queued', { status: 'queued' }),
      media('running', { status: 'running' }),
      media('same', { status: 'done', updatedAt: 5 }),
      media('again', { status: 'done', updatedAt: 5 }),
      media('plain'),
    ]
    const after = [
      media('queued', { status: 'running' }),
      media('running', { status: 'done', updatedAt: 9 }),
      media('same', { status: 'done', updatedAt: 5 }),
      media('again', { status: 'done', updatedAt: 7 }),
      media('plain'),
      media('new', { status: 'done' }),
    ]
    expect(findNewNativeTranscripts(before, after)).toEqual(['running', 'again'])
  })
})
