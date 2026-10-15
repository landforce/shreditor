/**
 * The editor's cutout store: the open workspace. Through the bridge it is one
 * HTTP request per mask; with a folder picked in the browser it goes through
 * the directory handle like every other workspace file.
 */
import { cutoutDirSegments } from '@/shared/cutout/cutout-core.mjs'
import { isBridgeHandle } from '@/infrastructure/storage/bridge-fs/bridge-handles'
import { readBlob, writeBlob } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { getWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { createHttpCutoutStore, type CutoutStoreBackend } from './cutout-store'

export function createWorkspaceCutoutStore(): CutoutStoreBackend | null {
  const root = getWorkspaceRoot()
  if (!root) return null
  if (isBridgeHandle(root)) return createHttpCutoutStore('/__shreditor')
  const segments = (mediaId: string, rel: string) => [
    ...cutoutDirSegments(mediaId),
    ...rel.split('/'),
  ]
  return {
    read: (mediaId, rel) => readBlob(root, segments(mediaId, rel)),
    write: (mediaId, rel, data) => writeBlob(root, segments(mediaId, rel), data),
  }
}
