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
import { planCutoutNeeds } from './cutout-plan'
import { getCutoutStore, readCutoutIndex } from './cutout-store'
import { cutoutCoverage, findCutoutEntry } from '@/shared/cutout/cutout-core.mjs'
import type { CutoutNeed } from './cutout-plan'

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

export async function ensureCutoutMasks(
  items: readonly TimelineItem[],
  fps: number,
  resolveSource: CutoutSourceResolver,
  options: {
    frames?: number[]
    onProgress?: (fraction: number, message: string) => void
  } = {},
): Promise<CutoutJobStatus[]> {
  if (!getCutoutStore()) return []
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
