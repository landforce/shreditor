// Types for ./cutout-strokes.mjs (shared by the editor, the headless harness and the agent tools).
import type { CutoutSettings, CutoutStroke } from '../../types/cutout'
import type { CutoutRegionEntry, IndexRange } from './cutout-core.mjs'

export const CUTOUT_MAX_STROKES: number

export function isSmartStroke(stroke: CutoutStroke | null | undefined): boolean
export function isEraseStroke(stroke: CutoutStroke | null | undefined): boolean
export function fnv1a(text: string): string
export function cutoutStrokesProblem(strokes: unknown): string | null
export function cutoutStrokeHash(stroke: CutoutStroke): string
export function simplifyStroke(
  points: ReadonlyArray<readonly [number, number]>,
  minStep: number,
  max?: number,
): Array<[number, number]>
export function strokePromptPoints(
  points: ReadonlyArray<readonly [number, number]>,
  max?: number,
): Array<[number, number]>
export function strokeRaster(stroke: CutoutStroke, width: number, height: number): Float32Array
export function regionTrackRange(
  stroke: CutoutStroke,
  rate: number,
  need: IndexRange | null | undefined,
  maxIndex?: number,
): { start: number; first: number; last: number }
export function regionCovers(
  entry: Pick<CutoutRegionEntry, 'covered'> | null | undefined,
  first: number,
  last: number,
): boolean
export function strokeFollowOffset(
  stroke: CutoutStroke,
  regions: ReadonlyArray<Pick<CutoutRegionEntry, 'stats' | 'rate'>>,
  seconds: number,
): [number, number]
export function withCutoutStroke(
  current: CutoutSettings | undefined,
  stroke: CutoutStroke,
): CutoutSettings
export function withoutCutoutStrokes(current: CutoutSettings | undefined): CutoutSettings | undefined

export interface TrackedRegion {
  index: number
  mask: Float32Array
  width: number
  height: number
  /** Overlap with the previous region (the painted area on the stroke's own frame). */
  iou: number
  stats: number[] | null
}

export function trackRegion(input: {
  stroke: CutoutStroke
  start: number
  first: number
  last: number
  segment: (
    index: number,
    points: Array<[number, number]>,
  ) => Promise<{ candidates: Float32Array[]; scores: number[]; width: number; height: number } | null>
  minIoU?: number
}): AsyncGenerator<TrackedRegion, void, unknown>
