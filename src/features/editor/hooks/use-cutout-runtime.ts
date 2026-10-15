/**
 * Background removal in the editor (docs/background-removal.md): points the
 * cutout code at the open workspace and the media library, and keeps cut-out
 * clips analysed in the background. Whenever the clips change (a toggle in the
 * clip panel, a trim, an agent pass), what they need and is missing is queued;
 * one job runs at a time in a worker, and the preview redraws as masks land.
 */
import { useEffect } from 'react'
import { isCutoutActive } from '@/shared/cutout/cutout-core.mjs'
import { configureCutoutStore } from '@/infrastructure/cutout/cutout-store'
import { createWorkspaceCutoutStore } from '@/infrastructure/cutout/workspace-cutout-store'
import {
  cutoutMediaInfoFromMetadata,
  setCutoutMediaResolver,
} from '@/infrastructure/cutout/cutout-masks'
import { cutoutSourceFromUrl, ensureCutoutMasks } from '@/infrastructure/cutout/cutout-ensure'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import {
  resolveMediaUrl,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library-contract'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('Cutout')
const SCHEDULE_DELAY_MS = 600

/** Analyse what the timeline's cut-out clips are missing (no-op when none). */
export function analyseTimelineCutouts(): Promise<unknown> {
  const { items, fps } = useTimelineStore.getState()
  if (!items.some((item) => isCutoutActive(item))) return Promise.resolve()
  return ensureCutoutMasks(items, fps, async (mediaId) =>
    cutoutSourceFromUrl(await resolveMediaUrl(mediaId)),
  ).catch((error: unknown) => log.warn('Background removal analysis failed', error))
}

export function useCutoutRuntime(projectId: string): void {
  useEffect(() => {
    configureCutoutStore(createWorkspaceCutoutStore())
    setCutoutMediaResolver((mediaId) => {
      const meta = useMediaLibraryStore.getState().mediaById[mediaId]
      return meta ? cutoutMediaInfoFromMetadata(meta) : null
    })
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void analyseTimelineCutouts()
      }, SCHEDULE_DELAY_MS)
    }
    const unsubItems = useItemsStore.subscribe((state, prev) => {
      if (state.items !== prev.items) schedule()
    })
    const unsubMedia = useMediaLibraryStore.subscribe((state, prev) => {
      if (state.mediaById !== prev.mediaById) schedule()
    })
    schedule()
    return () => {
      if (timer) clearTimeout(timer)
      unsubItems()
      unsubMedia()
    }
  }, [projectId])
}
