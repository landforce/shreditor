/**
 * The workspace LUT library: `.cube` files in `{workspace}/luts/`.
 *
 * Shared by the user and the agent. The editor's LUT panel lists and picks
 * from it and saves a copy of every `.cube` imported through the panel; the
 * agent adds files with `shred lut add` and applies them with the `addLut`
 * edit op. Plain files, so it works the same through the real File System
 * Access handle and the workspace bridge handles.
 */

import { readCubeLutHeader } from '@/infrastructure/gpu-effects/lut/cube-lut'

import { requireWorkspaceRoot } from './root'
import { listDirectory, readBlob, writeBlob } from './fs-primitives'
import { LUTS_DIR, lutFilePath, sanitizeWorkspaceFileName } from './paths'

/** Enough of a `.cube` file to hold its header (TITLE, LUT_3D_SIZE, DOMAIN_*). */
const HEADER_BYTES = 16 * 1024
const CUBE_EXTENSION = /\.cube$/i

export interface WorkspaceLut {
  /** File name in `luts/`, e.g. `Teal Orange.cube`. */
  name: string
  /** The file's TITLE, when it has one. */
  title: string | null
  /** LUT_3D_SIZE from the header, or null when it has none. */
  size: number | null
}

const isCubeFileName = (name: string) => CUBE_EXTENSION.test(name)

/** List the library's `.cube` files with what their headers say, sorted by name. */
export async function listWorkspaceLuts(): Promise<WorkspaceLut[]> {
  const root = requireWorkspaceRoot()
  const names = (await listDirectory(root, [LUTS_DIR]))
    .filter((entry) => entry.kind === 'file' && isCubeFileName(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const luts = await Promise.all(
    names.map(async (name) => {
      const blob = await readBlob(root, lutFilePath(name))
      if (!blob) return null
      const header = readCubeLutHeader(await blob.slice(0, HEADER_BYTES).text())
      return { name, title: header.title, size: header.size }
    }),
  )
  return luts.filter((lut): lut is WorkspaceLut => lut !== null)
}

const isPlainName = (name: string) =>
  name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')

/** The text of `luts/{name}`, or null when there is no such file. */
export async function readWorkspaceLut(name: string): Promise<string | null> {
  if (!isCubeFileName(name) || !isPlainName(name)) return null
  const blob = await readBlob(requireWorkspaceRoot(), lutFilePath(name))
  return blob ? blob.text() : null
}

/** A safe `luts/` file name for an imported file, always ending in `.cube`. */
export function lutLibraryFileName(fileName: string): string {
  const safe = sanitizeWorkspaceFileName(fileName)
  return isCubeFileName(safe) ? safe : sanitizeWorkspaceFileName(`${safe}.cube`)
}

function withSuffix(fileName: string, n: number): string {
  const stem = fileName.replace(CUBE_EXTENSION, '')
  const extension = fileName.slice(stem.length)
  return `${stem}-${n}${extension}`
}

export interface SavedWorkspaceLut {
  /** The file name in `luts/` that holds this content. */
  name: string
  /** False when an identical file was already there and nothing was written. */
  written: boolean
}

/**
 * Save `.cube` text into the library. A file with the same name and the same
 * content is left alone; a same-named file with other content keeps its name
 * and this one gets a `-2`, `-3`, ... suffix.
 */
export async function saveWorkspaceLut(fileName: string, text: string): Promise<SavedWorkspaceLut> {
  const root = requireWorkspaceRoot()
  const base = lutLibraryFileName(fileName)
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : withSuffix(base, n)
    const existing = await readBlob(root, lutFilePath(name))
    if (!existing) {
      await writeBlob(root, lutFilePath(name), text)
      return { name, written: true }
    }
    if ((await existing.text()) === text) return { name, written: false }
  }
}
