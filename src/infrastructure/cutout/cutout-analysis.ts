/**
 * The cutout analysis queue: one job at a time, each job one media + model +
 * sample rate, covering the sample ranges its clips need that are not stored
 * yet. Runs the model in ./cutout.worker, writes each mask into the cutout
 * store and keeps the media's index up to date, so preview and export pick the
 * masks up as they land. Progress is observable (`subscribeCutoutJobs`) and
 * jobs can be cancelled. Used by the editor and by the headless harness.
 */
import type { CutoutSubject } from '@/types/cutout'
import {
  CUTOUT_BLANK_COVERAGE,
  CUTOUT_MASK_LONG_EDGE,
  cutoutAnalysisKey,
  cutoutCoverage,
  cutoutModelFor,
  cutoutModelUrl,
  cutoutSamplePath,
  emptyCutoutIndex,
  findCutoutEntry,
  mergeIndexRanges,
  type CutoutBackend,
  type CutoutIndexEntry,
  type CutoutModel,
  type IndexRange,
} from '@/shared/cutout/cutout-core.mjs'
import {
  getCutoutStore,
  notifyCutoutStoreChange,
  readCutoutIndex,
  writeCutoutIndex,
} from './cutout-store'
import type { CutoutMediaInfo } from './cutout-masks'
import type { CutoutWorkerRequest, CutoutWorkerResponse } from './cutout.worker'

export type CutoutJobState =
  | 'queued'
  | 'downloading'
  | 'preparing'
  | 'analyzing'
  | 'done'
  | 'error'
  | 'cancelled'

export interface CutoutJobStatus {
  id: string
  mediaId: string
  subject: CutoutSubject
  state: CutoutJobState
  /** Samples analysed so far in this job, and how many it set out to do. */
  done: number
  count: number
  /** Model download bytes while downloading. */
  received?: number
  total?: number
  fromCache?: boolean
  backend?: CutoutBackend
  error?: string
  updatedAt: number
}

export interface CutoutJobRequest {
  mediaId: string
  subject: CutoutSubject
  rate: number
  info: CutoutMediaInfo
  /** Sample ranges the clips need (padded), see sampleRangeFor. */
  need: IndexRange[]
  /** The source to decode: a Blob, or a URL the worker can fetch. */
  source: () => Promise<{ blob?: Blob; url?: string }>
}

let modelUrlFor: (model: CutoutModel, backend: CutoutBackend) => string = cutoutModelUrl

/** Where the worker downloads models from (the headless harness uses the service's cache). */
export function setCutoutModelUrlResolver(
  resolver: ((model: CutoutModel, backend: CutoutBackend) => string) | null,
): void {
  modelUrlFor = resolver ?? cutoutModelUrl
}

const jobs = new Map<string, CutoutJobStatus>()
const listeners = new Set<() => void>()
let snapshot: CutoutJobStatus[] = []
let chain: Promise<void> = Promise.resolve()
const pending = new Map<string, Promise<CutoutJobStatus>>()
const cancelledJobs = new Set<string>()
let worker: Worker | null = null
let activeJobId: string | null = null

function emit(): void {
  snapshot = [...jobs.values()]
  for (const listener of listeners) listener()
}

function update(id: string, patch: Partial<CutoutJobStatus>): void {
  const job = jobs.get(id)
  if (!job) return
  jobs.set(id, { ...job, ...patch, updatedAt: Date.now() })
  emit()
}

export function subscribeCutoutJobs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getCutoutJobs(): CutoutJobStatus[] {
  return snapshot
}

/** The id of the job a request joins (one per media, subject and rate). */
export function cutoutJobId(
  request: Pick<CutoutJobRequest, 'mediaId' | 'subject' | 'rate'>,
): string {
  return `${request.mediaId}|${request.subject}|${request.rate}`
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

/** Cancel a queued or running job (by id), or all of them. */
export function cancelCutoutJob(id?: string): void {
  for (const job of jobs.values()) {
    if (id && job.id !== id) continue
    if (job.state === 'done' || job.state === 'error' || job.state === 'cancelled') continue
    cancelledJobs.add(job.id)
    if (job.id === activeJobId) {
      worker?.postMessage({ type: 'cancel', jobId: job.id } satisfies CutoutWorkerRequest)
    }
  }
}

interface WorkerRun {
  model: CutoutModel
  key: string
  indices: number[]
  source: { blob?: Blob; url?: string }
  onMask?: (index: number, coverage: number) => void
}

/** Run the worker over `indices`, storing each mask; resolves with the entry it filled. */
// fallow-ignore-next-line complexity
function runWorker(
  id: string,
  request: CutoutJobRequest,
  run: WorkerRun,
): Promise<{ entry: CutoutIndexEntry | null; cancelled: boolean }> {
  const store = getCutoutStore()
  if (!store) return Promise.reject(new Error('The cutout store is not configured'))
  const w = getWorker()
  const workerJobId = `${id}#${run.model.id}#${Date.now()}`
  activeJobId = id
  let entry: CutoutIndexEntry | null = null
  let lastIndexWrite = 0
  const writes: Promise<void>[] = []
  const flush = async () => {
    if (!entry) return
    const index = emptyCutoutIndex()
    index.entries[entry.key] = { ...entry, updatedAt: Date.now() }
    await writeCutoutIndex(request.mediaId, index)
    lastIndexWrite = Date.now()
    notifyCutoutStoreChange()
  }
  return new Promise((resolve, reject) => {
    const finish = async (cancelled: boolean, error?: string) => {
      w.removeEventListener('message', onMessage)
      activeJobId = null
      try {
        await Promise.all(writes)
        await flush()
      } catch (flushError) {
        error ??= flushError instanceof Error ? flushError.message : String(flushError)
      }
      if (error) reject(new Error(error))
      else resolve({ entry, cancelled })
    }
    const onMessage = (event: MessageEvent<CutoutWorkerResponse>) => {
      const message = event.data
      if (message.jobId !== workerJobId) return
      switch (message.type) {
        case 'progress':
          if (message.stage === 'download') {
            update(id, {
              state: 'downloading',
              received: message.received,
              total: message.total,
              fromCache: message.fromCache,
            })
          } else if (message.stage === 'prepare') {
            update(id, { state: 'preparing' })
          }
          break
        case 'mask': {
          const write = store
            .write(
              request.mediaId,
              cutoutSamplePath(run.key, message.index),
              new Blob([message.png], { type: 'image/png' }),
            )
            .then(() => {
              entry = {
                ...(entry ?? {
                  key: run.key,
                  fingerprint: request.info.fingerprint,
                  model: run.model.id,
                  subject: run.model.subject,
                  rate: request.rate,
                  maskWidth: message.maskWidth,
                  maskHeight: message.maskHeight,
                  sourceWidth: message.sourceWidth,
                  sourceHeight: message.sourceHeight,
                  done: [],
                  updatedAt: Date.now(),
                }),
              }
              entry.done = mergeIndexRanges([...entry.done, [message.index, message.index]])
              run.onMask?.(message.index, message.coverage)
              const job = jobs.get(id)
              update(id, { state: 'analyzing', done: (job?.done ?? 0) + 1 })
              if (Date.now() - lastIndexWrite > 1500) return flush()
            })
          writes.push(write)
          break
        }
        case 'done':
          update(id, { backend: message.backend })
          void finish(false)
          break
        case 'cancelled':
          void finish(true)
          break
        case 'error':
          void finish(false, message.error)
          break
      }
    }
    w.addEventListener('message', onMessage)
    w.postMessage({
      type: 'analyze',
      jobId: workerJobId,
      source: run.source,
      model: run.model.id,
      urls: { webgpu: modelUrlFor(run.model, 'webgpu'), wasm: modelUrlFor(run.model, 'wasm') },
      indices: run.indices,
      rate: request.rate,
      maskLongEdge: CUTOUT_MASK_LONG_EDGE,
      smoothing: 0.5,
    } satisfies CutoutWorkerRequest)
    if (cancelledJobs.has(id)) {
      w.postMessage({ type: 'cancel', jobId: workerJobId } satisfies CutoutWorkerRequest)
    }
  })
}

function expand(ranges: IndexRange[]): number[] {
  const out: number[] = []
  for (const [a, b] of ranges) for (let i = a; i <= b; i++) out.push(i)
  return out
}

/** Decide 'auto' for a media: try the person model on a few samples, else object. */
async function decideAuto(
  id: string,
  request: CutoutJobRequest,
  source: { blob?: Blob; url?: string },
): Promise<'person' | 'object' | null> {
  const all = expand(mergeIndexRanges(request.need))
  if (all.length === 0) return null
  const probe = [...new Set([all[0]!, all[Math.floor(all.length / 2)]!, all.at(-1)!])]
  const person = cutoutModelFor('person')
  const key = cutoutAnalysisKey({
    fingerprint: request.info.fingerprint,
    model: person.id,
    rate: request.rate,
  })
  let covered = 0
  update(id, { count: probe.length, done: 0 })
  const result = await runWorker(id, request, {
    model: person,
    key,
    indices: probe,
    source,
    onMask: (_index, coverage) => {
      covered = Math.max(covered, coverage)
    },
  })
  if (result.cancelled) return null
  const decision = covered >= CUTOUT_BLANK_COVERAGE ? 'person' : 'object'
  const index = emptyCutoutIndex()
  index.auto[request.info.fingerprint] = decision
  await writeCutoutIndex(request.mediaId, index)
  notifyCutoutStoreChange()
  return decision
}

// fallow-ignore-next-line complexity
async function runJob(id: string, request: CutoutJobRequest): Promise<void> {
  if (cancelledJobs.has(id)) {
    cancelledJobs.delete(id)
    update(id, { state: 'cancelled' })
    return
  }
  try {
    const source = await request.source()
    let index = await readCutoutIndex(request.mediaId, true)
    let found = findCutoutEntry(index, {
      fingerprint: request.info.fingerprint,
      subject: request.subject,
      rate: request.rate,
    })
    if (request.subject === 'auto' && !found.subject) {
      const decision = await decideAuto(id, request, source)
      if (!decision) {
        update(id, { state: 'cancelled' })
        return
      }
      index = await readCutoutIndex(request.mediaId, true)
      found = findCutoutEntry(index, {
        fingerprint: request.info.fingerprint,
        subject: request.subject,
        rate: request.rate,
      })
    }
    const subject = found.subject ?? (request.subject === 'object' ? 'object' : 'person')
    const model = cutoutModelFor(subject)
    const key =
      found.key ??
      cutoutAnalysisKey({
        fingerprint: request.info.fingerprint,
        model: model.id,
        rate: request.rate,
      })
    const coverage = cutoutCoverage(request.need, found.entry)
    const indices = expand(coverage.missing)
    update(id, { count: indices.length, done: 0 })
    if (indices.length > 0) {
      const result = await runWorker(id, request, { model, key, indices, source })
      if (result.cancelled) {
        update(id, { state: 'cancelled' })
        return
      }
    }
    update(id, { state: 'done' })
  } catch (error) {
    update(id, { state: 'error', error: error instanceof Error ? error.message : String(error) })
  } finally {
    cancelledJobs.delete(id)
  }
}

/**
 * Analyse what a media's clips need and is missing. Jobs run one at a time; a
 * request for a job already queued or running joins it. Resolves with the
 * job's final status.
 */
export function requestCutoutAnalysis(request: CutoutJobRequest): Promise<CutoutJobStatus> {
  const id = cutoutJobId(request)
  const existing = pending.get(id)
  // A cancelled job still winding down is not joined: the new request runs after it.
  if (existing && !cancelledJobs.has(id)) return existing
  jobs.set(id, {
    id,
    mediaId: request.mediaId,
    subject: request.subject,
    state: 'queued',
    done: 0,
    count: 0,
    updatedAt: Date.now(),
  })
  emit()
  const promise: Promise<CutoutJobStatus> = (chain = chain.then(() => runJob(id, request))).then(
    () => {
      if (pending.get(id) === promise) pending.delete(id)
      return jobs.get(id)!
    },
  )
  pending.set(id, promise)
  return promise
}
