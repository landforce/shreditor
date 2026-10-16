/**
 * Where a clip's background removal stands, for the clip panel and the
 * Concise shot card: the running job (model download, analysis progress) or
 * how much of what the clip plays is analysed.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { CutoutSettings } from '@/types/cutout'
import {
  cutoutCoverage,
  findCutoutEntry,
  isCutoutActive,
  mergeCutoutSettings,
} from '@/shared/cutout/cutout-core.mjs'
import { withoutCutoutStrokes } from '@/shared/cutout/cutout-strokes.mjs'
import {
  cancelCutoutJob,
  cutoutJobId,
  getCutoutJobs,
  subscribeCutoutJobs,
  type CutoutJobStatus,
} from '@/infrastructure/cutout/cutout-analysis'
import { getCutoutMediaInfo } from '@/infrastructure/cutout/cutout-masks'
import { planCutoutNeeds } from '@/infrastructure/cutout/cutout-plan'
import {
  forgetCutoutAnalysis,
  onCutoutStoreChange,
  readCutoutIndex,
} from '@/infrastructure/cutout/cutout-store'
import { executeTimelineCommand, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { analyseTimelineCutouts } from './use-cutout-runtime'

export type CutoutUiState =
  | 'off'
  | 'no-media'
  | 'queued'
  | 'downloading'
  | 'preparing'
  | 'analyzing'
  | 'ready'
  | 'partial'
  | 'none'
  | 'error'

export interface CutoutUiStatus {
  state: CutoutUiState
  /** 0..1 for the progress bar (download or analysis). */
  progress: number
  done: number
  needed: number
  /** The running job's own counts, while one runs. */
  job?: CutoutJobStatus
  resolvedSubject: 'person' | 'object' | null
  error?: string
}

interface Coverage {
  done: number
  needed: number
  key: string | null
  resolvedSubject: 'person' | 'object' | null
}

function useCoverage(item: VideoItem | undefined): Coverage | null {
  const fps = useTimelineStore((s) => s.fps)
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => onCutoutStoreChange(() => setTick((n) => n + 1)), [])
  useEffect(() => {
    let live = true
    const need =
      item && isCutoutActive(item) ? planCutoutNeeds([item], fps, getCutoutMediaInfo)[0] : null
    if (!need) {
      setCoverage(null)
      return
    }
    void readCutoutIndex(need.mediaId).then((index) => {
      if (!live) return
      const found = findCutoutEntry(index, {
        fingerprint: need.info.fingerprint,
        subject: need.subject,
        rate: need.rate,
      })
      const counts = cutoutCoverage(need.need, found.entry)
      setCoverage({
        done: counts.done,
        needed: counts.needed,
        key: found.key,
        resolvedSubject: found.subject,
      })
    })
    return () => {
      live = false
    }
  }, [item, fps, tick])
  return coverage
}

function useJob(item: VideoItem | undefined): CutoutJobStatus | undefined {
  const fps = useTimelineStore((s) => s.fps)
  const jobs = useSyncExternalStore(subscribeCutoutJobs, getCutoutJobs, getCutoutJobs)
  return useMemo(() => {
    if (!item?.mediaId || !isCutoutActive(item)) return undefined
    const need = planCutoutNeeds([item], fps, getCutoutMediaInfo)[0]
    if (!need) return undefined
    const id = cutoutJobId(need)
    return jobs.find((job) => job.id === id)
  }, [item, fps, jobs])
}

const RUNNING = new Set(['queued', 'downloading', 'preparing', 'analyzing'])

// fallow-ignore-next-line complexity
export function useCutoutStatus(item: VideoItem | undefined): CutoutUiStatus {
  const coverage = useCoverage(item)
  const job = useJob(item)
  if (!item || !isCutoutActive(item)) {
    return { state: 'off', progress: 0, done: 0, needed: 0, resolvedSubject: null }
  }
  if (!item.mediaId || !getCutoutMediaInfo(item.mediaId)) {
    return { state: 'no-media', progress: 0, done: 0, needed: 0, resolvedSubject: null }
  }
  const done = coverage?.done ?? 0
  const needed = coverage?.needed ?? 0
  const base = { done, needed, job, resolvedSubject: coverage?.resolvedSubject ?? null }
  if (job && RUNNING.has(job.state)) {
    const progress =
      job.state === 'downloading'
        ? (job.received ?? 0) / Math.max(1, job.total ?? 1)
        : job.count > 0
          ? job.done / job.count
          : 0
    return { ...base, state: job.state as CutoutUiState, progress }
  }
  if (job?.state === 'error') return { ...base, state: 'error', progress: 0, error: job.error }
  if (needed > 0 && done >= needed) return { ...base, state: 'ready', progress: 1 }
  return { ...base, state: done > 0 ? 'partial' : 'none', progress: needed ? done / needed : 0 }
}

/** Drop the clip's stored analysis and run it again. */
export async function reanalyseCutout(item: VideoItem): Promise<void> {
  if (!item.mediaId || !item.cutout) return
  const fps = useTimelineStore.getState().fps
  const need = planCutoutNeeds([item], fps, getCutoutMediaInfo)[0]
  if (!need) return
  cancelCutoutJob(cutoutJobId(need))
  const index = await readCutoutIndex(need.mediaId, true)
  const found = findCutoutEntry(index, {
    fingerprint: need.info.fingerprint,
    subject: need.subject,
    rate: need.rate,
  })
  await forgetCutoutAnalysis(
    need.mediaId,
    found.key,
    need.subject === 'auto' ? need.info.fingerprint : '',
  )
  await analyseTimelineCutouts()
}

export function cancelCutout(item: VideoItem): void {
  const fps = useTimelineStore.getState().fps
  const need = item.mediaId ? planCutoutNeeds([item], fps, getCutoutMediaInfo)[0] : undefined
  if (need) cancelCutoutJob(cutoutJobId(need))
}

/** Apply a cutout change to clips in one undo step. */
export function setClipCutout(
  items: readonly VideoItem[],
  patch: Partial<CutoutSettings>,
  commandType = 'SET_CUTOUT',
): void {
  const { updateItem } = useTimelineStore.getState()
  executeTimelineCommand(commandType, () => {
    for (const item of items) {
      updateItem(item.id, {
        cutout: mergeCutoutSettings(item.cutout, patch),
      } as Partial<TimelineItem>)
    }
  })
}

/** Remove every brush stroke from clips, in one undo step. */
export function clearClipCutoutStrokes(items: readonly VideoItem[]): void {
  const { updateItem } = useTimelineStore.getState()
  executeTimelineCommand('CLEAR_CUTOUT_STROKES', () => {
    for (const item of items) {
      updateItem(item.id, { cutout: withoutCutoutStrokes(item.cutout) } as Partial<TimelineItem>)
    }
  })
}
