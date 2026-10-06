import { useEffect, useMemo, useState } from 'react'
import type { MediaMetadata } from '@/types/storage'
import { createLogger } from '@/shared/logging/logger'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { mediaTranscriptionService } from '../services/media-transcription-service'
import { classifyMediaRole, computeSpeechCoverage, type MediaRole } from '../utils/media-role'

const log = createLogger('useMediaRoles')

// Speech coverage per mediaId, shared across mounts so reopening the panel
// doesn't re-read every transcript from the workspace.
const coverageCache = new Map<string, number>()

/**
 * Classifies video media as speaker / b-roll from its transcript and visual
 * captions. Transcripts are read once per media and re-read when they change.
 */
export function useMediaRoles(videos: readonly MediaMetadata[]): Map<string, MediaRole> {
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus)
  const [coverage, setCoverage] = useState(() => new Map(coverageCache))

  useEffect(
    () =>
      mediaTranscriptionService.onTranscriptChanged((mediaId) => {
        coverageCache.delete(mediaId)
        setCoverage(new Map(coverageCache))
      }),
    [],
  )

  useEffect(() => {
    const toLoad = videos.filter(
      (media) => transcriptStatus.get(media.id) === 'ready' && !coverage.has(media.id),
    )
    if (toLoad.length === 0) return
    let cancelled = false
    void (async () => {
      for (const media of toLoad) {
        try {
          const transcript = await mediaTranscriptionService.getTranscript(media.id)
          coverageCache.set(
            media.id,
            computeSpeechCoverage(transcript?.segments ?? [], media.duration),
          )
        } catch (error) {
          log.warn('Failed to read transcript for role classification', {
            mediaId: media.id,
            error,
          })
          coverageCache.set(media.id, 0)
        }
      }
      if (!cancelled) setCoverage(new Map(coverageCache))
    })()
    return () => {
      cancelled = true
    }
  }, [videos, transcriptStatus, coverage])

  return useMemo(() => {
    const roles = new Map<string, MediaRole>()
    for (const media of videos) {
      roles.set(
        media.id,
        classifyMediaRole({
          media,
          transcriptStatus: transcriptStatus.get(media.id),
          speechCoverage: coverage.get(media.id),
        }),
      )
    }
    return roles
  }, [videos, transcriptStatus, coverage])
}
