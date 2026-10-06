import type { MediaMetadata } from '@/types/storage'
import { hasAudioTrack } from './media-role'

/**
 * Which transcriber, if any, the background analysis pass should use for a
 * media. Native whisper.cpp in the local bridge (server/transcription.mjs) is
 * preferred; the in-app (browser) model is only the fallback, so a media is
 * never transcribed twice and no transcript is ever overwritten:
 *
 * - `skip`: no audio, a transcript already exists (app, background or
 *   native), or the bridge owns it (queued / running / done / none)
 * - `native`: no native status yet but the bridge can transcribe: ask it
 * - `browser`: native is unavailable (status 'unavailable', no bridge or
 *   engine) or failed
 */
export type BackgroundTranscriptionPlan = 'skip' | 'native' | 'browser'

const NATIVE_OWNED = new Set(['queued', 'running', 'done', 'none'])

export function planBackgroundTranscription(input: {
  /** Read fresh from the workspace, not the store (the bridge writes it). */
  media: Pick<MediaMetadata, 'audioCodec' | 'transcription'>
  hasTranscript: boolean
  /** The bridge's whisper.cpp engine is installed and enabled. */
  nativeAvailable: boolean
}): BackgroundTranscriptionPlan {
  const { media, hasTranscript, nativeAvailable } = input
  if (!hasAudioTrack(media) || hasTranscript) return 'skip'
  const status = media.transcription?.status
  if (status && NATIVE_OWNED.has(status)) return 'skip'
  if (status === 'failed' || status === 'unavailable') return 'browser'
  return nativeAvailable ? 'native' : 'browser'
}
