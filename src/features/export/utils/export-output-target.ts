import type { ClientContainer, ClientRenderResult } from './client-renderer'
import {
  addAudioPrimingEditListToBuffer,
  addAudioPrimingEditListToFile,
  type AudioPrimingEdit,
  type IsoBmffFileAccess,
} from './isobmff-audio-priming'

type MediabunnyModule = typeof import('mediabunny')

const EXPORT_SCRATCH_DIR = 'freecut-export-output'
const STREAM_CHUNK_SIZE_BYTES = 4 * 1024 * 1024
const STALE_OUTPUT_AGE_MS = 24 * 60 * 60 * 1000
let staleCleanupStarted = false

export interface TemporaryExportOutput {
  directory: string
  fileName: string
}

export interface ExportOutputTarget {
  target:
    | InstanceType<MediabunnyModule['BufferTarget']>
    | InstanceType<MediabunnyModule['StreamTarget']>
  kind: 'buffer' | 'file'
  /**
   * After `output.finalize()`: mark the AAC encoder delay in the finished
   * MP4/MOV (isobmff-audio-priming.ts). Resolves whether the file changed.
   */
  applyAudioPrimingEdit: (edit: AudioPrimingEdit) => Promise<boolean>
  complete: () => Promise<{
    blob: Blob
    temporaryOutput?: TemporaryExportOutput
  }>
  discard: () => Promise<void>
}

function randomOutputName(container: ClientContainer): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${id}.${container}`
}

async function readFileRange(file: Blob, offset: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
}

/**
 * Patch the finished OPFS file in place. A sync access handle (workers) writes
 * in place; elsewhere a writable that keeps the existing data is used, which
 * the browser backs with a copy of the file.
 */
async function patchOpfsFile(
  fileHandle: FileSystemFileHandle,
  edit: AudioPrimingEdit,
): Promise<boolean> {
  const file = await fileHandle.getFile()
  const inWorker =
    typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope
  if (inWorker && typeof fileHandle.createSyncAccessHandle === 'function') {
    const handle = await fileHandle.createSyncAccessHandle()
    try {
      const access: IsoBmffFileAccess = {
        size: handle.getSize(),
        read: async (offset, length) => {
          const bytes = new Uint8Array(Math.max(0, Math.min(length, handle.getSize() - offset)))
          handle.read(bytes, { at: offset })
          return bytes
        },
        replaceTail: async (offset, data) => {
          handle.write(data, { at: offset })
          handle.truncate(offset + data.byteLength)
          handle.flush()
        },
      }
      return await addAudioPrimingEditListToFile(access, edit)
    } finally {
      handle.close()
    }
  }
  let writable: FileSystemWritableFileStream | null = null
  const access: IsoBmffFileAccess = {
    size: file.size,
    read: (offset, length) => readFileRange(file, offset, length),
    replaceTail: async (offset, data) => {
      writable = await fileHandle.createWritable({ keepExistingData: true })
      await writable.write({ type: 'write', position: offset, data })
      await writable.truncate(offset + data.byteLength)
    },
  }
  try {
    const changed = await addAudioPrimingEditListToFile(access, edit)
    await (writable as FileSystemWritableFileStream | null)?.close()
    return changed
  } catch (error) {
    await (writable as FileSystemWritableFileStream | null)?.abort().catch(() => undefined)
    throw error
  }
}

async function createFileBackedTarget(
  mediabunny: MediabunnyModule,
  container: ClientContainer,
  mimeType: string,
): Promise<ExportOutputTarget | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null

  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle(EXPORT_SCRATCH_DIR, { create: true })
  if (!staleCleanupStarted) {
    staleCleanupStarted = true
    void (async () => {
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind !== 'file') continue
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          if (Date.now() - file.lastModified >= STALE_OUTPUT_AGE_MS) {
            await directory.removeEntry(name)
          }
        } catch {
          // Another export context may have removed the file already.
        }
      }
    })()
  }
  const fileName = randomOutputName(container)
  const fileHandle = await directory.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  let settled = false

  const removeFile = async () => {
    try {
      await directory.removeEntry(fileName)
    } catch {
      // Already removed or unavailable.
    }
  }

  return {
    target: new mediabunny.StreamTarget(writable, {
      chunked: true,
      chunkSize: STREAM_CHUNK_SIZE_BYTES,
    }),
    kind: 'file',
    applyAudioPrimingEdit: (edit) => patchOpfsFile(fileHandle, edit),
    complete: async () => {
      settled = true
      const file = await fileHandle.getFile()
      return {
        // Blob composition keeps the OPFS-backed File as its immutable backing
        // store while supplying the MIME type that OPFS files don't preserve.
        blob: new Blob([file], { type: mimeType }),
        temporaryOutput: { directory: EXPORT_SCRATCH_DIR, fileName },
      }
    },
    discard: async () => {
      if (!settled) {
        await writable.abort().catch(() => undefined)
      }
      await removeFile()
    },
  }
}

/**
 * Prefer an OPFS-backed Mediabunny target so encoded bytes are flushed to disk
 * instead of accumulating in one renderer-process ArrayBuffer. BufferTarget is
 * retained as a compatibility fallback for environments without OPFS.
 */
export async function createExportOutputTarget(
  mediabunny: MediabunnyModule,
  container: ClientContainer,
  mimeType: string,
): Promise<ExportOutputTarget> {
  try {
    const fileTarget = await createFileBackedTarget(mediabunny, container, mimeType)
    if (fileTarget) return fileTarget
  } catch {
    // Preserve export support where OPFS exists but is temporarily unavailable.
  }

  const target = new mediabunny.BufferTarget()
  return {
    target,
    kind: 'buffer',
    applyAudioPrimingEdit: async (edit) => {
      if (!target.buffer) return false
      const patched = addAudioPrimingEditListToBuffer(new Uint8Array(target.buffer), edit)
      if (!patched) return false
      target.buffer = patched.buffer
      return true
    },
    complete: async () => {
      if (!target.buffer) throw new Error('No output buffer generated')
      return { blob: new Blob([target.buffer], { type: mimeType }) }
    },
    discard: async () => {},
  }
}

export async function releaseTemporaryExportOutput(
  result: Pick<ClientRenderResult, 'temporaryOutput'> | null | undefined,
): Promise<void> {
  const temporary = result?.temporaryOutput
  if (!temporary || typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return

  try {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle(temporary.directory)
    await directory.removeEntry(temporary.fileName)
  } catch {
    // Cleanup is best-effort; the file may already have been removed.
  }
}
