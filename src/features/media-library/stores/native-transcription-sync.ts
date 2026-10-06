import type { MediaMetadata } from '@/types/storage'
import { announceExternalTranscriptChange } from '../services/transcript-change-events'

/**
 * Media whose native (bridge) transcript was written since `previous` was
 * loaded: the status moved to `done` or was stamped again. New media are
 * left out; their transcript status loads with them.
 */
export function findNewNativeTranscripts(
  previous: readonly MediaMetadata[],
  fresh: readonly MediaMetadata[],
): string[] {
  const before = new Map(previous.map((item) => [item.id, item.transcription]))
  return fresh
    .filter((item) => {
      if (item.transcription?.status !== 'done' || !before.has(item.id)) return false
      const earlier = before.get(item.id)
      return earlier?.status !== 'done' || earlier.updatedAt !== item.transcription.updatedAt
    })
    .map((item) => item.id)
}

/** Tell open transcript views (panel, captions) to re-read these transcripts. */
export function announceNativeTranscripts(mediaIds: readonly string[]): void {
  for (const mediaId of mediaIds) announceExternalTranscriptChange(mediaId)
}
