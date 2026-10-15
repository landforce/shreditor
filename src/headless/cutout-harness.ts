/**
 * Background removal in the headless harness. The agent service passes its
 * cutout store in the harness URL (`?cutoutStore=<base>`): masks are read and
 * written there (the workspace's `media/<id>/cache/cutout/`), models come from
 * the service's verified model cache, and job progress is PUT back so
 * `shred cutout` can report it while the page is busy. Renders call
 * `ensureCutout` first, so cut-out clips are analysed before they are drawn.
 */
import type { TimelineItem } from '@/types/timeline'
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import { cutoutModelFileName } from '@/shared/cutout/cutout-core.mjs'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { configureCutoutStore, createHttpCutoutStore } from '@/infrastructure/cutout/cutout-store'
import {
  cutoutMediaInfoFromMetadata,
  getCutoutMediaInfo,
  setCutoutMediaResolver,
} from '@/infrastructure/cutout/cutout-masks'
import {
  getCutoutJobs,
  requestCutoutAnalysis,
  setCutoutModelUrlResolver,
  subscribeCutoutJobs,
  type CutoutJobStatus,
} from '@/infrastructure/cutout/cutout-analysis'
import { planCutoutNeeds } from '@/infrastructure/cutout/cutout-plan'
import { migrateProject } from '@/shared/projects/migrations'
import { seedMediaLibrary } from './seed-media'

let storeBase: string | null = null

/** Read the service's cutout store from the harness URL (once, at startup). */
export function configureHeadlessCutout(): void {
  storeBase = new URLSearchParams(globalThis.location?.search ?? '').get('cutoutStore')
  setCutoutMediaResolver((mediaId) => {
    const meta = useMediaLibraryStore.getState().mediaById[mediaId] as MediaMetadata | undefined
    return meta ? cutoutMediaInfoFromMetadata(meta) : null
  })
  if (!storeBase) return
  const base = storeBase
  configureCutoutStore(createHttpCutoutStore(base))
  setCutoutModelUrlResolver(
    (model, backend) => `${base}/models/${cutoutModelFileName(model, backend)}`,
  )
}

let progressJob: string | null = null
let lastProgress = 0
subscribeCutoutJobs(() => {
  if (!storeBase || !progressJob) return
  const now = Date.now()
  if (now - lastProgress < 400) return
  lastProgress = now
  void postProgress(progressJob)
})

async function postProgress(job: string): Promise<void> {
  if (!storeBase) return
  await fetch(`${storeBase}/progress?job=${encodeURIComponent(job)}`, {
    method: 'PUT',
    body: JSON.stringify({ jobs: getCutoutJobs(), at: Date.now() }),
  }).catch(() => {})
}

/**
 * Analyse what the cut-out items need (all of each clip, or only the samples
 * around `frames`). No-op without a cutout store or cut-out items.
 */
export async function ensureCutout(
  items: readonly TimelineItem[],
  fps: number,
  options: { frames?: number[]; job?: string } = {},
): Promise<CutoutJobStatus[]> {
  if (!storeBase) return []
  const needs = planCutoutNeeds(items, fps, getCutoutMediaInfo, options.frames)
  if (needs.length === 0) return []
  progressJob = options.job ?? 'render'
  const results = await Promise.all(
    needs.map((need) =>
      requestCutoutAnalysis({
        mediaId: need.mediaId,
        subject: need.subject,
        rate: need.rate,
        info: need.info,
        need: need.need,
        source: async () => {
          const url = blobUrlManager.get(need.mediaId)
          if (!url) throw new Error(`Media ${need.mediaId} has no URL in the harness`)
          return url.startsWith('blob:') ? { blob: await (await fetch(url)).blob() } : { url }
        },
      }),
    ),
  )
  await postProgress(progressJob)
  return results
}

/** `POST /v1/cutout`: analyse the cut-out items of a project (or the listed ones). */
export async function analyzeCutout(input: {
  project: Project
  media?: Array<{ mediaId: string; url: string; metadata?: MediaMetadata }>
  itemIds?: string[]
  job?: string
}): Promise<{ ok: true; jobs: CutoutJobStatus[] }> {
  if (!storeBase) throw new Error('The harness was started without a cutout store')
  const { project } = migrateProject(input.project)
  for (const entry of input.media ?? []) {
    if (!blobUrlManager.get(entry.mediaId)) blobUrlManager.registerUrl(entry.mediaId, entry.url)
  }
  seedMediaLibrary(input.media)
  const keep = input.itemIds?.length ? new Set(input.itemIds) : null
  const items = (project.timeline?.items ?? []).filter((item) => !keep || keep.has(item.id))
  const fps = project.metadata?.fps ?? 30
  const jobs = await ensureCutout(items as TimelineItem[], fps, { job: input.job })
  return { ok: true, jobs }
}
