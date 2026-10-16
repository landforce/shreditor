/**
 * Maps points between the canvas (project pixels, where the preview shows a
 * clip) and the clip's source frame (fractions 0..1), through the clip's
 * transform (position, size, rotation about its anchor, flips) and its
 * contain-fit and crop, the same geometry the renderer draws with
 * (calculateMediaCropLayout). Brush strokes are painted on the preview and
 * stored in source fractions, so they stay on the subject when the clip is
 * moved, resized, rotated or cropped.
 */
import type { CropSettings } from '@/types/transform'
import { calculateMediaCropLayout } from '@/shared/utils/media-crop'

export interface StrokeMapFrame {
  canvas: { width: number; height: number }
  transform: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
    anchorX?: number
    anchorY?: number
  }
  flipHorizontal?: boolean
  flipVertical?: boolean
  sourceWidth: number
  sourceHeight: number
  crop?: CropSettings
}

interface Geometry {
  left: number
  top: number
  centre: { x: number; y: number }
  radians: number
  flip: { x: number; y: number }
  media: { x: number; y: number; width: number; height: number }
  viewport: { x: number; y: number; width: number; height: number }
}

function geometry(frame: StrokeMapFrame): Geometry {
  const t = frame.transform
  const left = frame.canvas.width / 2 + t.x - t.width / 2
  const top = frame.canvas.height / 2 + t.y - t.height / 2
  const layout = calculateMediaCropLayout(
    frame.sourceWidth,
    frame.sourceHeight,
    t.width,
    t.height,
    frame.crop,
  )
  return {
    left,
    top,
    centre: { x: left + (t.anchorX ?? t.width / 2), y: top + (t.anchorY ?? t.height / 2) },
    radians: (t.rotation * Math.PI) / 180,
    flip: { x: frame.flipHorizontal ? -1 : 1, y: frame.flipVertical ? -1 : 1 },
    media: layout.mediaRect,
    viewport: layout.viewportRect,
  }
}

/** Rotate then flip about the centre (the renderer's order), or the inverse. */
function aboutCentre(g: Geometry, x: number, y: number, inverse: boolean) {
  let dx = x - g.centre.x
  let dy = y - g.centre.y
  const cos = Math.cos(inverse ? -g.radians : g.radians)
  const sin = Math.sin(inverse ? -g.radians : g.radians)
  if (inverse) {
    const rx = dx * cos - dy * sin
    const ry = dx * sin + dy * cos
    return { x: g.centre.x + rx * g.flip.x, y: g.centre.y + ry * g.flip.y }
  }
  dx *= g.flip.x
  dy *= g.flip.y
  return { x: g.centre.x + dx * cos - dy * sin, y: g.centre.y + dx * sin + dy * cos }
}

/**
 * A canvas point as source-frame fractions [x, y], or null when it falls
 * outside the clip's visible (cropped) picture.
 */
export function canvasToSourcePoint(
  point: { x: number; y: number },
  frame: StrokeMapFrame,
): [number, number] | null {
  const g = geometry(frame)
  const local = aboutCentre(g, point.x, point.y, true)
  const lx = local.x - g.left
  const ly = local.y - g.top
  const v = g.viewport
  if (lx < v.x || ly < v.y || lx > v.x + v.width || ly > v.y + v.height) return null
  if (g.media.width <= 0 || g.media.height <= 0) return null
  return [(lx - g.media.x) / g.media.width, (ly - g.media.y) / g.media.height]
}

/** Source-frame fractions as a canvas point (to draw strokes over the preview). */
export function sourceToCanvasPoint(
  [fx, fy]: readonly [number, number],
  frame: StrokeMapFrame,
): { x: number; y: number } {
  const g = geometry(frame)
  const x = g.left + g.media.x + fx * g.media.width
  const y = g.top + g.media.y + fy * g.media.height
  return aboutCentre(g, x, y, false)
}

/** Canvas pixels per source-frame short side: converts a brush radius for drawing. */
export function sourceShortSideOnCanvas(frame: StrokeMapFrame): number {
  const g = geometry(frame)
  const scale = g.media.width / Math.max(1, frame.sourceWidth)
  return Math.min(frame.sourceWidth, frame.sourceHeight) * scale
}
