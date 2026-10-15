// Types for ./cutout-core.mjs (shared by the editor, the headless harness and the agent tools).
import type { CutoutSettings, CutoutSubject } from '../../types/cutout'

export type CutoutBackend = 'webgpu' | 'wasm'
export type CutoutModelId = 'modnet' | 'birefnet-lite'

export interface CutoutModelFile {
  path: string
  bytes: number
  sha256: string
}

export interface CutoutModel {
  id: CutoutModelId
  subject: 'person' | 'object'
  label: string
  license: string
  repo: string
  revision: string
  input:
    | {
        kind: 'modnet'
        shortEdge: number
        multiple: number
        mean: [number, number, number]
        std: [number, number, number]
      }
    | {
        kind: 'birefnet'
        width: number
        height: number
        mean: [number, number, number]
        std: [number, number, number]
      }
  files: Record<CutoutBackend, CutoutModelFile>
}

/** Inclusive sample index range [first, last]. */
export type IndexRange = [number, number]

export interface CutoutIndexEntry {
  key: string
  fingerprint: string
  model: CutoutModelId
  subject: 'person' | 'object'
  rate: number
  maskWidth: number
  maskHeight: number
  sourceWidth: number
  sourceHeight: number
  done: IndexRange[]
  updatedAt: number
}

export interface CutoutIndex {
  version: number
  entries: Record<string, CutoutIndexEntry>
  /** Per media fingerprint: what subject 'auto' resolved to. */
  auto: Record<string, 'person' | 'object'>
}

export const CUTOUT_MASK_LONG_EDGE: number
export const CUTOUT_BLANK_COVERAGE: number
export const CUTOUT_MODELS: Record<CutoutModelId, CutoutModel>
export const CUTOUT_INDEX_FILE: string

export function cutoutModelFor(subject: CutoutSubject | 'person' | 'object'): CutoutModel
export function cutoutModelUrl(model: CutoutModel, backend: CutoutBackend): string
export function cutoutModelFileName(model: CutoutModel, backend: CutoutBackend): string

export function cutoutSettingsProblem(value: unknown): string | null
export function mergeCutoutSettings(
  current: CutoutSettings | undefined,
  patch: Partial<CutoutSettings>,
): CutoutSettings
export function isCutoutActive(item: unknown): boolean
export function resolveCutoutRate(sampleRate: CutoutSettings['sampleRate'], sourceFps: number): number

export function itemSourceRange(
  item: unknown,
  projectFps: number,
): { start: number; end: number } | null
export function mergeIndexRanges(ranges: readonly IndexRange[]): IndexRange[]
export function subtractIndexRanges(
  need: readonly IndexRange[],
  have: readonly IndexRange[],
): IndexRange[]
export function hasIndex(ranges: readonly IndexRange[], index: number): boolean
export function sampleRangeFor(
  range: { start: number; end: number },
  rate: number,
  maxIndex?: number,
): IndexRange | null
export function maxSampleIndex(durationSeconds: number, rate: number): number
export function interpolationFor(
  seconds: number,
  rate: number,
  has: (index: number) => boolean,
): { a: number; b: number; t: number } | null

export function mediaFingerprint(
  meta:
    | {
        fileSize?: number
        fileLastModified?: number
        width?: number
        height?: number
        duration?: number
      }
    | null
    | undefined,
): string
export function cutoutAnalysisKey(input: { fingerprint: string; model: string; rate: number }): string
export function cutoutDirSegments(mediaId: string): string[]
export function cutoutSamplePath(key: string, index: number): string
export function emptyCutoutIndex(): CutoutIndex
export function parseCutoutIndex(value: unknown): CutoutIndex
export function mergeCutoutIndex(disk: unknown, mine: unknown): CutoutIndex
export function findCutoutEntry(
  index: CutoutIndex | null | undefined,
  input: { fingerprint: string; subject: CutoutSubject; rate: number },
): { key: string | null; entry: CutoutIndexEntry | null; subject: 'person' | 'object' | null }
export function cutoutCoverage(
  need: readonly IndexRange[],
  entry: CutoutIndexEntry | null | undefined,
): { needed: number; done: number; missing: IndexRange[] }
