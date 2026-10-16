/**
 * Smart brush worker: tracks one smart stroke's region through a clip's
 * samples with SlimSAM (`trackRegion` in cutout-strokes.mjs) and posts each
 * region back as an 8-bit PNG with its centroid and box. The page that owns
 * the worker stores them (./cutout-regions). The model and recent frame
 * embeddings stay loaded between jobs. The editor and the headless harness
 * run the same worker.
 */
import type { CutoutStroke } from '@/types/cutout'
import { samResizedSize } from '@/shared/cutout/cutout-sam.mjs'
import { trackRegion } from '@/shared/cutout/cutout-strokes.mjs'
import { context2d, encodeMask, openCutoutSource, type CutoutSource } from './cutout-frames'
import { SamRunner, type SamUrls } from './cutout-sam-runner'
import { maskSize } from './cutout-temporal'

export interface CutoutTrackRequest {
  type: 'track'
  jobId: string
  source: CutoutSource
  /** Identifies the source in the embedding cache (media fingerprint). */
  sourceKey: string
  urls: SamUrls
  stroke: CutoutStroke
  /** Sample indices: painted on `start`, tracked over [first, last]. */
  start: number
  first: number
  last: number
  rate: number
  maskLongEdge: number
}

export type CutoutRegionWorkerResponse =
  | {
      type: 'progress'
      jobId: string
      stage: 'download' | 'prepare'
      received?: number
      total?: number
    }
  | {
      type: 'region'
      jobId: string
      index: number
      png: ArrayBuffer
      stats: number[]
      maskWidth: number
      maskHeight: number
    }
  | { type: 'done'; jobId: string; backend: string }
  | { type: 'error'; jobId: string; error: string }

const runners = new Map<string, SamRunner>()

function post(message: CutoutRegionWorkerResponse, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}

function runnerFor(urls: SamUrls): SamRunner {
  const key = JSON.stringify(urls)
  let runner = runners.get(key)
  if (!runner) {
    runner = new SamRunner(urls)
    runners.set(key, runner)
  }
  return runner
}

type Sink = Awaited<ReturnType<typeof openCutoutSource>>['sink']

/** `segment` for trackRegion: decode the sample, embed it (cached), prompt the decoder. */
function segmenter(
  request: CutoutTrackRequest,
  runner: SamRunner,
  sink: Sink,
  frame: { width: number; height: number },
) {
  return async (index: number, points: Array<[number, number]>) => {
    const sample = await sink.getSample(index / request.rate)
    if (!sample) return null
    frame.width = sample.displayWidth
    frame.height = sample.displayHeight
    const size = samResizedSize(frame.width, frame.height)
    const ctx = context2d(size.width, size.height)
    sample.draw(ctx, 0, 0, size.width, size.height)
    sample.close()
    const rgba = ctx.getImageData(0, 0, size.width, size.height).data
    const key = `${request.sourceKey}|${Math.round((index / request.rate) * 1000)}`
    const embedding = await runner.embed(key, rgba, size.width, size.height)
    return runner.segment(embedding, points)
  }
}

async function track(request: CutoutTrackRequest): Promise<void> {
  const { jobId } = request
  const runner = runnerFor(request.urls)
  await runner.ready((p) =>
    post({ type: 'progress', jobId, stage: 'download', received: p.received, total: p.total }),
  )
  post({ type: 'progress', jobId, stage: 'prepare' })
  const { input, sink } = await openCutoutSource(request.source)
  const frame = { width: 0, height: 0 }
  try {
    const segment = segmenter(request, runner, sink, frame)
    for await (const region of trackRegion({ ...request, segment })) {
      const out = maskSize(frame.width, frame.height, request.maskLongEdge)
      const png = await encodeMask(region.mask, region.width, region.height, out)
      const message = {
        type: 'region' as const,
        jobId,
        index: region.index,
        png,
        stats: region.stats!,
      }
      post({ ...message, maskWidth: out.width, maskHeight: out.height }, [png])
    }
  } finally {
    input.dispose()
  }
  post({ type: 'done', jobId, backend: runner.backend })
}

self.onmessage = (event: MessageEvent<CutoutTrackRequest>) => {
  const request = event.data
  track(request).catch((error: unknown) => {
    post({
      type: 'error',
      jobId: request.jobId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
