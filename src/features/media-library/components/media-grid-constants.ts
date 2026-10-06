/**
 * Maps itemSize (1=smallest, 5=largest) to a minimum card width in pixels.
 * CSS grid auto-fill with minmax() keeps card size stable — the column count
 * adjusts when the sidebar resizes instead of cards stretching/shrinking.
 */
export const GRID_MIN_SIZE_PX: Record<number, number> = {
  1: 80,
  2: 110,
  3: 140,
  4: 200,
  5: 280,
}

/** Maps itemSize to gap class */
export const GRID_GAP_BY_SIZE: Record<number, string> = {
  1: 'gap-1',
  2: 'gap-1.5',
  3: 'gap-2',
  4: 'gap-3',
  5: 'gap-3',
}

/**
 * Maps itemSize to the target row height of the media grid. Media cards flow
 * as justified rows: each card keeps its source aspect ratio (9:16, 16:9, …)
 * and every card in a row shares one height.
 */
export const GRID_ROW_HEIGHT_PX: Record<number, number> = {
  1: 96,
  2: 124,
  3: 156,
  4: 210,
  5: 280,
}

const MIN_CARD_ASPECT = 9 / 21
const MAX_CARD_ASPECT = 21 / 9

/** Display aspect ratio (width / height) for a media card's thumbnail. */
export function getMediaCardAspect(media: { width: number; height: number }): number {
  // Audio has no frame size: keep it a compact square tile.
  if (!(media.width > 0) || !(media.height > 0)) return 1
  return Math.min(MAX_CARD_ASPECT, Math.max(MIN_CARD_ASPECT, media.width / media.height))
}
