/**
 * In-place media import through the local workspace bridge
 * (`server/media-bridge.mjs`).
 *
 * The bridge opens a native Finder chooser and puts each chosen file into a
 * new `media/{id}/` folder itself, as an APFS clone or a link to the
 * original, so the browser never uploads the bytes. The returned handles
 * point at those placed files, and the editor reads them through the bridge
 * like any other workspace media to build metadata, thumbnails and waveforms.
 */

import type { MediaMetadata } from '@/types/storage'
import { requireWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'

import { BridgeFileHandle, isBridgeHandle } from './bridge-handles'

const BASE = '/__shreditor'

interface PlacedMedia {
  id: string
  fileName: string
  path: string
  method: 'clone' | 'link'
}

const placedIds = new WeakMap<FileSystemFileHandle, string>()

/** True when the workspace is served by the bridge, so in-place import can work. */
export function canImportMediaInPlace(): boolean {
  try {
    return isBridgeHandle(requireWorkspaceRoot())
  } catch {
    return false
  }
}

/**
 * Ask the bridge to show the Finder chooser and place the picked files.
 *
 * Returns the placed files as handles (empty when the user cancels), or
 * null when this bridge has no in-place import route, so the caller can fall
 * back to the browser's own file picker.
 */
export async function chooseMediaInPlace(): Promise<FileSystemFileHandle[] | null> {
  const res = await fetch(`${BASE}/media/choose`, { method: 'POST', body: '{}', cache: 'no-store' })
  if (res.status === 499) return []
  if (res.status === 404 || res.status === 501) return null
  const body = (await res.json().catch(() => ({}))) as {
    files?: PlacedMedia[]
    skipped?: Array<{ sourcePath: string; error: { message: string } }>
    message?: string
  }
  if (!res.ok) throw new Error(body.message ?? 'Could not import media')
  if (body.skipped?.length && !body.files?.length) {
    throw new Error(body.skipped.map((s) => s.error.message).join('; '))
  }
  return (body.files ?? []).map((placed) => {
    const handle = new BridgeFileHandle(
      placed.fileName,
      placed.path,
    ) as unknown as FileSystemFileHandle
    placedIds.set(handle, placed.id)
    return handle
  })
}

/** The media id the bridge reserved for a handle from {@link chooseMediaInPlace}. */
export function getPlacedMediaId(handle: FileSystemFileHandle): string | undefined {
  return placedIds.get(handle)
}

/** Remove a placed file that ended up unused (a duplicate, or a failed import). */
export async function discardPlacedMedia(mediaId: string): Promise<void> {
  await fetch(`${BASE}/fs/entry?path=${encodeURIComponent(`media/${mediaId}`)}&recursive=1`, {
    method: 'DELETE',
    cache: 'no-store',
  })
}

/**
 * Change stamp for a project's media from the bridge (`GET media/version`):
 * moves when anything outside this tab imports, removes or recategorizes
 * media. Null when the workspace isn't bridge-served or the bridge is older.
 */
export async function readProjectMediaVersion(projectId: string): Promise<string | null> {
  if (!canImportMediaInPlace()) return null
  const res = await fetch(`${BASE}/media/version?projectId=${encodeURIComponent(projectId)}`, {
    cache: 'no-store',
  })
  if (!res.ok) return null
  const body = (await res.json().catch(() => ({}))) as { version?: unknown }
  return typeof body.version === 'string' ? body.version : null
}

async function postBridge<T>(route: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${BASE}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (
    res.status === 404 &&
    !(
      await res
        .clone()
        .json()
        .catch(() => null)
    )?.name
  )
    return null
  const result = (await res.json().catch(() => ({}))) as T & { message?: string }
  if (!res.ok) throw new Error(result.message ?? `Media bridge ${route} failed (${res.status})`)
  return result
}

/**
 * Whether a file the bridge placed needs a working copy before the browser
 * can decode it (server/media-preparation.mjs). Null when the bridge is older.
 */
export async function checkPlacedMediaPreparation(
  mediaId: string,
  fileName: string,
): Promise<boolean | null> {
  if (!canImportMediaInPlace()) return null
  const result = await postBridge<{ prepare?: boolean }>('media/ingest', { mediaId, fileName })
  return result ? result.prepare === true : null
}

/**
 * Start the working copy of a placed file: the bridge writes its metadata
 * (state 'preparing'), links it to the project and returns the metadata. The
 * media pane picks up progress and completion through the media watcher.
 */
export async function startPlacedMediaPreparation(
  mediaId: string,
  fileName: string,
  projectId: string,
): Promise<MediaMetadata> {
  const result = await postBridge<{ metadata?: MediaMetadata }>('media/ingest', {
    mediaId,
    fileName,
    projectId,
    start: true,
  })
  if (!result?.metadata) throw new Error('The media bridge did not start the working copy')
  return result.metadata
}

/** Start a failed working copy again. */
export async function retryMediaPreparation(mediaId: string): Promise<void> {
  await postBridge('media/retry', { mediaId })
}
