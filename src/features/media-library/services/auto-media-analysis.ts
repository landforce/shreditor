import { createLogger } from '@/shared/logging/logger'
import { getMedia, getTranscriptMediaIds } from '@/infrastructure/storage'
import {
  readNativeTranscriptionEngine,
  requestNativeTranscription,
} from '@/infrastructure/storage/bridge-fs/bridge-transcription'
import { getMediaType } from '../utils/validation'
import { motionRenderGraphic } from '../utils/motion-renders'
import { planBackgroundTranscription } from '../utils/background-transcription'
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
 * Background pass run when a project opens: make sure every video gets a
 * transcript, then run visual analysis on videos with no AI captions.
 * Together these let the media pane suggest Speaker / B-roll categories
 * (use-auto-categories.ts). Transcripts come from the bridge's whisper.cpp
 * when it can; the in-app model is only the fallback (see
 * planBackgroundTranscription), so nothing is transcribed twice.
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
  // Motion renders are rendered graphics: no speech to transcribe, nothing to sort.
  const videoIds = mediaItems
    .filter(
      (media) =>
        getMediaType(media.mimeType) === 'video' &&
        !broken.has(media.id) &&
        !motionRenderGraphic(media.fileName),
    )
    .map((media) => media.id)

  if (!(await ensureTranscripts(projectId, videoIds))) return
  if (!isStillCurrent(projectId)) return
  await analyzeUncaptioned(videoIds)
}

/** Get each video a transcript (see planBackgroundTranscription). False when the project changed. */
async function ensureTranscripts(projectId: string, mediaIds: string[]): Promise<boolean> {
  // Ask the workspace, not the store: the store's transcript map may still be
  // loading, and the bridge may have queued native transcription since.
  // Retries earlier in-app failures too (e.g. a model download).
  const transcribed = await getTranscriptMediaIds(mediaIds)
  const nativeAvailable = (await readNativeTranscriptionEngine())?.available === true
  for (const mediaId of mediaIds) {
    if (!isStillCurrent(projectId)) return false
    try {
      await transcribeInBackground(mediaId, transcribed.has(mediaId), nativeAvailable)
    } catch (error) {
      // The clip is retried on the next open.
      log.warn('Auto transcription skipped', { mediaId, error })
    }
  }
  return true
}

async function transcribeInBackground(
  mediaId: string,
  stored: boolean,
  nativeAvailable: boolean,
): Promise<void> {
  const inApp = useMediaLibraryStore.getState().transcriptStatus.get(mediaId)
  // A transcription started from the media card owns this media.
  if (inApp === 'queued' || inApp === 'transcribing') return
  const media = await getMedia(mediaId)
  if (!media) return
  const plan = planBackgroundTranscription({
    media,
    hasTranscript: stored || inApp === 'ready',
    nativeAvailable,
  })
  if (plan === 'native') await requestNativeTranscription(mediaId)
  else if (plan === 'browser') await runMediaTranscriptionJob(mediaId, { origin: 'background' })
}

async function analyzeUncaptioned(mediaIds: string[]): Promise<void> {
  const latest = new Map(useMediaLibraryStore.getState().mediaItems.map((m) => [m.id, m]))
  const uncaptioned = mediaIds.filter((id) => (latest.get(id)?.aiCaptions?.length ?? 0) === 0)
  if (uncaptioned.length > 0) {
    await mediaAnalysisService.analyzeBatch({ mediaIds: uncaptioned, onlyMissing: true })
  }
}
