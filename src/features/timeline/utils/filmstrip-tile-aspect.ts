/**
 * Filmstrip tiles take the shape of the source they show: a 9:16 clip gets tall,
 * narrow tiles and a 16:9 clip wide ones, so no frame is cropped. Extreme shapes
 * are clamped so a panorama or a sliver still reads as a strip of frames.
 */
export const FILMSTRIP_TILE_MIN_ASPECT = 0.4
export const FILMSTRIP_TILE_MAX_ASPECT = 2.4
/** Used when a source has no usable size (yet). */
export const FILMSTRIP_DEFAULT_TILE_ASPECT = 16 / 9

/**
 * The narrowest spacing, as a multiple of the tile height, of the filmstrip's
 * first pass of frames. A 16:9 tile already spans this, so wide sources sample
 * once per tile as before; narrower tiles first share a frame with their
 * neighbours (as few decodes as a 16:9 strip), then get their own.
 */
const FILMSTRIP_MIN_SAMPLE_ASPECT = 16 / 9

/** Width over height of a filmstrip tile for a source `width` x `height` (display size). */
export function getFilmstripTileAspect(
  width: number | null | undefined,
  height: number | null | undefined,
  fallback: number = FILMSTRIP_DEFAULT_TILE_ASPECT,
): number {
  const ratio = Number(width) / Number(height)
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : fallback
  return Math.min(FILMSTRIP_TILE_MAX_ASPECT, Math.max(FILMSTRIP_TILE_MIN_ASPECT, aspect))
}

/** Whole-pixel tile width for a strip `height` px tall (0 when there is no height yet). */
export function getFilmstripTileWidth(height: number, aspect: number): number {
  if (!(height > 0)) return 0
  return Math.max(1, Math.round(height * aspect))
}

/**
 * Pixel spacing of the filmstrip's first pass of frames: one per tile, but
 * never closer than {@link FILMSTRIP_MIN_SAMPLE_ASPECT} tile heights.
 */
export function getFilmstripSampleWidth(tileWidth: number, height: number): number {
  const minimum = height > 0 ? Math.round(height * FILMSTRIP_MIN_SAMPLE_ASPECT) : 0
  return Math.max(1, tileWidth, minimum)
}
