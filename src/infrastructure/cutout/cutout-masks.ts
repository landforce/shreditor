/**
 * Mask lookup for drawing: which two stored samples straddle a clip's source
 * time, and the decoded masks. Shared by preview, export and the headless
 * frame renderer.
 */
import type { CutoutSettings } from '@/types/cutout'
import {
  cutoutSamplePath,
  findCutoutEntry,
  hasIndex,
  interpolationFor,
  mediaFingerprint,
  resolveCutoutRate,
  type CutoutIndexEntry,
} from '@/shared/cutout/cutout-core.mjs'
import { getCutoutStore, onCutoutStoreChange, readCutoutIndex } from './cutout-store'

/** What the cutout code needs to know about a media (from the media library). */
export interface CutoutMediaInfo {
  fingerprint: string
  fps: number
  duration: number
  width: number
  height: number
}

/** CutoutMediaInfo from a media's library metadata. */
export function cutoutMediaInfoFromMetadata(meta: {
  fileSize?: number
  fileLastModified?: number
  width: number
  height: number
  duration: number
  fps: number
}): CutoutMediaInfo {
  return {
    fingerprint: mediaFingerprint(meta),
    fps: meta.fps,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
  }
}

let mediaResolver: ((mediaId: string) => CutoutMediaInfo | null) | null = null

/** The editor and the headless harness tell the cutout code how to look media up. */
export function setCutoutMediaResolver(
  resolver: ((mediaId: string) => CutoutMediaInfo | null) | null,
): void {
  mediaResolver = resolver
}

export function getCutoutMediaInfo(mediaId: string): CutoutMediaInfo | null {
  return mediaResolver?.(mediaId) ?? null
}

export interface CutoutMaskSample {
  a: ImageBitmap
  b: ImageBitmap
  /** Blend a → b by t (0..1). */
  t: number
  entry: CutoutIndexEntry
}

const MAX_BITMAPS = 160
const bitmaps = new Map<string, Promise<ImageBitmap | null>>()
onCutoutStoreChange((replaced) => {
  if (replaced) bitmaps.clear()
})

function loadBitmap(mediaId: string, key: string, index: number): Promise<ImageBitmap | null> {
  const cacheKey = `${mediaId}/${key}/${index}`
  const cached = bitmaps.get(cacheKey)
  if (cached) {
    bitmaps.delete(cacheKey)
    bitmaps.set(cacheKey, cached)
    return cached
  }
  const store = getCutoutStore()
  const promise = (async () => {
    if (!store) return null
    const blob = await store.read(mediaId, cutoutSamplePath(key, index)).catch(() => null)
    if (!blob) return null
    return createImageBitmap(blob).catch(() => null)
  })()
  bitmaps.set(cacheKey, promise)
  void promise.then((bitmap) => {
    if (!bitmap) bitmaps.delete(cacheKey)
  })
  while (bitmaps.size > MAX_BITMAPS) {
    const oldest = bitmaps.keys().next().value
    if (oldest === undefined) break
    bitmaps.delete(oldest)
  }
  return promise
}

/** Where a clip's masks are for its media: the index entry, or null (not analysed yet). */
export async function resolveCutoutEntry(
  mediaId: string,
  cutout: CutoutSettings,
): Promise<CutoutIndexEntry | null> {
  const info = getCutoutMediaInfo(mediaId)
  if (!info) return null
  const index = await readCutoutIndex(mediaId)
  return findCutoutEntry(index, {
    fingerprint: info.fingerprint,
    subject: cutout.subject,
    rate: resolveCutoutRate(cutout.sampleRate, info.fps),
  }).entry
}

/**
 * The masks to blend for source time `seconds` of a clip, or null when none
 * near it are stored (the clip then draws uncut until analysis catches up).
 */
export async function sampleCutoutMasks(
  mediaId: string,
  cutout: CutoutSettings,
  seconds: number,
): Promise<CutoutMaskSample | null> {
  const entry = await resolveCutoutEntry(mediaId, cutout)
  if (!entry) return null
  const pick = interpolationFor(seconds, entry.rate, (index) => hasIndex(entry.done, index))
  if (!pick) return null
  const [a, b] = await Promise.all([
    loadBitmap(mediaId, entry.key, pick.a),
    pick.b === pick.a ? null : loadBitmap(mediaId, entry.key, pick.b),
  ])
  if (!a) return null
  return { a, b: b ?? a, t: b ? pick.t : 0, entry }
}
