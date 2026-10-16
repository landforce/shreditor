/**
 * Mask lookup for drawing: which two stored samples straddle a clip's source
 * time, and the decoded masks. Shared by preview, export and the headless
 * frame renderer.
 */
import type { CutoutSettings, CutoutStroke } from '@/types/cutout'
import {
  cutoutRegionKey,
  cutoutSamplePath,
  findCutoutEntry,
  hasIndex,
  interpolationFor,
  mediaFingerprint,
  resolveCutoutRate,
  type CutoutIndex,
  type CutoutIndexEntry,
  type CutoutRegionEntry,
  type IndexRange,
} from '@/shared/cutout/cutout-core.mjs'
import {
  cutoutStrokeHash,
  isEraseStroke,
  isSmartStroke,
  strokeFollowOffset,
} from '@/shared/cutout/cutout-strokes.mjs'
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

/** Two stored samples to blend a → b by t (0..1). */
interface BlendedMasks {
  a: ImageBitmap
  b: ImageBitmap
  t: number
}

/** A smart stroke's tracked region at this time. */
export interface CutoutRegionLayer extends BlendedMasks {
  kind: 'region'
  erase: boolean
}

/** A plain stroke, moved with the region it follows. */
export interface CutoutStrokeLayer {
  kind: 'stroke'
  erase: boolean
  points: Array<[number, number]>
  size: number
}

export type CutoutLayer = CutoutRegionLayer | CutoutStrokeLayer

export interface CutoutMaskSample extends BlendedMasks {
  entry: CutoutIndexEntry
  /** Brush corrections, in the order they were painted. */
  layers: CutoutLayer[]
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

/** The two stored samples around `seconds` in a set of `done` ranges, decoded. */
async function blendAt(
  mediaId: string,
  key: string,
  rate: number,
  done: readonly IndexRange[],
  seconds: number,
): Promise<BlendedMasks | null> {
  const pick = interpolationFor(seconds, rate, (index) => hasIndex(done, index))
  if (!pick) return null
  const [a, b] = await Promise.all([
    loadBitmap(mediaId, key, pick.a),
    pick.b === pick.a ? null : loadBitmap(mediaId, key, pick.b),
  ])
  return a ? { a, b: b ?? a, t: b ? pick.t : 0 } : null
}

interface StrokeContext {
  mediaId: string
  index: CutoutIndex
  fingerprint: string
  rate: number
  seconds: number
}

/** The tracked region entries of a clip's smart strokes. */
function strokeRegions(strokes: readonly CutoutStroke[], c: StrokeContext): CutoutRegionEntry[] {
  return strokes
    .filter(isSmartStroke)
    .map((stroke) => {
      const hash = cutoutStrokeHash(stroke)
      return c.index.regions[cutoutRegionKey({ fingerprint: c.fingerprint, rate: c.rate, hash })]
    })
    .filter((entry): entry is CutoutRegionEntry => Boolean(entry))
}

/** One stroke's layer at this time, or null (a region not tracked here yet, or lost). */
async function strokeLayer(
  stroke: CutoutStroke,
  regions: CutoutRegionEntry[],
  c: StrokeContext,
): Promise<CutoutLayer | null> {
  const erase = isEraseStroke(stroke)
  if (!isSmartStroke(stroke)) {
    const [dx, dy] = strokeFollowOffset(stroke, regions, c.seconds)
    const points = stroke.points.map(([x, y]): [number, number] => [x + dx, y + dy])
    return { kind: 'stroke', erase, points, size: stroke.size }
  }
  const hash = cutoutStrokeHash(stroke)
  const entry = c.index.regions[cutoutRegionKey({ fingerprint: c.fingerprint, rate: c.rate, hash })]
  if (!entry) return null
  const masks = await blendAt(c.mediaId, entry.key, entry.rate, entry.done, c.seconds)
  return masks ? { kind: 'region', erase, ...masks } : null
}

async function sampleStrokeLayers(
  strokes: readonly CutoutStroke[] | undefined,
  c: StrokeContext,
): Promise<CutoutLayer[]> {
  if (!strokes?.length) return []
  const regions = strokeRegions(strokes, c)
  const layers = await Promise.all(strokes.map((stroke) => strokeLayer(stroke, regions, c)))
  return layers.filter((layer): layer is CutoutLayer => layer !== null)
}

/**
 * The masks to blend for source time `seconds` of a clip, with its brush
 * corrections, or null when no auto mask near it is stored (the clip then
 * draws uncut until analysis catches up).
 */
export async function sampleCutoutMasks(
  mediaId: string,
  cutout: CutoutSettings,
  seconds: number,
): Promise<CutoutMaskSample | null> {
  const info = getCutoutMediaInfo(mediaId)
  if (!info) return null
  const index = await readCutoutIndex(mediaId)
  const rate = resolveCutoutRate(cutout.sampleRate, info.fps)
  const { entry } = findCutoutEntry(index, {
    fingerprint: info.fingerprint,
    subject: cutout.subject,
    rate,
  })
  if (!entry) return null
  const context = { mediaId, index, fingerprint: info.fingerprint, rate, seconds }
  const [masks, layers] = await Promise.all([
    blendAt(mediaId, entry.key, entry.rate, entry.done, seconds),
    sampleStrokeLayers(cutout.strokes, context),
  ])
  return masks ? { ...masks, entry, layers } : null
}
