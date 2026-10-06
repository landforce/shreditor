import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { scoreProject } from '@formats/scorecard.mjs'
import { getTranscript } from '@/infrastructure/storage'
import { createLogger } from '@/shared/logging/logger'
import { useFormatScorecardStore } from '@/shared/state/format-scorecard'
import type { TimelineItem } from '@/types/timeline'
import type { MediaTranscript } from '@/types/storage'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  useCompositionNavigationStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { useProjectFormatRecord } from './project-format'

const logger = createLogger('FormatScorecard')
const SCORE_DEBOUNCE_MS = 200

/** Ids of the timeline's media that have a stored transcript, sorted and joined. */
function useTranscribedMediaKey(items: TimelineItem[]): string {
  const status = useMediaLibraryStore((s) => s.transcriptStatus)
  return useMemo(() => {
    const ids = new Set<string>()
    for (const item of items) {
      if (item.mediaId && status.get(item.mediaId) === 'ready') ids.add(item.mediaId)
    }
    return [...ids].sort().join('|')
  }, [items, status])
}

/** Transcripts (source seconds) of the timeline's transcribed media, loaded once per media. */
function useScorecardTranscripts(items: TimelineItem[]): Record<string, MediaTranscript> {
  const key = useTranscribedMediaKey(items)
  const cache = useRef(new Map<string, MediaTranscript>())
  const [transcripts, setTranscripts] = useState<Record<string, MediaTranscript>>({})

  useEffect(() => {
    const ids = key ? key.split('|') : []
    for (const id of [...cache.current.keys()]) if (!ids.includes(id)) cache.current.delete(id)
    let cancelled = false
    void Promise.all(
      ids
        .filter((id) => !cache.current.has(id))
        .map(async (id) => {
          const transcript = await getTranscript(id).catch(() => undefined)
          if (transcript) cache.current.set(id, transcript)
        }),
    ).then(() => {
      if (!cancelled) setTranscripts(Object.fromEntries(cache.current))
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return transcripts
}

/**
 * Scores the Main timeline against the project's format on every change
 * (debounced; scoreProject is pure) and publishes the card for the format
 * panel, the toolbar chip and the timeline ruler. Inside a composition the
 * last Main card is kept and marked stale.
 */
export const FormatScorecardController = memo(function FormatScorecardController() {
  const format = useProjectFormatRecord()
  const metadata = useProjectStore((s) => s.currentProject?.metadata)
  const items = useTimelineStore((s) => s.items)
  const tracks = useTimelineStore((s) => s.tracks)
  const transitions = useTimelineStore((s) => s.transitions)
  const onMain = useCompositionNavigationStore((s) => s.activeCompositionId === null)
  const mediaById = useMediaLibraryStore((s) => s.mediaById)
  const transcripts = useScorecardTranscripts(items)

  useEffect(() => {
    const { setCard, card } = useFormatScorecardStore.getState()
    if (!format) {
      setCard(null)
      return
    }
    if (!onMain) {
      setCard(card, true)
      return
    }
    const timer = window.setTimeout(() => {
      try {
        const project = {
          metadata: { fps: metadata?.fps, height: metadata?.height },
          format,
          timeline: { tracks, items, transitions },
        }
        setCard(scoreProject(project, { mediaById, transcripts }))
      } catch (error) {
        logger.warn('Scoring the timeline failed', error)
        setCard(null)
      }
    }, SCORE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [format, metadata, items, tracks, transitions, onMain, mediaById, transcripts])

  useEffect(() => () => useFormatScorecardStore.getState().setCard(null), [])

  return null
})
