/**
 * Analyse whatever the given clips still need before they are drawn: the
 * export path and the headless harness call this so a render never shows an
 * uncut frame for want of a mask. Reports overall progress over all jobs.
 */
import type { TimelineItem } from '@/types/timeline'
import {
  cutoutJobId,
  getCutoutJobs,
  requestCutoutAnalysis,
  subscribeCutoutJobs,
  type CutoutJobStatus,
} from './cutout-analysis'
import { getCutoutMediaInfo } from './cutout-masks'
import { planCutoutNeeds, planCutoutRegions } from './cutout-plan'
import { getCutoutStore, readCutoutIndex } from './cutout-store'
import { cutoutCoverage, cutoutRegionKey, findCutoutEntry } from '@/shared/cutout/cutout-core.mjs'
import { regionCovers } from '@/shared/cutout/cutout-strokes.mjs'
import type { CutoutNeed, CutoutRegionNeed } from './cutout-plan'
import {
  getCutoutRegionJobs,
  requestCutoutRegion,
  subscribeCutoutRegionJobs,
} from './cutout-regions'

export type CutoutSourceResolver = (mediaId: string) => Promise<{ blob?: Blob; url?: string }>

/** A media URL as a worker source: blob URLs are read here (the worker can't see them). */
export async function cutoutSourceFromUrl(url: string): Promise<{ blob?: Blob; url?: string }> {
  if (!url) throw new Error('The media file is not available')
  return url.startsWith('blob:') ? { blob: await (await fetch(url)).blob() } : { url }
}

/** Whether everything a need asks for is stored already (no job needed). */
async function isCovered(need: CutoutNeed): Promise<boolean> {
  const index = await readCutoutIndex(need.mediaId)
  const found = findCutoutEntry(index, {
    fingerprint: need.info.fingerprint,
    subject: need.subject,
    rate: need.rate,
  })
  if (!found.entry) return false
  return cutoutCoverage(need.need, found.entry).missing.length === 0
}

type ProgressReporter = (fraction: number, message: string) => void

/** Whether a smart stroke's region is tracked over everything it needs. */
async function isRegionTracked(need: CutoutRegionNeed): Promise<boolean> {
  const index = await readCutoutIndex(need.mediaId)
  const key = cutoutRegionKey({
    fingerprint: need.info.fingerprint,
    rate: need.rate,
    hash: need.hash,
  })
  return regionCovers(index.regions[key], need.range.first, need.range.last)
}

/** Track the smart strokes' regions the clips need and are missing. */
async function ensureCutoutRegions(
  items: readonly TimelineItem[],
  fps: number,
  resolveSource: CutoutSourceResolver,
  onProgress?: ProgressReporter,
): Promise<void> {
  const planned = planCutoutRegions(items, fps, getCutoutMediaInfo)
  const tracked = await Promise.all(planned.map(isRegionTracked))
  const needs = planned.filter((_, i) => !tracked[i])
  if (needs.length === 0) return
  const unsubscribe = subscribeCutoutRegionJobs(() => {
    const mine = getCutoutRegionJobs().filter((job) => needs.some((n) => job.hash === n.hash))
    const done = mine.filter((job) => job.state === 'done').length
    onProgress?.(done / needs.length, `Tracking brush strokes ${done}/${needs.length}`)
  })
  try {
    const results = await Promise.all(
      needs.map((need) =>
        requestCutoutRegion({ ...need, source: () => resolveSource(need.mediaId) }),
      ),
    )
    const failed = results.find((job) => job.state === 'error')
    if (failed) throw new Error(`Smart brush tracking failed: ${failed.error ?? 'unknown error'}`)
  } finally {
    unsubscribe()
  }
}

/**
 * Analyse whatever the clips still need: the auto masks (only around `frames`
 * when given), then the regions of their smart strokes.
 */
export async function ensureCutoutMasks(
  items: readonly TimelineItem[],
  fps: number,
  resolveSource: CutoutSourceResolver,
  options: { frames?: number[]; onProgress?: ProgressReporter } = {},
): Promise<CutoutJobStatus[]> {
  if (!getCutoutStore()) return []
  const jobs = await ensureAutoMasks(items, fps, resolveSource, options)
  await ensureCutoutRegions(items, fps, resolveSource, options.onProgress)
  return jobs
}

async function ensureAutoMasks(
  items: readonly TimelineItem[],
  fps: number,
  resolveSource: CutoutSourceResolver,
  options: { frames?: number[]; onProgress?: ProgressReporter },
): Promise<CutoutJobStatus[]> {
  const planned = planCutoutNeeds(items, fps, getCutoutMediaInfo, options.frames)
  const needs = (
    await Promise.all(planned.map(async (need) => ((await isCovered(need)) ? null : need)))
  ).filter((need): need is CutoutNeed => need !== null)
  if (needs.length === 0) return []
  const ids = new Set<string>()
  const report = () => {
    if (!options.onProgress) return
    const mine = getCutoutJobs().filter((job) => ids.has(job.id))
    const count = mine.reduce((sum, job) => sum + job.count, 0)
    const done = mine.reduce((sum, job) => sum + Math.min(job.done, job.count), 0)
    const downloading = mine.find((job) => job.state === 'downloading')
    options.onProgress(
      count > 0 ? done / count : 0,
      downloading?.total
        ? `Downloading background removal model ${Math.round(((downloading.received ?? 0) / downloading.total) * 100)}%`
        : `Removing background ${done}/${count}`,
    )
  }
  const unsubscribe = subscribeCutoutJobs(report)
  try {
    const results = await Promise.all(
      needs.map((need) => {
        const promise = requestCutoutAnalysis({
          mediaId: need.mediaId,
          subject: need.subject,
          rate: need.rate,
          info: need.info,
          need: need.need,
          source: () => resolveSource(need.mediaId),
        })
        ids.add(cutoutJobId(need))
        return promise
      }),
    )
    const failed = results.find((job) => job.state === 'error')
    if (failed) throw new Error(`Background removal failed: ${failed.error ?? 'unknown error'}`)
    return results
  } finally {
    unsubscribe()
  }
}
