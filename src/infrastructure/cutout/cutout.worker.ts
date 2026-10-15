/**
 * Cutout analysis worker: decodes the requested source samples with
 * mediabunny, runs the matting model on each, stabilises the mattes over time
 * (./cutout-temporal) and posts each mask back as an 8-bit PNG. The page that
 * owns the worker stores them (./cutout-analysis). Models stay loaded between
 * jobs. The editor and the headless harness run the same worker.
 */
import { ensureProResDecoderRegistered } from '@/infrastructure/browser/register-prores-decoder'
import { applyBitstreamColorSpace } from '@/infrastructure/browser/mediabunny-video-color-space'
import {
  CUTOUT_MODELS,
  type CutoutBackend,
  type CutoutModelId,
} from '@/shared/cutout/cutout-core.mjs'
import { CutoutModelRunner, cutoutModelInputSize } from './cutout-model'
import { alphaCoverage, lumaOf, maskSize, smoothAlpha } from './cutout-temporal'

export interface CutoutAnalyzeRequest {
  type: 'analyze'
  jobId: string
  source: { blob?: Blob; url?: string }
  model: CutoutModelId
  /** Download URL per backend (pinned upstream, or the agent service's model cache). */
  urls: Record<CutoutBackend, string>
  /** Sample indices to analyse, ascending. */
  indices: number[]
  rate: number
  maskLongEdge: number
  /** 0..1, how strongly still regions keep the previous matte. */
  smoothing: number
}

export type CutoutWorkerRequest = CutoutAnalyzeRequest | { type: 'cancel'; jobId: string }

export type CutoutWorkerResponse =
  | {
      type: 'progress'
      jobId: string
      stage: 'download' | 'prepare' | 'analyze'
      received?: number
      total?: number
      fromCache?: boolean
      done?: number
      count?: number
    }
  | {
      type: 'mask'
      jobId: string
      index: number
      png: ArrayBuffer
      maskWidth: number
      maskHeight: number
      sourceWidth: number
      sourceHeight: number
      coverage: number
    }
  | { type: 'done'; jobId: string; backend: CutoutBackend }
  | { type: 'error'; jobId: string; error: string }
  | { type: 'cancelled'; jobId: string }

const runners = new Map<string, CutoutModelRunner>()
const cancelled = new Set<string>()

function post(message: CutoutWorkerResponse, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}

function runnerFor(request: CutoutAnalyzeRequest): CutoutModelRunner {
  const key = `${request.model}|${request.urls.webgpu}|${request.urls.wasm}`
  let runner = runners.get(key)
  if (!runner) {
    runner = new CutoutModelRunner(CUTOUT_MODELS[request.model], (_model, backend) => {
      return request.urls[backend]
    })
    runners.set(key, runner)
  }
  return runner
}

async function openSource(source: CutoutAnalyzeRequest['source']) {
  await ensureProResDecoderRegistered().catch(() => {})
  const mb = await import('mediabunny')
  const input = new mb.Input({
    source: source.blob ? new mb.BlobSource(source.blob) : new mb.UrlSource(source.url ?? ''),
    formats: mb.ALL_FORMATS,
  })
  const track = await input.getPrimaryVideoTrack()
  if (!track) {
    input.dispose()
    throw new Error('The media has no video track')
  }
  return { input, sink: new mb.VideoSampleSink(applyBitstreamColorSpace(track)) }
}

function context2d(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('OffscreenCanvas 2D is unavailable')
  return ctx
}

async function encodeMask(
  alpha: Float32Array,
  width: number,
  height: number,
  out: { width: number; height: number },
): Promise<ArrayBuffer> {
  const full = context2d(width, height)
  const image = full.createImageData(width, height)
  for (let i = 0; i < alpha.length; i++) {
    const v = Math.round(alpha[i]! * 255)
    image.data[i * 4] = v
    image.data[i * 4 + 1] = v
    image.data[i * 4 + 2] = v
    image.data[i * 4 + 3] = 255
  }
  full.putImageData(image, 0, 0)
  const scaled = context2d(out.width, out.height)
  scaled.imageSmoothingEnabled = true
  scaled.imageSmoothingQuality = 'high'
  scaled.drawImage(full.canvas, 0, 0, out.width, out.height)
  const blob = await (scaled.canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' })
  return blob.arrayBuffer()
}

// fallow-ignore-next-line complexity
async function analyze(request: CutoutAnalyzeRequest): Promise<void> {
  const { jobId } = request
  const runner = runnerFor(request)
  await runner.ready((p) =>
    post({
      type: 'progress',
      jobId,
      stage: 'download',
      received: p.received,
      total: p.total,
      fromCache: p.fromCache,
    }),
  )
  post({ type: 'progress', jobId, stage: 'prepare' })
  const { input, sink } = await openSource(request.source)
  try {
    let previous: { index: number; alpha: Float32Array; luma: Float32Array } | null = null
    let done = 0
    const times = request.indices.map((index) => index / request.rate)
    let n = 0
    for await (const sample of sink.samplesAtTimestamps(times)) {
      const index = request.indices[n++]!
      if (cancelled.has(jobId)) {
        sample?.close()
        cancelled.delete(jobId)
        post({ type: 'cancelled', jobId })
        return
      }
      if (!sample) continue
      const sourceWidth = sample.displayWidth
      const sourceHeight = sample.displayHeight
      const size = cutoutModelInputSize(runner.model, sourceWidth, sourceHeight)
      const ctx = context2d(size.width, size.height)
      sample.draw(ctx, 0, 0, size.width, size.height)
      sample.close()
      const rgba = ctx.getImageData(0, 0, size.width, size.height).data
      const result = await runner.run(rgba, size.width, size.height)
      let alpha = result.alpha
      const sameGrid = result.width === size.width && result.height === size.height
      const luma = sameGrid ? lumaOf(rgba) : new Float32Array(0)
      if (
        sameGrid &&
        previous &&
        previous.index === index - 1 &&
        previous.alpha.length === alpha.length &&
        request.smoothing > 0
      ) {
        alpha = smoothAlpha(alpha, previous.alpha, luma, previous.luma, request.smoothing)
      }
      previous = sameGrid ? { index, alpha, luma } : null
      const out = maskSize(sourceWidth, sourceHeight, request.maskLongEdge)
      const png = await encodeMask(alpha, result.width, result.height, out)
      post(
        {
          type: 'mask',
          jobId,
          index,
          png,
          maskWidth: out.width,
          maskHeight: out.height,
          sourceWidth,
          sourceHeight,
          coverage: alphaCoverage(alpha),
        },
        [png],
      )
      done++
      post({ type: 'progress', jobId, stage: 'analyze', done, count: request.indices.length })
    }
    post({ type: 'done', jobId, backend: runner.backend })
  } finally {
    input.dispose()
  }
}

self.onmessage = (event: MessageEvent<CutoutWorkerRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    cancelled.add(request.jobId)
    return
  }
  analyze(request).catch((error: unknown) => {
    post({
      type: 'error',
      jobId: request.jobId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
