import type { TimelineItem } from '@/types/timeline'

export interface TimelineCanvasClipRect {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

interface TimelineCanvasClipPalette {
  fill: string
  stroke: string
  labelFill: string
  text: string
}

const LABEL_ROW_HEIGHT = 18
const LABEL_HORIZONTAL_PADDING = 5

// Cut30 Paper: mid-tone family inks matching the DOM clip colours in timeline/theme.css.
const DEFAULT_PALETTE: TimelineCanvasClipPalette = {
  fill: 'rgba(135, 147, 168, 0.95)',
  stroke: 'rgba(104, 116, 138, 0.8)',
  labelFill: 'rgba(1, 15, 42, 0.22)',
  text: 'rgba(255, 255, 255, 0.95)',
}

const PALETTE_BY_TYPE: Partial<Record<TimelineItem['type'], TimelineCanvasClipPalette>> = {
  video: {
    fill: 'rgba(28, 84, 141, 0.96)',
    stroke: 'rgba(18, 62, 108, 0.85)',
    labelFill: 'rgba(1, 15, 42, 0.22)',
    text: 'rgba(255, 255, 255, 0.96)',
  },
  audio: {
    fill: 'rgba(30, 104, 54, 0.96)',
    stroke: 'rgba(20, 78, 40, 0.85)',
    labelFill: 'rgba(1, 15, 42, 0.22)',
    text: 'rgba(255, 255, 255, 0.96)',
  },
  image: {
    fill: 'rgba(82, 131, 178, 0.94)',
    stroke: 'rgba(60, 104, 148, 0.85)',
    labelFill: 'rgba(1, 15, 42, 0.22)',
    text: 'rgba(255, 255, 255, 0.96)',
  },
  text: {
    fill: 'rgba(216, 86, 0, 0.94)',
    stroke: 'rgba(176, 68, 0, 0.85)',
    labelFill: 'rgba(1, 15, 42, 0.22)',
    text: 'rgba(255, 255, 255, 0.96)',
  },
  shape: {
    fill: 'rgba(184, 69, 127, 0.92)',
    stroke: 'rgba(150, 52, 102, 0.85)',
    labelFill: 'rgba(1, 15, 42, 0.22)',
    text: 'rgba(255, 255, 255, 0.96)',
  },
  adjustment: {
    fill: 'rgba(140, 92, 200, 0.9)',
    stroke: 'rgba(108, 66, 168, 0.85)',
    labelFill: 'rgba(1, 15, 42, 0.22)',
    text: 'rgba(255, 255, 255, 0.96)',
  },
  composition: {
    fill: 'rgba(98, 70, 190, 0.92)',
    stroke: 'rgba(72, 48, 156, 0.85)',
    labelFill: 'rgba(1, 15, 42, 0.22)',
    text: 'rgba(255, 255, 255, 0.96)',
  },
}

export function getTimelineCanvasClipPalette(itemType: TimelineItem['type']) {
  return PALETTE_BY_TYPE[itemType] ?? DEFAULT_PALETTE
}

export function getTimelineCanvasClipRect({
  item,
  fps,
  pixelsPerSecond,
  scrollLeft,
  trackHeight,
}: {
  item: Pick<TimelineItem, 'from' | 'durationInFrames'>
  fps: number
  pixelsPerSecond: number
  scrollLeft: number
  trackHeight: number
}): TimelineCanvasClipRect {
  const pxPerFrame = fps > 0 ? pixelsPerSecond / fps : 0
  const left = item.from * pxPerFrame - scrollLeft
  const width = Math.max(1, item.durationInFrames * pxPerFrame)
  const top = 1
  const height = Math.max(1, trackHeight - 2)
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

export function isTimelineCanvasClipVisible(
  rect: TimelineCanvasClipRect,
  viewportWidth: number,
): boolean {
  return rect.right >= 0 && rect.left <= viewportWidth
}

function drawTimelineCanvasClip({
  context,
  item,
  rect,
  viewportWidth,
}: {
  context: CanvasRenderingContext2D
  item: TimelineItem
  rect: TimelineCanvasClipRect
  viewportWidth: number
}): boolean {
  const left = Math.max(-1, rect.left)
  const right = Math.min(viewportWidth + 1, rect.right)
  const visibleWidth = Math.max(0, right - left)
  if (visibleWidth <= 0) return false

  const palette = getTimelineCanvasClipPalette(item.type)
  context.fillStyle = palette.fill
  context.fillRect(left, rect.top, visibleWidth, rect.height)
  context.strokeStyle = palette.stroke
  context.lineWidth = 1
  context.strokeRect(left + 0.5, rect.top + 0.5, Math.max(0, visibleWidth - 1), rect.height - 1)

  if (visibleWidth >= 20) {
    const labelHeight = Math.min(LABEL_ROW_HEIGHT, rect.height)
    context.fillStyle = palette.labelFill
    context.fillRect(left + 1, rect.top + 1, Math.max(0, visibleWidth - 2), labelHeight)

    if (visibleWidth >= 32) {
      context.save()
      context.beginPath()
      context.rect(
        left + LABEL_HORIZONTAL_PADDING,
        rect.top,
        Math.max(0, visibleWidth - LABEL_HORIZONTAL_PADDING * 2),
        labelHeight,
      )
      context.clip()
      context.fillStyle = palette.text
      context.fillText(
        item.label,
        left + LABEL_HORIZONTAL_PADDING,
        rect.top + labelHeight / 2 + 0.5,
      )
      context.restore()
    }
  }

  return true
}

export function drawInactiveTimelineCanvasItems({
  context,
  items,
  promotedItemIds,
  fps,
  pixelsPerSecond,
  scrollLeft,
  trackHeight,
  viewportWidth,
}: {
  context: CanvasRenderingContext2D
  items: ReadonlyArray<TimelineItem>
  promotedItemIds: ReadonlySet<string>
  fps: number
  pixelsPerSecond: number
  scrollLeft: number
  trackHeight: number
  viewportWidth: number
}): number {
  let renderedItemCount = 0
  for (const item of items) {
    if (promotedItemIds.has(item.id)) continue

    const rect = getTimelineCanvasClipRect({
      item,
      fps,
      pixelsPerSecond,
      scrollLeft,
      trackHeight,
    })
    if (!isTimelineCanvasClipVisible(rect, viewportWidth)) continue
    if (drawTimelineCanvasClip({ context, item, rect, viewportWidth })) {
      renderedItemCount += 1
    }
  }
  return renderedItemCount
}
