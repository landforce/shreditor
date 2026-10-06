import type { CSSProperties } from 'react'

/**
 * Style for a media box that takes the media's shape (`aspect` = width / height):
 * its container's full width, but no taller than `maxHeightPx`. A tall (9:16)
 * box narrows and, with `mx-auto`, centres instead of growing or cropping.
 */
export function cappedAspectBoxStyle(aspect: number, maxHeightPx: number): CSSProperties {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  return {
    aspectRatio: String(safeAspect),
    width: '100%',
    maxWidth: `${Math.round(maxHeightPx * safeAspect)}px`,
  }
}
