import { createLogger } from '@/shared/logging/logger'
import { getMediaType } from '../utils/validation'
import { hasAudioTrack } from '../utils/media-role'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { useSettingsStore } from '../deps/settings-contract'
import { runMediaTranscriptionJob } from './media-transcription-runner'
import { mediaAnalysisService } from './media-analysis-service'

const log = createLogger('AutoMediaAnalysis')

/** Let the editor finish loading before heavy model work starts. */
const START_DELAY_MS = 2500

let activeProjectId: string | null = null

function isStillCurrent(projectId: string): boolean {
  return useMediaLibraryStore.getState().currentProjectId === projectId
}

/**
 * Background pass run when a project opens: transcribe every video that has
 * no transcript yet, then run visual analysis on videos with no AI captions.
 * Together these let the media pane sort clips into speaker and b-roll.
 *
 * One pass per project at a time; stops between items if the project changes.
 * Results persist in the workspace, so later opens only process new media.
 */
export function scheduleAutoMediaAnalysis(projectId: string): void {
  if (!useSettingsStore.getState().autoAnalyzeMediaOnOpen) return
  if (activeProjectId === projectId) return
  activeProjectId = projectId

  setTimeout(() => {
    void runAutoMediaAnalysis(projectId)
      .catch((error) => log.warn('Auto media analysis failed', error))
      .finally(() => {
        if (activeProjectId === projectId) activeProjectId = null
      })
  }, START_DELAY_MS)
}

async function runAutoMediaAnalysis(projectId: string): Promise<void> {
  if (!isStillCurrent(projectId)) return

  const { mediaItems, brokenMediaIds } = useMediaLibraryStore.getState()
  const broken = new Set(brokenMediaIds)
  const videos = mediaItems.filter(
    (media) => getMediaType(media.mimeType) === 'video' && !broken.has(media.id),
  )

  // Retries earlier failures too (e.g. a model download that failed last open)
  const untranscribed = videos.filter(
    (media) =>
      hasAudioTrack(media) &&
      useMediaLibraryStore.getState().transcriptStatus.get(media.id) !== 'ready',
  )
  for (const media of untranscribed) {
    if (!isStillCurrent(projectId)) return
    try {
      await runMediaTranscriptionJob(media.id, { origin: 'background' })
    } catch (error) {
      // The clip stays under "Analyzing" and is retried on the next open.
      log.warn('Auto transcription skipped', { mediaId: media.id, error })
    }
  }

  if (!isStillCurrent(projectId)) return
  const latest = new Map(useMediaLibraryStore.getState().mediaItems.map((m) => [m.id, m]))
  const uncaptioned = videos
    .map((media) => latest.get(media.id))
    .filter((media) => media && (media.aiCaptions?.length ?? 0) === 0)
    .map((media) => media!.id)
  if (uncaptioned.length > 0) {
    await mediaAnalysisService.analyzeBatch({ mediaIds: uncaptioned, onlyMissing: true })
  }
}
