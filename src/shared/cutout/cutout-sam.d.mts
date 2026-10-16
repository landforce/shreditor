// Types for ./cutout-sam.mjs (the smart brush's SlimSAM model and its maths).
export type SamPart = 'encoder' | 'decoder'
export type SamBackend = 'webgpu' | 'wasm'

export interface SamModelFile {
  path: string
  bytes: number
  sha256: string
}

interface Size {
  width: number
  height: number
}

export const SAM_INPUT_EDGE: number
export const SAM_MAX_POINTS: number
export const SAM_MIN_TRACK_IOU: number
export const CUTOUT_SAM_MODEL: {
  id: 'slimsam'
  label: string
  license: string
  repo: string
  revision: string
  files: {
    encoder: Record<SamBackend, SamModelFile>
    decoder: { wasm: SamModelFile }
  }
}

export function samModelFile(part: SamPart, backend: SamBackend): SamModelFile
export function samModelUrl(part: SamPart, backend: SamBackend): string
export function samModelFileName(part: SamPart, backend: SamBackend): string

export function samResizedSize(width: number, height: number): Size
export function samPixelValues(rgba: ArrayLike<number>, width: number, height: number): Float32Array
export function samPromptCoords(
  points: ReadonlyArray<readonly [number, number]>,
  resized: Size,
): Float32Array
export function samMaskSize(resized: Size): Size
export function samCandidate(logits: ArrayLike<number>, index: number, size: Size): Float32Array
export function maskIoU(a: ArrayLike<number>, b: ArrayLike<number>): number
export function pickSamCandidate(
  candidates: ReadonlyArray<ArrayLike<number>>,
  scores: ArrayLike<number>,
  reference: ArrayLike<number> | null,
): { index: number; iou: number }
export function interiorPoints(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  max?: number,
): Array<[number, number]>
export function regionStats(
  mask: ArrayLike<number>,
  width: number,
  height: number,
): number[] | null
