import type { CSSProperties } from 'react'

/** Maps itemSize to gap class */
const GRID_GAP_BY_SIZE: Record<number, string> = {
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
const GRID_ROW_HEIGHT_PX: Record<number, number> = {
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

/**
 * Justified rows: a grid cell grows in proportion to its card's aspect, so every
 * card in a row lands on the same height while keeping its own shape.
 */
export function getJustifiedCardCellStyle(aspect: number, itemSize: number): CSSProperties {
  const rowHeight = GRID_ROW_HEIGHT_PX[itemSize] ?? GRID_ROW_HEIGHT_PX[3]!
  return {
    flex: `${aspect} 1 ${aspect * rowHeight}px`,
    minWidth: 0,
    // A row holding one wide card must not balloon to the panel width
    maxWidth: `${aspect * rowHeight * 1.4}px`,
  }
}

/** The wrapping row container for justified cards (pairs with getJustifiedCardCellStyle). */
export function getJustifiedRowsClass(itemSize: number): string {
  return `flex flex-wrap ${GRID_GAP_BY_SIZE[itemSize] ?? GRID_GAP_BY_SIZE[3]} after:content-[''] after:grow-[1000000]`
}
