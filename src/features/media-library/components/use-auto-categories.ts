import { useEffect, useMemo, useState } from 'react'
import type { MediaCategory } from '@/types/storage'
import { createLogger } from '@/shared/logging/logger'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { useSettingsStore } from '../deps/settings-contract'
import { mediaTranscriptionService } from '../services/media-transcription-service'
import {
  autoCategoryUpdate,
  hasExplicitCategory,
  mediaTypeGroupOf,
  type CategoryVerdict,
} from '../utils/media-categories'
import { computeSpeechCoverage, suggestVideoCategory } from '../utils/media-role'

const log = createLogger('useAutoCategories')

// Speech coverage per mediaId, shared across mounts so reopening the panel
// doesn't re-read every transcript from the workspace.
const coverageCache = new Map<string, number>()

// Suggestions already sent this session (mediaId -> category), so a failed or
// refused write isn't retried on every render.
const sentSuggestions = new Map<string, MediaCategory>()

/**
 * The background analysis's verdict for every project video without an
 * explicit category (see `suggestVideoCategory`), and the writer that records
 * new verdicts as automatic category suggestions. Transcripts are read once
 * per media and re-read when they change. Settings > AI "Analyze media" off:
 * no verdicts, so nothing is suggested and nothing shows as "Analyzing".
 */
export function useAutoCategories(): Map<string, CategoryVerdict> {
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus)
  const analysisEnabled = useSettingsStore((s) => s.autoAnalyzeMediaOnOpen)
  const [coverage, setCoverage] = useState(() => new Map(coverageCache))

  const videos = useMemo(
    () =>
      analysisEnabled
        ? mediaItems.filter(
            (item) => mediaTypeGroupOf(item) === 'video' && !hasExplicitCategory(item),
          )
        : [],
    [mediaItems, analysisEnabled],
  )

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
          log.warn('Failed to read transcript for category suggestion', {
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

  const verdicts = useMemo(() => {
    const out = new Map<string, CategoryVerdict>()
    for (const media of videos) {
      out.set(
        media.id,
        suggestVideoCategory({
          media,
          transcriptStatus: transcriptStatus.get(media.id),
          speechCoverage: coverage.get(media.id),
          analysisEnabled,
        }),
      )
    }
    return out
  }, [videos, transcriptStatus, coverage, analysisEnabled])

  useEffect(() => {
    const suggestions = videos.flatMap((media) => {
      const verdict = verdicts.get(media.id)
      const update = verdict === 'pending' ? null : autoCategoryUpdate(media, verdict)
      if (!update || sentSuggestions.get(media.id) === update.category) return []
      sentSuggestions.set(media.id, update.category)
      return [{ mediaId: media.id, category: update.category }]
    })
    if (suggestions.length > 0) {
      void useMediaLibraryStore.getState().suggestMediaCategories(suggestions)
    }
  }, [videos, verdicts])

  return verdicts
}
