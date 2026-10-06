/**
 * Transcripts written outside this tab (the bridge's native transcription).
 * A dependency-free channel so the media library store can announce them
 * without importing the transcription service.
 */
type Listener = (mediaId: string) => void

const listeners = new Set<Listener>()

export function onExternalTranscriptChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function announceExternalTranscriptChange(mediaId: string): void {
  for (const listener of listeners) listener(mediaId)
}
