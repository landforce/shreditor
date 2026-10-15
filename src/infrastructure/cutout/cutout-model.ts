/**
 * Runs one cutout model (MODNet for people, BiRefNet lite for objects) on
 * onnxruntime-web: WebGPU when the adapter takes the graph, else wasm. Weights
 * come through the shared ONNX model cache from a pinned URL and are checked
 * against their SHA-256 before a session is made from them.
 *
 * Worker-safe: no DOM access.
 */
import {
  cutoutModelUrl,
  type CutoutBackend,
  type CutoutModel,
} from '@/shared/cutout/cutout-core.mjs'
import { fetchOnnxModelBytes, ONNX_MODEL_CACHE_NAME } from '@/shared/utils/onnx-model-cache'
import { getOrt, type OrtModule, type OrtSession } from '@/shared/utils/ort-runtime'

export interface CutoutDownloadProgress {
  received: number
  total: number
  fromCache: boolean
}

export type CutoutModelUrlFor = (model: CutoutModel, backend: CutoutBackend) => string

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function dropCached(url: string): Promise<void> {
  try {
    const cache = await caches.open(ONNX_MODEL_CACHE_NAME)
    await cache.delete(url)
  } catch {
    // No Cache Storage here; nothing was kept.
  }
}

/** Fetch a model file and refuse it unless its SHA-256 matches the pinned one. */
async function fetchVerifiedModel(
  model: CutoutModel,
  backend: CutoutBackend,
  urlFor: CutoutModelUrlFor,
  onProgress?: (progress: CutoutDownloadProgress) => void,
): Promise<ArrayBuffer> {
  const url = urlFor(model, backend)
  const expected = model.files[backend].sha256
  const bytes = await fetchOnnxModelBytes(url, (received, total, fromCache) =>
    onProgress?.({ received, total, fromCache }),
  )
  const actual = await sha256Hex(bytes)
  if (actual !== expected) {
    await dropCached(url)
    throw new Error(
      `${model.label}: downloaded file failed its SHA-256 check (got ${actual.slice(0, 12)}…, expected ${expected.slice(0, 12)}…)`,
    )
  }
  return bytes
}

/** IEEE half from a float (round to nearest). */
function toHalf(value: number): number {
  const f = new Float32Array([value])
  const x = new Uint32Array(f.buffer)[0]!
  const sign = (x >>> 16) & 0x8000
  const exp = ((x >>> 23) & 0xff) - 127 + 15
  const mant = x & 0x7fffff
  if (exp <= 0) return sign
  if (exp >= 31) return sign | 0x7c00
  return sign | (exp << 10) | ((mant + 0x1000) >>> 13)
}

function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1
  const exp = (h >>> 10) & 0x1f
  const mant = h & 0x3ff
  if (exp === 0) return sign * 2 ** -14 * (mant / 1024)
  if (exp === 31) return mant ? Number.NaN : sign * Infinity
  return sign * 2 ** (exp - 15) * (1 + mant / 1024)
}

/** The size a model wants a frame of `width` x `height` at. */
export function cutoutModelInputSize(
  model: CutoutModel,
  width: number,
  height: number,
): { width: number; height: number } {
  const input = model.input
  if (input.kind === 'birefnet') return { width: input.width, height: input.height }
  const scale = input.shortEdge / Math.min(width, height)
  const snap = (v: number) =>
    Math.max(input.multiple, Math.round(v / input.multiple) * input.multiple)
  return { width: snap(width * scale), height: snap(height * scale) }
}

/** RGBA pixels → normalized planar RGB, as the model expects. */
export function rgbaToModelInput(
  model: CutoutModel,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const { mean, std } = model.input
  const plane = width * height
  const out = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = (rgba[i * 4 + c]! / 255 - mean[c]!) / std[c]!
    }
  }
  return out
}

/** Model output → alpha 0..1 (BiRefNet emits logits; MODNet a matte). */
export function normalizeModelAlpha(values: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(values)
  let min = Infinity
  let max = -Infinity
  for (const v of out) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (min < -0.01 || max > 1.01) {
    for (let i = 0; i < out.length; i++) out[i] = 1 / (1 + Math.exp(-out[i]!))
  } else {
    for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, out[i]!))
  }
  return out
}

export class CutoutModelRunner {
  private session: OrtSession | null = null
  private ort: OrtModule | null = null
  private half = false
  backend: CutoutBackend = 'wasm'
  private loading: Promise<void> | null = null

  constructor(
    readonly model: CutoutModel,
    private readonly urlFor: CutoutModelUrlFor = cutoutModelUrl,
  ) {}

  // `ready` and `run` are reached only from cutout.worker.ts, across a
  // `new Worker(new URL(...))` edge that static analysis cannot follow.
  // fallow-ignore-next-line unused-class-member
  ready(onProgress?: (progress: CutoutDownloadProgress) => void): Promise<void> {
    if (!this.loading) {
      this.loading = this.load(onProgress).catch((error) => {
        this.loading = null
        throw error
      })
    }
    return this.loading
  }

  private async load(onProgress?: (progress: CutoutDownloadProgress) => void): Promise<void> {
    const ort = await getOrt()
    this.ort = ort
    const gpu = typeof navigator !== 'undefined' ? (navigator as { gpu?: GPU }).gpu : undefined
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
    const order: CutoutBackend[] = adapter ? ['webgpu', 'wasm'] : ['wasm']
    let lastError: unknown = null
    for (const backend of order) {
      try {
        const bytes = await fetchVerifiedModel(this.model, backend, this.urlFor, onProgress)
        this.session = await ort.InferenceSession.create(new Uint8Array(bytes), {
          executionProviders: [backend],
          graphOptimizationLevel: 'all',
        })
        this.backend = backend
        const name = this.session.inputNames[0]!
        const meta = (
          this.session as unknown as { inputMetadata?: Array<{ name: string; type?: string }> }
        ).inputMetadata
        this.half = Boolean(meta?.find((m) => m.name === name)?.type?.includes('16'))
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /** Alpha (row-major, 0..1, at the model's output size) of one frame given as model-sized RGBA. */
  // fallow-ignore-next-line unused-class-member complexity
  async run(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<{ alpha: Float32Array; width: number; height: number }> {
    const ort = this.ort
    const session = this.session
    if (!ort || !session) throw new Error('CutoutModelRunner.ready() must resolve first')
    const input = rgbaToModelInput(this.model, rgba, width, height)
    const name = session.inputNames[0]!
    const feed = (half: boolean) =>
      half
        ? new ort.Tensor('float16', Uint16Array.from(input, toHalf), [1, 3, height, width])
        : new ort.Tensor('float32', input, [1, 3, height, width])
    let result: Awaited<ReturnType<OrtSession['run']>>
    try {
      result = await session.run({ [name]: feed(this.half) })
    } catch (error) {
      // Some exports keep half-precision I/O without saying so in their metadata.
      this.half = !this.half
      try {
        result = await session.run({ [name]: feed(this.half) })
      } catch {
        throw error
      }
    }
    const output = result[session.outputNames[0]!]!
    const data = output.data as ArrayLike<number>
    const values =
      output.type === 'float16' && data instanceof Uint16Array ? Array.from(data, fromHalf) : data
    const alpha = normalizeModelAlpha(values)
    const dims = output.dims
    output.dispose?.()
    const outHeight = Number(dims[dims.length - 2] ?? height)
    const outWidth = Number(dims[dims.length - 1] ?? width)
    return { alpha, width: outWidth, height: outHeight }
  }
}
