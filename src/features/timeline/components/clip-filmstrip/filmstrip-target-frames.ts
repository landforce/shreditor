import type { FilmstripRenderWindow } from './render-window'
import type { SourceSecondsAt } from '../../utils/speed-ramp-source-time'

export interface FilmstripTargetFrameOptions {
  /** Clip-local pixel range the filmstrip draws (the padded render window). */
  startPx: number
  endPx: number
  /** Pixel spacing between sampled frames (a tile width, or wider). */
  sampleWidth: number
  pixelsPerSourceSecond: number
  effectiveStart: number
  effectiveEnd: number
  isReversed: boolean
  /** Frames the 1fps filmstrip has for the source (its length in whole seconds). */
  totalFrameCount: number
  /**
   * A speed-ramped clip's time map, with the timeline's pixels per second it
   * reads pixels through; replaces `pixelsPerSourceSecond` when set.
   */
  sourceSecondsAt?: SourceSecondsAt
  pixelsPerSecond?: number
}

/**
 * The 1fps frame indices to extract for a range of the filmstrip: one per
 * `sampleWidth` slot, at the source time under the slot's centre.
 */
export function computeFilmstripTargetFrameIndices({
  startPx,
  endPx,
  sampleWidth,
  pixelsPerSourceSecond,
  effectiveStart,
  effectiveEnd,
  isReversed,
  totalFrameCount,
  sourceSecondsAt,
  pixelsPerSecond,
}: FilmstripTargetFrameOptions): number[] {
  if (!(sampleWidth > 0) || !(pixelsPerSourceSecond > 0) || endPx <= startPx) return []
  const rampPixelsPerSecond =
    sourceSecondsAt && pixelsPerSecond && pixelsPerSecond > 0 ? pixelsPerSecond : null
  const lastIndex = Math.max(0, totalFrameCount - 1)
  const indices = new Set<number>()
  const endSlot = Math.ceil(endPx / sampleWidth)
  for (let slot = Math.floor(startPx / sampleWidth); slot < endSlot; slot++) {
    const centerX = slot * sampleWidth + sampleWidth * 0.5
    const sourceOffset =
      sourceSecondsAt && rampPixelsPerSecond !== null
        ? sourceSecondsAt(centerX / rampPixelsPerSecond)
        : centerX / pixelsPerSourceSecond
    const time = isReversed ? effectiveEnd - sourceOffset : effectiveStart + sourceOffset
    indices.add(Math.max(0, Math.min(lastIndex, Math.floor(time))))
  }
  return Array.from(indices).sort((a, b) => a - b)
}

/** True when every index in `wanted` is among the loaded frames. */
export function hasFilmstripFrames(
  wanted: readonly number[],
  frames: ReadonlyArray<{ index: number }> | null | undefined,
): boolean {
  if (wanted.length === 0) return true
  if (!frames || frames.length === 0) return false
  const loaded = new Set(frames.map((frame) => frame.index))
  return wanted.every((index) => loaded.has(index))
}

export interface FilmstripFrameTargetsInput {
  isVisible: boolean
  height: number
  pixelsPerSecond: number
  speed: number
  effectiveStart: number
  effectiveEnd: number
  sourceDuration: number
  isReversed: boolean
  renderWindow: FilmstripRenderWindow
  tileWidth: number
  /** Spacing of the first pass (at least a 16:9 tile; see getFilmstripSampleWidth). */
  sampleWidth: number
  /** A speed-ramped clip's time map; replaces the linear `speed` mapping when set. */
  sourceSecondsAt?: SourceSecondsAt
}

export interface FilmstripFrameTargets {
  /** First pass: one frame per `sampleWidth`, as many as a 16:9 strip asks for. */
  coarse: number[]
  /** Second pass: one frame per tile (the same list when tiles are 16:9 or wider). */
  perTile: number[]
}

/** The frames a visible filmstrip window needs, in two passes; null when nothing is drawn. */
export function computeFilmstripFrameTargets(
  input: FilmstripFrameTargetsInput,
): FilmstripFrameTargets | null {
  const { renderWindow, sampleWidth, tileWidth } = input
  if (!input.isVisible || input.height <= 0 || input.pixelsPerSecond <= 0) return null
  if (input.effectiveEnd <= input.effectiveStart || input.sourceDuration <= 0) return null
  if (renderWindow.endTile <= renderWindow.startTile) return null

  const options = {
    startPx: renderWindow.paddedStartX,
    endPx: renderWindow.paddedEndX,
    pixelsPerSourceSecond: input.pixelsPerSecond / Math.max(0.0001, input.speed),
    effectiveStart: input.effectiveStart,
    effectiveEnd: input.effectiveEnd,
    isReversed: input.isReversed,
    totalFrameCount: Math.max(1, Math.ceil(input.sourceDuration)),
    sourceSecondsAt: input.sourceSecondsAt,
    pixelsPerSecond: input.pixelsPerSecond,
  }
  const coarse = computeFilmstripTargetFrameIndices({ ...options, sampleWidth })
  const perTile =
    sampleWidth > tileWidth
      ? computeFilmstripTargetFrameIndices({ ...options, sampleWidth: tileWidth })
      : coarse
  return { coarse, perTile }
}

/** The pass to request now: per tile once the coarse frames are loaded. */
export function pickFilmstripTargetFrames(
  targets: FilmstripFrameTargets | null,
  coarseLoaded: boolean,
): number[] | undefined {
  const indices = coarseLoaded ? targets?.perTile : targets?.coarse
  return indices && indices.length > 0 ? indices : undefined
}

/** True when the first pass is loaded (false while there is nothing to load yet). */
export function isFilmstripCoarsePassLoaded(
  targets: FilmstripFrameTargets | null,
  frames: ReadonlyArray<{ index: number }> | null | undefined,
): boolean {
  return targets !== null && hasFilmstripFrames(targets.coarse, frames)
}
