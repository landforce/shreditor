/**
 * Where cutout masks live: `media/<id>/cache/cutout/` in the workspace
 * (layout in src/shared/cutout/cutout-core.mjs). The editor reads and writes
 * through the workspace bridge (one HTTP request per file) or, with a picked
 * folder, through the workspace directory handle; the headless harness talks to
 * the agent service's cutout store, which serves the same `fs/file` API over the
 * same folder. Worker-safe apart from the directory-handle backend.
 */
import {
  CUTOUT_INDEX_FILE,
  cutoutDirSegments,
  mergeCutoutIndex,
  parseCutoutIndex,
  type CutoutIndex,
} from '@/shared/cutout/cutout-core.mjs'

export interface CutoutStoreBackend {
  /** A file under the media's cutout folder, or null when it doesn't exist. */
  read(mediaId: string, rel: string): Promise<Blob | null>
  write(mediaId: string, rel: string, data: Blob | string): Promise<void>
}

const workspacePath = (mediaId: string, rel: string) =>
  [...cutoutDirSegments(mediaId), ...rel.split('/')].join('/')

/**
 * The `GET|PUT <base>/fs/file?path=<workspace path>` API: the editor's
 * workspace bridge (`/__shreditor`) and the agent service's cutout store both
 * speak it.
 */
export function createHttpCutoutStore(base: string): CutoutStoreBackend {
  const url = (mediaId: string, rel: string) =>
    `${base}/fs/file?path=${encodeURIComponent(workspacePath(mediaId, rel))}`
  return {
    async read(mediaId, rel) {
      const res = await fetch(url(mediaId, rel), { cache: 'no-store' })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`cutout store: GET ${rel} failed (${res.status})`)
      return res.blob()
    },
    async write(mediaId, rel, data) {
      const res = await fetch(url(mediaId, rel), { method: 'PUT', body: data })
      if (!res.ok) throw new Error(`cutout store: PUT ${rel} failed (${res.status})`)
    },
  }
}

let backend: CutoutStoreBackend | null = null
const listeners = new Set<() => void>()

/** Set (or clear) where masks are read and written. */
export function configureCutoutStore(next: CutoutStoreBackend | null): void {
  backend = next
  indexCache.clear()
  for (const listener of listeners) listener()
}

export function getCutoutStore(): CutoutStoreBackend | null {
  return backend
}

/** Called when masks change (a job wrote samples, the store moved). */
export function onCutoutStoreChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyCutoutStoreChange(): void {
  for (const listener of listeners) listener()
}

const INDEX_TTL_MS = 1500
const indexCache = new Map<string, { at: number; index: Promise<CutoutIndex> }>()

/** A media's cutout index (cached briefly; another writer may be adding samples). */
export function readCutoutIndex(mediaId: string, fresh = false): Promise<CutoutIndex> {
  const cached = indexCache.get(mediaId)
  if (!fresh && cached && Date.now() - cached.at < INDEX_TTL_MS) return cached.index
  const store = backend
  const index = (async () => {
    if (!store) return parseCutoutIndex(null)
    try {
      const blob = await store.read(mediaId, CUTOUT_INDEX_FILE)
      return parseCutoutIndex(blob ? JSON.parse(await blob.text()) : null)
    } catch {
      return parseCutoutIndex(null)
    }
  })()
  indexCache.set(mediaId, { at: Date.now(), index })
  return index
}

/** Merge `mine` into the media's index on disk (re-read first so other writers' samples stay). */
export async function writeCutoutIndex(mediaId: string, mine: CutoutIndex): Promise<CutoutIndex> {
  const store = backend
  if (!store) throw new Error('cutout store is not configured')
  const disk = await readCutoutIndex(mediaId, true)
  const merged = mergeCutoutIndex(disk, mine)
  await store.write(mediaId, CUTOUT_INDEX_FILE, JSON.stringify(merged, null, 2))
  indexCache.set(mediaId, { at: Date.now(), index: Promise.resolve(merged) })
  return merged
}
