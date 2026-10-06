/**
 * The text style library: `app/text-styles.json` in the workspace, shared by
 * every project, the user and the agent (`shred styles`).
 *
 * The agent writes this file too, so the editor never writes back a copy it
 * read earlier: every change re-reads the file and applies one edit to what
 * is there now (see {@link updateTextStyleLibrary}), and the editor re-reads
 * it when its stamp changes ({@link readTextStyleLibraryStamp}).
 */

import type { TextStyleDefinition } from '@/types/text-style'
import { sanitizeTextStyles } from '@/shared/typography/text-styles/text-style-schema'
import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import { readJson, writeJsonAtomic } from './fs-primitives'
import { withKeyLock } from './with-key-lock'

const logger = createLogger('WorkspaceFS:TextStyles')

const TEXT_STYLES_PATH = ['app', 'text-styles.json']

interface TextStyleLibraryFile {
  version: 1
  styles: TextStyleDefinition[]
}

/** Changes whenever the file is rewritten (by this tab or anyone else). */
export interface TextStyleLibraryStamp {
  lastModified: number
  size: number
}

export async function readTextStyleLibrary(): Promise<TextStyleDefinition[]> {
  try {
    const file = await readJson<TextStyleLibraryFile>(requireWorkspaceRoot(), TEXT_STYLES_PATH)
    return sanitizeTextStyles(file?.styles)
  } catch (error) {
    logger.warn('readTextStyleLibrary failed', error)
    return []
  }
}

/** mtime and size of the library file, or null when there is none yet. */
export async function readTextStyleLibraryStamp(): Promise<TextStyleLibraryStamp | null> {
  try {
    let dir = requireWorkspaceRoot()
    for (const segment of TEXT_STYLES_PATH.slice(0, -1)) dir = await dir.getDirectoryHandle(segment)
    const handle = await dir.getFileHandle(TEXT_STYLES_PATH[TEXT_STYLES_PATH.length - 1]!)
    const file = await handle.getFile()
    return { lastModified: file.lastModified, size: file.size }
  } catch (error) {
    if ((error as DOMException)?.name === 'NotFoundError') return null
    throw error
  }
}

/**
 * Apply one change to the library as it is on disk now, and write it
 * atomically. Returns the styles that were written.
 */
export async function updateTextStyleLibrary(
  change: (styles: TextStyleDefinition[]) => TextStyleDefinition[],
): Promise<TextStyleDefinition[]> {
  return withKeyLock('text-style-library', async () => {
    const root = requireWorkspaceRoot()
    const file = await readJson<TextStyleLibraryFile>(root, TEXT_STYLES_PATH)
    const styles = change(sanitizeTextStyles(file?.styles))
    const next: TextStyleLibraryFile = { version: 1, styles }
    await writeJsonAtomic(root, TEXT_STYLES_PATH, next)
    return styles
  })
}
