import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { getObjectUrlBlob } from '@/infrastructure/browser/object-url-registry'
import { proxyService, useMediaLibraryStore } from '../deps/media-library-contract'
import { importFilmstripCache } from '../deps/timeline-filmstrip'
import {
  cacheActivePreviewFallbackBitmap,
  getCachedActivePreviewFallbackBitmap,
  getCachedPredecodedBitmap,
  isActivePreviewSourceTarget,
  isActivePreviewTargetSuperseded,
} from './decoder-prewarm'

const MAX_FALLBACK_DRIFT_SECONDS = 0.75
const EXACT_FRAME_TOLERANCE_SECONDS = 1 / 240
/**
 * The most a filmstrip thumbnail may be magnified on screen to stand in for a
 * frame. Up to 4x a bilinear upscale reads as motion softness during a fast
 * drag; past it every thumbnail pixel becomes a 4x4+ block of JPEG mosaic and
 * the preview looks broken (a 9:16 timeline tile is 65x116, so on a 1920 px
 * tall player it would be magnified 16x). Equivalently: the thumbnail's long
 * edge must cover at least 25% of the drawn long edge.
 */
const MAX_SCRUB_FALLBACK_UPSCALE = 4

/** Device-pixel size of the surface the fallback would be drawn into. */
export interface ScrubProxyFallbackDisplaySize {
  width: number
  height: number
}

export interface ScrubProxyFallbackRequest {
  /** On-screen size (device px) the frame is drawn at; null when unknown. */
  display: ScrubProxyFallbackDisplaySize | null
  /**
   * Held-scrub targets publish only while they are still the active target.
   * Reverse playback has no active target and only needs "not superseded".
   */
  requireActiveTarget: boolean
}

const fallbackGenerationBySource = new Map<string, number>()
const fallbackInflight = new Map<string, Promise<void>>()
const frameSizeByMediaId = new Map<string, ScrubProxyFallbackDisplaySize>()
let filmstripModulePromise: ReturnType<typeof importFilmstripCache> | null = null

function loadFilmstripModule() {
  filmstripModulePromise ??= importFilmstripCache()
  return filmstripModulePromise
}

export function warmScrubProxyFallback(): void {
  void loadFilmstripModule().then(({ filmstripCache }) => filmstripCache.prewarm())
}

/** Device-pixel size of the preview canvas as laid out on screen; null when not laid out. */
export function measureScrubProxyFallbackDisplay(
  canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight'> | null,
  devicePixelRatio: number,
): ScrubProxyFallbackDisplaySize | null {
  if (!canvas || !(canvas.clientWidth > 0) || !(canvas.clientHeight > 0)) return null
  const scale = devicePixelRatio > 0 ? devicePixelRatio : 1
  return { width: canvas.clientWidth * scale, height: canvas.clientHeight * scale }
}

/**
 * Whether a `frame`-sized thumbnail stays legible when contained in `display`.
 * An unknown display is never legible: without a size there is no way to rule
 * out a 10x+ mosaic, and holding the previous exact frame is always safe.
 */
export function isScrubProxyFallbackLegible(
  frame: ScrubProxyFallbackDisplaySize,
  display: ScrubProxyFallbackDisplaySize | null,
): boolean {
  if (!display || !(display.width > 0) || !(display.height > 0)) return false
  if (!(frame.width > 0) || !(frame.height > 0)) return false
  const upscale = Math.min(display.width / frame.width, display.height / frame.height)
  return upscale <= MAX_SCRUB_FALLBACK_UPSCALE
}

/**
 * Publish only while the fallback can still be useful: the exact frame has not
 * landed first, and the target has not moved on (or, for held scrubs, ended).
 */
export function shouldPublishScrubProxyFallback(
  src: string,
  timestamp: number,
  requireActiveTarget: boolean,
): boolean {
  if (getCachedPredecodedBitmap(src, timestamp, EXACT_FRAME_TOLERANCE_SECONDS)) return false
  if (isActivePreviewTargetSuperseded(src, timestamp)) return false
  return !requireActiveTarget || isActivePreviewSourceTarget(src, timestamp)
}

async function bitmapFromFrame(frame: { url: string; bitmap?: ImageBitmap }): Promise<ImageBitmap> {
  if (frame.bitmap) return createImageBitmap(frame.bitmap)
  const registeredBlob = getObjectUrlBlob(frame.url)
  if (registeredBlob) return createImageBitmap(registeredBlob)
  const response = await fetch(frame.url)
  if (!response.ok) throw new Error(`Scrub proxy frame unavailable (${response.status})`)
  return createImageBitmap(await response.blob())
}

function findNearestFrame<T extends { timestamp: number }>(
  frames: T[],
  timestamp: number,
): T | null {
  let nearest: T | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const candidate of frames) {
    const distance = Math.abs(candidate.timestamp - timestamp)
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearestDistance <= MAX_FALLBACK_DRIFT_SECONDS ? nearest : null
}

export function scheduleScrubProxyFallback(
  src: string,
  timestamp: number,
  request: ScrubProxyFallbackRequest,
): void {
  if (getCachedActivePreviewFallbackBitmap(src, timestamp)) return
  const mediaId = blobUrlManager.getMediaIdByUrl(src) ?? proxyService.getMediaIdByProxyUrl(src)
  if (!mediaId) return

  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media || media.duration <= 0) return
  // Thumbnails of one media share a size: once one proved too small for this
  // display, skip the filmstrip read entirely.
  const knownFrameSize = frameSizeByMediaId.get(mediaId)
  if (knownFrameSize && !isScrubProxyFallbackLegible(knownFrameSize, request.display)) return

  const generation = (fallbackGenerationBySource.get(src) ?? 0) + 1
  fallbackGenerationBySource.set(src, generation)
  const key = `${src}:${timestamp.toFixed(6)}`
  if (fallbackInflight.has(key)) return

  const pending = (async () => {
    const { filmstripCache } = await loadFilmstripModule()
    const filmstrip =
      filmstripCache.getFromCacheSync(mediaId) ??
      (await filmstripCache.loadFromDisk(mediaId, media.duration))
    const nearest = filmstrip ? findNearestFrame(filmstrip.frames, timestamp) : null
    if (!nearest) return

    const bitmap = await bitmapFromFrame(nearest)
    frameSizeByMediaId.set(mediaId, { width: bitmap.width, height: bitmap.height })
    if (
      fallbackGenerationBySource.get(src) !== generation ||
      !isScrubProxyFallbackLegible(bitmap, request.display) ||
      !shouldPublishScrubProxyFallback(src, timestamp, request.requireActiveTarget)
    ) {
      bitmap.close()
      return
    }
    cacheActivePreviewFallbackBitmap(src, timestamp, nearest.timestamp, bitmap)
  })()
    .catch(() => undefined)
    .finally(() => fallbackInflight.delete(key))
  fallbackInflight.set(key, pending)
}

export function disposeScrubProxyFallback(): void {
  fallbackGenerationBySource.clear()
  fallbackInflight.clear()
  frameSizeByMediaId.clear()
}
