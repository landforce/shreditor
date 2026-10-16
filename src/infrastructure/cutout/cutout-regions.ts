/**
 * The smart brush's tracking queue: one job per smart stroke (media, sample
 * rate and stroke hash), run one at a time in ./cutout-region.worker. Each
 * region mask lands in the cutout store beside the auto masks and the media's
 * index lists it under `regions`, so preview and export pick regions up as
 * they land. Progress is observable (`subscribeCutoutRegionJobs`).
 */
import type { CutoutStroke } from '@/types/cutout'
import {
  CUTOUT_MASK_LONG_EDGE,
  cutoutRegionKey,
  cutoutSamplePath,
  emptyCutoutIndex,
  type CutoutRegionEntry,
} from '@/shared/cutout/cutout-core.mjs'
import { cutoutStrokeHash } from '@/shared/cutout/cutout-strokes.mjs'
import { getCutoutStore, notifyCutoutStoreChange, writeCutoutIndex } from './cutout-store'
import type { CutoutMediaInfo } from './cutout-masks'
import type { CutoutSource } from './cutout-frames'
import { defaultSamUrls, type SamUrls } from './cutout-sam-runner'
import type { CutoutRegionWorkerResponse, CutoutTrackRequest } from './cutout-region.worker'

export interface CutoutRegionRequest {
  mediaId: string
  info: CutoutMediaInfo
  rate: number
  stroke: CutoutStroke
  range: { start: number; first: number; last: number }
  source: () => Promise<CutoutSource>
}

export interface CutoutRegionJob {
  id: string
  mediaId: string
  hash: string
  state: 'queued' | 'downloading' | 'tracking' | 'done' | 'error'
  /** Samples tracked so far, and the most there can be. */
  done: number
  count: number
  received?: number
  total?: number
  error?: string
}

let samUrls: () => SamUrls = defaultSamUrls

/** Where the worker downloads SlimSAM from (the headless harness uses the service's cache). */
export function setSamUrlResolver(resolver: (() => SamUrls) | null): void {
  samUrls = resolver ?? defaultSamUrls
}

const jobs = new Map<string, CutoutRegionJob>()
const listeners = new Set<() => void>()
const pending = new Map<string, Promise<CutoutRegionJob>>()
let snapshot: CutoutRegionJob[] = []
let queue: Promise<unknown> = Promise.resolve()
let worker: Worker | null = null

function setJob(id: string, patch: Partial<CutoutRegionJob>): void {
  const job = jobs.get(id)
  if (!job) return
  jobs.set(id, { ...job, ...patch })
  snapshot = [...jobs.values()]
  for (const listener of listeners) listener()
}

export function subscribeCutoutRegionJobs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getCutoutRegionJobs(): CutoutRegionJob[] {
  return snapshot
}

/** Collects one job's regions and writes them (masks as they come, the index now and then). */
class RegionWriter {
  private entry: CutoutRegionEntry
  private writes: Promise<void>[] = []
  private lastFlush = 0

  constructor(private readonly request: CutoutRegionRequest) {
    const hash = cutoutStrokeHash(request.stroke)
    const { fingerprint } = request.info
    this.entry = {
      key: cutoutRegionKey({ fingerprint, rate: request.rate, hash }),
      hash,
      tool: request.stroke.tool as CutoutRegionEntry['tool'],
      fingerprint,
      rate: request.rate,
      start: request.range.start,
      maskWidth: 0,
      maskHeight: 0,
      done: [],
      covered: [],
      stats: {},
      updatedAt: Date.now(),
    }
  }

  add(message: Extract<CutoutRegionWorkerResponse, { type: 'region' }>): number {
    const blob = new Blob([message.png], { type: 'image/png' })
    const path = cutoutSamplePath(this.entry.key, message.index)
    this.writes.push(getCutoutStore()!.write(this.request.mediaId, path, blob))
    this.entry.done.push([message.index, message.index])
    this.entry.stats[message.index] = message.stats
    this.entry.maskWidth = message.maskWidth
    this.entry.maskHeight = message.maskHeight
    if (Date.now() - this.lastFlush > 1500) void this.flush()
    return this.entry.done.length
  }

  /** Write the index entry; `finished` marks the whole range as tracked. */
  async flush(finished = false): Promise<void> {
    this.lastFlush = Date.now()
    await Promise.all(this.writes)
    if (finished) this.entry.covered = [[this.request.range.first, this.request.range.last]]
    const index = emptyCutoutIndex()
    index.regions[this.entry.key] = { ...this.entry, updatedAt: Date.now() }
    await writeCutoutIndex(this.request.mediaId, index)
    notifyCutoutStoreChange()
  }
}

function getWorker(): Worker {
  worker ??= new Worker(new URL('./cutout-region.worker.ts', import.meta.url), { type: 'module' })
  return worker
}

/** Run one job in the worker; resolves with its final state. */
async function runTrack(
  id: string,
  request: CutoutRegionRequest,
): Promise<CutoutRegionJob['state']> {
  if (!getCutoutStore()) throw new Error('The cutout store is not configured')
  const source = await request.source()
  const writer = new RegionWriter(request)
  const w = getWorker()
  const outcome = await new Promise<{ state: CutoutRegionJob['state']; error?: string }>(
    (resolve) => {
      const onMessage = (event: MessageEvent<CutoutRegionWorkerResponse>) => {
        const message = event.data
        if (message.jobId !== id) return
        if (message.type === 'progress') {
          const downloading = message.stage === 'download'
          const { received, total } = message
          setJob(id, { state: downloading ? 'downloading' : 'tracking', received, total })
        } else if (message.type === 'region') {
          setJob(id, { state: 'tracking', done: writer.add(message) })
        } else {
          w.removeEventListener('message', onMessage)
          resolve(
            message.type === 'error'
              ? { state: 'error', error: message.error }
              : { state: message.type },
          )
        }
      }
      w.addEventListener('message', onMessage)
      w.postMessage({
        type: 'track',
        jobId: id,
        source,
        sourceKey: request.info.fingerprint,
        urls: samUrls(),
        stroke: request.stroke,
        ...request.range,
        rate: request.rate,
        maskLongEdge: CUTOUT_MASK_LONG_EDGE,
      } satisfies CutoutTrackRequest)
    },
  )
  await writer.flush(outcome.state === 'done')
  setJob(id, outcome)
  return outcome.state
}

/**
 * Track a smart stroke's region (joins a job already queued or running for
 * the same stroke). Resolves with the job's final status.
 */
export function requestCutoutRegion(request: CutoutRegionRequest): Promise<CutoutRegionJob> {
  const hash = cutoutStrokeHash(request.stroke)
  const id = `${request.mediaId}|${hash}|${request.rate}`
  const existing = pending.get(id)
  if (existing) return existing
  const count = request.range.last - request.range.first + 1
  jobs.set(id, { id, mediaId: request.mediaId, hash, state: 'queued', done: 0, count })
  setJob(id, {})
  const run = queue.then(() =>
    runTrack(id, request).catch((error: unknown) =>
      setJob(id, { state: 'error', error: error instanceof Error ? error.message : String(error) }),
    ),
  )
  queue = run
  const promise = run.then(() => {
    pending.delete(id)
    return jobs.get(id)!
  })
  pending.set(id, promise)
  return promise
}
