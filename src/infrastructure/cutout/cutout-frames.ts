/**
 * Frame access and mask encoding shared by the cutout workers (the auto
 * analysis and the smart brush's region tracker): open a source with
 * mediabunny, scratch 2D contexts, and an alpha array → 8-bit PNG mask.
 *
 * Worker-safe: no DOM access.
 */
import { ensureProResDecoderRegistered } from '@/infrastructure/browser/register-prores-decoder'
import { applyBitstreamColorSpace } from '@/infrastructure/browser/mediabunny-video-color-space'

export interface CutoutSource {
  blob?: Blob
  url?: string
}

export async function openCutoutSource(source: CutoutSource) {
  await ensureProResDecoderRegistered().catch(() => {})
  const mb = await import('mediabunny')
  const input = new mb.Input({
    source: source.blob ? new mb.BlobSource(source.blob) : new mb.UrlSource(source.url ?? ''),
    formats: mb.ALL_FORMATS,
  })
  const track = await input.getPrimaryVideoTrack()
  if (!track) {
    input.dispose()
    throw new Error('The media has no video track')
  }
  return { input, sink: new mb.VideoSampleSink(applyBitstreamColorSpace(track)) }
}

export function context2d(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('OffscreenCanvas 2D is unavailable')
  return ctx
}

/** Alpha (0..1, `width` x `height`) → an 8-bit grey PNG scaled to `out`. */
export async function encodeMask(
  alpha: Float32Array,
  width: number,
  height: number,
  out: { width: number; height: number },
): Promise<ArrayBuffer> {
  const full = context2d(width, height)
  const image = full.createImageData(width, height)
  for (let i = 0; i < alpha.length; i++) {
    const v = Math.round(alpha[i]! * 255)
    image.data[i * 4] = v
    image.data[i * 4 + 1] = v
    image.data[i * 4 + 2] = v
    image.data[i * 4 + 3] = 255
  }
  full.putImageData(image, 0, 0)
  const scaled = context2d(out.width, out.height)
  scaled.imageSmoothingEnabled = true
  scaled.imageSmoothingQuality = 'high'
  scaled.drawImage(full.canvas, 0, 0, out.width, out.height)
  const blob = await (scaled.canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' })
  return blob.arrayBuffer()
}
