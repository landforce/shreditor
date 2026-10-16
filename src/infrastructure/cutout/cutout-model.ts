/**
 * Runs one cutout model (MODNet for people, U-2-Net for objects) on
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

/** Fetch a model file (through the ONNX model cache) and refuse it unless its SHA-256 matches. */
export async function fetchVerifiedBytes(
  url: string,
  expected: string,
  label: string,
  onProgress?: (progress: CutoutDownloadProgress) => void,
): Promise<ArrayBuffer> {
  const bytes = await fetchOnnxModelBytes(url, (received, total, fromCache) =>
    onProgress?.({ received, total, fromCache }),
  )
  const actual = await sha256Hex(bytes)
  if (actual !== expected) {
    await dropCached(url)
    throw new Error(
      `${label}: downloaded file failed its SHA-256 check (got ${actual.slice(0, 12)}…, expected ${expected.slice(0, 12)}…)`,
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
  if (input.kind === 'square') return { width: input.width, height: input.height }
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

function valueRange(values: Float32Array): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return [min, max]
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const sigmoid = (v: number) => 1 / (1 + Math.exp(-v))

/**
 * Model output → alpha 0..1: logits go through a sigmoid, a matte is clamped,
 * and `minMax` stretches the output to the full range (U-2-Net).
 */
export function normalizeModelAlpha(values: ArrayLike<number>, minMax = false): Float32Array {
  const out = Float32Array.from(values)
  const [min, max] = valueRange(out)
  const map =
    minMax && max > min
      ? (v: number) => (v - min) / (max - min)
      : min < -0.01 || max > 1.01
        ? sigmoid
        : clamp01
  for (let i = 0; i < out.length; i++) out[i] = map(out[i]!)
  return out
}

/** A finished run's first output as alpha at its own size. */
function outputAlpha(
  output: { data: unknown; type: string; dims: readonly number[]; dispose?: () => void },
  minMax: boolean,
): { alpha: Float32Array; width: number; height: number } {
  const data = output.data as ArrayLike<number>
  const values =
    output.type === 'float16' && data instanceof Uint16Array ? Array.from(data, fromHalf) : data
  const alpha = normalizeModelAlpha(values, minMax)
  const { dims } = output
  output.dispose?.()
  return { alpha, width: Number(dims[dims.length - 1]), height: Number(dims[dims.length - 2]) }
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
    this.ort = await getOrt()
    const gpu = typeof navigator !== 'undefined' ? (navigator as { gpu?: GPU }).gpu : undefined
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
    if (adapter) {
      try {
        await this.createSession('webgpu', onProgress)
        return
      } catch {
        // The WebGPU EP can't take this graph here; wasm can.
      }
    }
    await this.createSession('wasm', onProgress)
  }

  private async createSession(
    backend: CutoutBackend,
    onProgress?: (progress: CutoutDownloadProgress) => void,
  ): Promise<void> {
    const ort = this.ort!
    const bytes = await fetchVerifiedBytes(
      this.urlFor(this.model, backend),
      this.model.files[backend].sha256,
      this.model.label,
      onProgress,
    )
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), {
      executionProviders: [backend],
      graphOptimizationLevel: 'all',
    })
    const name = session.inputNames[0]!
    const meta = (session as unknown as { inputMetadata?: Array<{ name: string; type?: string }> })
      .inputMetadata
    await this.session?.release?.()
    this.session = session
    this.backend = backend
    this.half = meta?.find((m) => m.name === name)?.type === 'float16'
  }

  /** Alpha (row-major, 0..1, at the model's output size) of one frame given as model-sized RGBA. */
  async run(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<{ alpha: Float32Array; width: number; height: number }> {
    const ort = this.ort
    if (!ort || !this.session) throw new Error('CutoutModelRunner.ready() must resolve first')
    const planes = rgbaToModelInput(this.model, rgba, width, height)
    const tensor = this.half
      ? new ort.Tensor('float16', Uint16Array.from(planes, toHalf), [1, 3, height, width])
      : new ort.Tensor('float32', planes, [1, 3, height, width])
    let result: Awaited<ReturnType<OrtSession['run']>>
    try {
      result = await this.session.run({ [this.session.inputNames[0]!]: tensor })
    } catch (error) {
      // A graph WebGPU accepted at load can still fail at run time (shader
      // limits); finish the job on wasm rather than failing it.
      if (this.backend !== 'webgpu') throw error
      await this.createSession('wasm')
      return this.run(rgba, width, height)
    }
    const output = result[this.session.outputNames[0]!]!
    const input = this.model.input
    return outputAlpha(output, input.kind === 'square' && input.minMax === true)
  }
}
