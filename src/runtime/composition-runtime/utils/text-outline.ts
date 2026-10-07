import type { TextStroke } from '@/types/text'

/** Shadows per unit of ring circumference: close enough that no gap shows between them. */
const RING_SPACING_PX = 1.2
const MIN_RING_SHADOWS = 12
const MAX_RING_SHADOWS = 96

/**
 * How the preview draws a text outline. Chrome's CSS text stroke
 * (-webkit-text-stroke) always uses sharp mitre corners on HTML text, so W, M,
 * A and V grow spikes, while the export strokes with round corners. A round
 * (default) or bevel outline is drawn instead as a ring of crisp text shadows
 * at the outline width, which matches the export; only an explicit 'miter'
 * outline keeps the CSS stroke (painted under the fill).
 */
export function textOutlineCss(
  stroke: TextStroke | undefined,
  scale: number,
): { ring?: string; webkitStrokeWidth?: string } {
  if (!stroke?.width || stroke.width <= 0) return {}
  const radius = stroke.width * scale
  if (stroke.join === 'miter') return { webkitStrokeWidth: `${radius * 2}px` }
  const count = Math.min(
    MAX_RING_SHADOWS,
    Math.max(MIN_RING_SHADOWS, Math.ceil((2 * Math.PI * radius) / RING_SPACING_PX)),
  )
  const shadows: string[] = []
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count
    shadows.push(
      `${(Math.cos(angle) * radius).toFixed(2)}px ${(Math.sin(angle) * radius).toFixed(2)}px 0 ${stroke.color}`,
    )
  }
  return { ring: shadows.join(', ') }
}
