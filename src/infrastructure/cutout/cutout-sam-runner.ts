/**
 * SlimSAM-77 on onnxruntime-web for the smart brush: the vision encoder once
 * per frame (WebGPU fp32 when the adapter takes it, else wasm int8) and the
 * prompt decoder per prompt (wasm int8, it is small). Encoder outputs are kept
 * in an LRU keyed by source and frame, so painting several strokes on one clip
 * re-encodes nothing it has seen recently. Weights come through the shared
 * ONNX model cache from pinned URLs and are SHA-256 checked.
 *
 * Worker-safe: no DOM access.
 */
import {
  CUTOUT_SAM_MODEL,
  samCandidate,
  samMaskSize,
  samModelFile,
  samModelUrl,
  samPixelValues,
  samPromptCoords,
  SAM_INPUT_EDGE,
  type SamBackend,
} from '@/shared/cutout/cutout-sam.mjs'
import { getOrt, type OrtModule, type OrtSession } from '@/shared/utils/ort-runtime'
import { fetchVerifiedBytes, type CutoutDownloadProgress } from './cutout-model'

export interface SamUrls {
  encoder: Record<SamBackend, string>
  decoder: string
}

/** The pinned upstream URLs (the headless harness passes its service's model cache instead). */
export function defaultSamUrls(): SamUrls {
  return {
    encoder: { webgpu: samModelUrl('encoder', 'webgpu'), wasm: samModelUrl('encoder', 'wasm') },
    decoder: samModelUrl('decoder', 'wasm'),
  }
}

type OrtTensor = InstanceType<OrtModule['Tensor']>

interface Embedding {
  embeddings: OrtTensor
  resized: { width: number; height: number }
}

export interface SamSegments {
  candidates: Float32Array[]
  scores: number[]
  width: number
  height: number
}

const LRU_SIZE = 16

export class SamRunner {
  private ort: OrtModule | null = null
  private encoder: OrtSession | null = null
  private decoder: OrtSession | null = null
  private positional: OrtTensor | null = null
  private loading: Promise<void> | null = null
  private readonly cache = new Map<string, Embedding>()
  backend: SamBackend = 'wasm'

  constructor(private readonly urls: SamUrls) {}

  ready(onProgress?: (progress: CutoutDownloadProgress) => void): Promise<void> {
    this.loading ??= this.load(onProgress).catch((error) => {
      this.loading = null
      throw error
    })
    return this.loading
  }

  private async load(onProgress?: (progress: CutoutDownloadProgress) => void): Promise<void> {
    this.ort = await getOrt()
    this.decoder = await this.session('decoder', 'wasm', onProgress)
    const gpu = typeof navigator !== 'undefined' ? (navigator as { gpu?: GPU }).gpu : undefined
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
    if (adapter) {
      try {
        this.encoder = await this.session('encoder', 'webgpu', onProgress)
        this.backend = 'webgpu'
        return
      } catch {
        // The WebGPU EP can't take the encoder here; wasm can.
      }
    }
    await this.useWasmEncoder(onProgress)
  }

  private async useWasmEncoder(onProgress?: (progress: CutoutDownloadProgress) => void) {
    await this.encoder?.release?.()
    this.encoder = await this.session('encoder', 'wasm', onProgress)
    this.backend = 'wasm'
  }

  private async session(
    part: 'encoder' | 'decoder',
    backend: SamBackend,
    onProgress?: (progress: CutoutDownloadProgress) => void,
  ): Promise<OrtSession> {
    const url = part === 'decoder' ? this.urls.decoder : this.urls.encoder[backend]
    const file = samModelFile(part, backend)
    const bytes = await fetchVerifiedBytes(url, file.sha256, CUTOUT_SAM_MODEL.label, onProgress)
    return this.ort!.InferenceSession.create(new Uint8Array(bytes), {
      executionProviders: [backend],
      graphOptimizationLevel: 'all',
    })
  }

  private async encode(rgba: Uint8ClampedArray, width: number, height: number) {
    const ort = this.ort!
    const pixels = new ort.Tensor('float32', samPixelValues(rgba, width, height), [
      1,
      3,
      SAM_INPUT_EDGE,
      SAM_INPUT_EDGE,
    ])
    try {
      return await this.encoder!.run({ pixel_values: pixels })
    } catch (error) {
      // A graph WebGPU accepted at load can still fail at run time; wasm finishes the job.
      if (this.backend !== 'webgpu') throw error
      await this.useWasmEncoder()
      return this.encoder!.run({ pixel_values: pixels })
    }
  }

  /** Encoder output for a frame drawn at samResizedSize (cached under `key`). */
  async embed(
    key: string,
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<Embedding> {
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const out = await this.encode(rgba, width, height)
    this.positional ??= out.image_positional_embeddings!
    const entry = { embeddings: out.image_embeddings!, resized: { width, height } }
    this.cache.set(key, entry)
    while (this.cache.size > LRU_SIZE) this.cache.delete(this.cache.keys().next().value!)
    return entry
  }

  /** The three candidate regions (cropped to the frame, 0..1) for positive points (frame fractions). */
  async segment(embedding: Embedding, points: Array<[number, number]>): Promise<SamSegments> {
    const ort = this.ort!
    const n = points.length
    const out = await this.decoder!.run({
      input_points: new ort.Tensor('float32', samPromptCoords(points, embedding.resized), [
        1,
        1,
        n,
        2,
      ]),
      input_labels: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, 1, n]),
      image_embeddings: embedding.embeddings,
      image_positional_embeddings: this.positional!,
    })
    const size = samMaskSize(embedding.resized)
    const logits = out.pred_masks!.data as Float32Array
    return {
      candidates: [0, 1, 2].map((index) => samCandidate(logits, index, size)),
      scores: Array.from(out.iou_scores!.data as Float32Array),
      ...size,
    }
  }
}
