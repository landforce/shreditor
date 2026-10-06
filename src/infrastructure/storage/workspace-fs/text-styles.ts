/**
 * The text style library: `app/text-styles.json` in the workspace, shared by
 * every project, the user and the agent (`shred styles`).
 *
 * The agent writes this file too, so the editor never writes back a copy it
 * read earlier: every change re-reads the file and applies one edit to what
 * is there now (see {@link updateTextStyleLibrary}), and the editor re-reads
 * it when its stamp changes ({@link readTextStyleLibraryStamp}).
 *
 * Styles are stored as families (one variant per aspect ratio); old
 * single-look entries are read as a 9:16 variant and written back as
 * families. `seeded` records that the built-in styles were added once.
 */

import type { TextStyleDefinition } from '@/types/text-style'
import { sanitizeTextStyles } from '@/shared/typography/text-styles/text-style-schema'
import {
  TEXT_STYLE_LIBRARY_SEED,
  seedTextStyles,
  textStyleLibraryNeedsSeed,
} from '@/shared/typography/text-styles/text-style-family.mjs'
import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import { readJson, writeJsonAtomic } from './fs-primitives'
import { withKeyLock } from './with-key-lock'

const logger = createLogger('WorkspaceFS:TextStyles')

const TEXT_STYLES_PATH = ['app', 'text-styles.json']

interface TextStyleLibraryFile {
  version: 2
  /** The built-ins were added (see TEXT_STYLE_LIBRARY_SEED). */
  seeded?: number
  styles: TextStyleDefinition[]
}

/** Changes whenever the file is rewritten (by this tab or anyone else). */
export interface TextStyleLibraryStamp {
  lastModified: number
  size: number
}

interface TextStyleLibraryRead {
  styles: TextStyleDefinition[]
  /** False when the file is missing or was never seeded with the built-ins. */
  seeded: boolean
}

export async function readTextStyleLibrary(): Promise<TextStyleLibraryRead> {
  try {
    const file = await readJson<TextStyleLibraryFile>(requireWorkspaceRoot(), TEXT_STYLES_PATH)
    return { styles: sanitizeTextStyles(file?.styles), seeded: !textStyleLibraryNeedsSeed(file) }
  } catch (error) {
    logger.warn('readTextStyleLibrary failed', error)
    return { styles: [], seeded: false }
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

async function writeLibrary(
  change: (
    styles: TextStyleDefinition[],
    file: TextStyleLibraryFile | null,
  ) => {
    styles: TextStyleDefinition[]
    seeded?: number
  } | null,
): Promise<TextStyleDefinition[] | null> {
  return withKeyLock('text-style-library', async () => {
    const root = requireWorkspaceRoot()
    const file = await readJson<TextStyleLibraryFile>(root, TEXT_STYLES_PATH)
    const next = change(sanitizeTextStyles(file?.styles), file)
    if (!next) return null
    const seeded = next.seeded ?? file?.seeded
    await writeJsonAtomic(root, TEXT_STYLES_PATH, {
      version: 2,
      ...(seeded ? { seeded } : {}),
      styles: next.styles,
    } satisfies TextStyleLibraryFile)
    return next.styles
  })
}

/**
 * Apply one change to the library as it is on disk now, and write it
 * atomically. Returns the styles that were written.
 */
export async function updateTextStyleLibrary(
  change: (styles: TextStyleDefinition[]) => TextStyleDefinition[],
): Promise<TextStyleDefinition[]> {
  return (await writeLibrary((styles) => ({ styles: change(styles) }))) ?? []
}

/**
 * Add the built-in styles to a library that was never seeded (or has no file
 * yet) and mark it seeded. Returns null when it already was.
 */
export async function seedTextStyleLibrary(
  builtins: readonly TextStyleDefinition[],
): Promise<TextStyleDefinition[] | null> {
  return writeLibrary((styles, file) =>
    textStyleLibraryNeedsSeed(file)
      ? { styles: seedTextStyles(styles, builtins), seeded: TEXT_STYLE_LIBRARY_SEED }
      : null,
  )
}
