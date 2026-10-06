/**
 * Native transcription through the local workspace bridge
 * (`server/transcription.mjs`). Imports queue it on their own; these calls
 * retry a media and describe the engine for Settings.
 */

const BASE = '/__shreditor'

export interface NativeTranscriptionEngine {
  enabled: boolean
  available: boolean
  engine: 'whisper.cpp'
  version: string | null
  modelName: string
  missing: string[]
  hint?: string
}

/** Queue (or with `force`, redo) native transcription of one media. */
export async function requestNativeTranscription(
  mediaId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const res = await fetch(`${BASE}/media/transcribe`, {
    method: 'POST',
    body: JSON.stringify({ mediaId, force: options.force === true }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `Transcription request failed (${res.status})`)
  }
}

/** The bridge's native engine, or null when no bridge serves this editor. */
export async function readNativeTranscriptionEngine(): Promise<NativeTranscriptionEngine | null> {
  try {
    const res = await fetch(`${BASE}/transcription/engine`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as NativeTranscriptionEngine
  } catch {
    return null
  }
}
