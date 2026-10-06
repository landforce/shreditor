/**
 * Scene thumbnails take the shape of their media (a 9:16 clip gets a tall,
 * narrow thumbnail) instead of a 16:9 crop. Same clamp as the media cards, so a
 * panorama or a sliver still makes a usable tile.
 */
const MIN_SCENE_THUMB_ASPECT = 9 / 21
const MAX_SCENE_THUMB_ASPECT = 21 / 9
const DEFAULT_SCENE_THUMB_ASPECT = 16 / 9

/** Width over height of a scene thumbnail for media `width` x `height`. */
export function getSceneThumbAspect(
  width: number | null | undefined,
  height: number | null | undefined,
): number {
  const ratio = Number(width) / Number(height)
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_SCENE_THUMB_ASPECT
  return Math.min(MAX_SCENE_THUMB_ASPECT, Math.max(MIN_SCENE_THUMB_ASPECT, aspect))
}

/** The largest box of `aspect` inside `maxWidth` x `maxHeight`, in whole pixels. */
export function fitSceneThumb(
  aspect: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const width = Math.min(maxWidth, maxHeight * aspect)
  return { width: Math.round(width), height: Math.round(width / aspect) }
}
