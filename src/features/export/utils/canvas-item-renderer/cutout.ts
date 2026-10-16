/**
 * Background removal for video items (docs/background-removal.md).
 *
 * The clip's frame is first drawn whole, uncropped and untransformed, into a
 * source-sized scratch canvas through the regular video renderer (so every
 * frame source and fallback behaves exactly as for an uncut clip). The GPU then
 * multiplies the cutout mask into its alpha in source space, and the masked
 * frame is drawn with the clip's own crop and transform. Effects, masks,
 * keyframes and compositing all run afterwards as usual, on the cut-out pixels.
 */
import type { VideoItem } from '@/types/timeline'
import { isCutoutActive } from '@/shared/cutout/cutout-core.mjs'
import { sampleCutoutMasks } from '@/infrastructure/cutout/cutout-masks'
import { applyCutoutMask } from '@/infrastructure/cutout/cutout-compositor'
import { getCutoutPaint } from '@/infrastructure/cutout/cutout-paint'
import {
  getItemRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
  type RenderTimelineSpan,
} from '../render-span'
import type { ItemRenderContext, ItemTransform } from './types'
import { drawContainedMediaSource } from './media-draw'
import { renderVideoItem } from './video'

/** Preview draws the scratch frame at most this large (export uses the source size). */
const PREVIEW_MAX_EDGE = 1920
const EXPORT_MAX_EDGE = 4096

export function hasActiveCutout(item: { type: string; cutout?: unknown }): boolean {
  return isCutoutActive(item)
}

type Scratch = {
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
  colorType: string
}
// Renders of several cut-out clips may interleave (they await frame decodes), so
// each takes its own scratch canvas and hands it back.
const freeScratch: Scratch[] = []

/**
 * The colour type of a 2D canvas: 'float16' when it keeps more than 8 bits.
 * The scratch frame matches the destination, so the cutout never narrows it.
 */
function canvasColorType(ctx: OffscreenCanvasRenderingContext2D): string {
  const attributes = (
    ctx as { getContextAttributes?: () => { colorType?: string } }
  ).getContextAttributes?.()
  return attributes?.colorType ?? 'unorm8'
}

function acquireScratch(width: number, height: number, colorType: string): Scratch | null {
  const index = freeScratch.findIndex((entry) => entry.colorType === colorType)
  let entry = index >= 0 ? freeScratch.splice(index, 1)[0]! : null
  if (!entry) {
    const canvas = new OffscreenCanvas(width, height)
    const settings = colorType === 'float16' ? { colorType } : undefined
    const ctx = canvas.getContext('2d', settings) as OffscreenCanvasRenderingContext2D | null
    if (!ctx) return null
    entry = { canvas, ctx, colorType }
  }
  if (entry.canvas.width !== width || entry.canvas.height !== height) {
    entry.canvas.width = width
    entry.canvas.height = height
  }
  entry.ctx.setTransform(1, 0, 0, 1, 0, 0)
  entry.ctx.globalAlpha = 1
  entry.ctx.globalCompositeOperation = 'source-over'
  entry.ctx.imageSmoothingEnabled = true
  entry.ctx.imageSmoothingQuality = 'high'
  entry.ctx.clearRect(0, 0, width, height)
  return entry
}

function releaseScratch(entry: Scratch): void {
  if (freeScratch.length < 4) freeScratch.push(entry)
}

function scratchSize(sourceWidth: number, sourceHeight: number, preview: boolean) {
  const limit = preview ? PREVIEW_MAX_EDGE : EXPORT_MAX_EDGE
  const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

/**
 * Draw a video item with its background removed. Falls back to the plain frame
 * when no mask is stored near this time yet or WebGL2 is unavailable.
 */
export async function renderCutoutVideoItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset = 0,
  renderSpan?: RenderTimelineSpan,
): Promise<boolean> {
  const cutout = item.cutout
  const plain = () =>
    renderVideoItem(ctx, item, transform, frame, rctx, sourceFrameOffset, renderSpan)
  if (!cutout || !item.mediaId) return plain()

  const span = renderSpan ?? getItemRenderTimelineSpan(item)
  const sourceSeconds = resolveVideoRenderSourceTimeSeconds(
    item,
    span,
    frame,
    rctx.fps,
    sourceFrameOffset,
  )
  const masks = await sampleCutoutMasks(item.mediaId, cutout, sourceSeconds)
  if (!masks) return plain()

  const sourceWidth = item.sourceWidth ?? masks.entry.sourceWidth
  const sourceHeight = item.sourceHeight ?? masks.entry.sourceHeight
  if (!(sourceWidth > 0 && sourceHeight > 0)) return plain()
  const preview = rctx.renderMode === 'preview'
  const size = scratchSize(sourceWidth, sourceHeight, preview)
  const colorType = canvasColorType(ctx)
  const target = acquireScratch(size.width, size.height, colorType)
  if (!target) return plain()
  try {
    // The whole source frame, 1:1 into the scratch canvas.
    const drawn = await renderVideoItem(
      target.ctx,
      { ...item, crop: undefined },
      { ...transform, x: 0, y: 0, ...size, rotation: 0, opacity: 1, cornerRadius: 0 },
      frame,
      { ...rctx, canvasSettings: { ...size, fps: rctx.fps } },
      sourceFrameOffset,
      renderSpan,
    )
    if (!drawn) return false
    const masked =
      applyCutoutMask(target.canvas, size.width, size.height, masks.a, masks.b, {
        t: masks.t,
        settings: cutout,
        sourceWidth,
        sourceHeight,
        layers: masks.layers,
        highlight: preview && getCutoutPaint().itemId === item.id,
        destinationColorType: colorType,
      }) ?? target.canvas // no WebGL2: the frame uncut rather than nothing
    return drawContainedMediaSource(
      ctx,
      masked,
      sourceWidth,
      sourceHeight,
      transform,
      rctx.canvasSettings,
      item.crop,
      { x: 0, y: 0, width: size.width, height: size.height },
      rctx.canvasPool,
    )
  } finally {
    releaseScratch(target)
  }
}
