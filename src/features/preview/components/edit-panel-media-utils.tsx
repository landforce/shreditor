import { createContext, type ReactNode } from 'react'
import type { TimelineItem } from '@/types/timeline'

const LANDSCAPE_ASPECT = 16 / 9

/**
 * The canvas aspect (width / height) of the project the edit overlays preview.
 * Panels for gaps, or items without a known source size, take this shape, so a
 * 9:16 project's empty panel is 9:16 rather than 16:9.
 */
export const EditPanelCanvasAspectContext = createContext<number>(LANDSCAPE_ASPECT)

/** Width over height for a canvas size, or `fallback` when it is unusable. */
export function canvasAspectRatio(width: number, height: number, fallback = LANDSCAPE_ASPECT) {
  const ratio = width / height
  return Number.isFinite(ratio) && ratio > 0 ? ratio : fallback
}

export function getItemAspectRatio(
  item: TimelineItem | null,
  fallbackAspectRatio: number = LANDSCAPE_ASPECT,
): number {
  if (
    item &&
    (item.type === 'video' || item.type === 'image') &&
    item.sourceWidth &&
    item.sourceHeight
  ) {
    return item.sourceWidth / item.sourceHeight
  }
  if (item?.type === 'composition' && item.compositionWidth && item.compositionHeight) {
    return item.compositionWidth / item.compositionHeight
  }
  return fallbackAspectRatio
}

/**
 * Size of a corner thumbnail in the 4-up view: the item's own shape, with its
 * long edge `maxEdge` px (a 16:9 item keeps its old size; a 9:16 one is as tall
 * as that is wide, instead of being squeezed into a 16:9 box).
 */
export function computeCornerThumbnailSize(
  maxEdge: number,
  aspectRatio: number,
): { width: number; height: number } {
  const edge = Math.max(maxEdge, 1)
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : LANDSCAPE_ASPECT
  return ratio >= 1
    ? { width: edge, height: Math.max(edge / ratio, 1) }
    : { width: Math.max(edge * ratio, 1), height: edge }
}

export function computeFittedMediaSize(
  panelWidth: number,
  areaHeight: number,
  aspectRatio: number,
): {
  mediaWidth: number
  mediaHeight: number
} {
  let mediaWidth = panelWidth
  let mediaHeight = panelWidth / aspectRatio
  if (mediaHeight > areaHeight) {
    mediaHeight = areaHeight
    mediaWidth = areaHeight * aspectRatio
  }

  return {
    mediaWidth: Math.max(mediaWidth, 1),
    mediaHeight: Math.max(mediaHeight, 1),
  }
}

export interface PanelMediaRenderers {
  renderVideo: (item: TimelineItem, sourceTime: number) => ReactNode
  renderImage: (item: TimelineItem) => ReactNode
  renderComposition: (item: TimelineItem, sourceFrame: number) => ReactNode
  renderPlaceholder: (type: string, text: string) => ReactNode
}

export function renderPanelMedia(
  item: TimelineItem | null,
  sourceTime: number | undefined,
  placeholderText: string | undefined,
  renderers: PanelMediaRenderers,
  sourceFrame?: number,
): ReactNode {
  if (!item) {
    return renderers.renderPlaceholder('gap', placeholderText ?? 'GAP')
  }

  if (item.type === 'video') {
    return renderers.renderVideo(item, sourceTime ?? 0)
  }

  if (item.type === 'image') {
    return renderers.renderImage(item)
  }

  if (item.type === 'composition') {
    const fallbackSourceFrame = Math.max(
      0,
      Math.round((sourceTime ?? 0) * Math.max(1, item.sourceFps ?? 30)),
    )
    return renderers.renderComposition(item, sourceFrame ?? fallbackSourceFrame)
  }

  return renderers.renderPlaceholder(item.type, placeholderText ?? item.type)
}
