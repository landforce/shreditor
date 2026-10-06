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
