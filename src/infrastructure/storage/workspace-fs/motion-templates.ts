/**
 * The workspace's motion graphics template library:
 * `app/templates/<id>/template.json` plus one thumbnail per aspect ratio
 * variant, one folder per template, shared by every project in the workspace
 * and by the agent (`shred motion`). The file format lives in
 * `src/shared/motion-templates/template-core.mjs`.
 *
 * Each template is its own file and a save re-reads that file's version from
 * disk before bumping it, so the editor never writes back a stale library.
 */
import {
  MOTION_TEMPLATE_FILE,
  MOTION_TEMPLATES_DIR,
  parseMotionTemplate,
  type MotionTemplate,
} from '@/shared/motion-templates/template-core.mjs'
import { createLogger } from '@/shared/logging/logger'
import { requireWorkspaceRoot } from './root'
import {
  listDirectory,
  readBlob,
  readJson,
  removeEntry,
  writeBlob,
  writeJsonAtomic,
} from './fs-primitives'

const logger = createLogger('WorkspaceFS:MotionTemplates')

const templateFile = (id: string) => [...MOTION_TEMPLATES_DIR, id, MOTION_TEMPLATE_FILE]
const fileIn = (id: string, name: string) => [
  ...MOTION_TEMPLATES_DIR,
  id,
  name.split('/').pop() ?? name,
]
const isThumbnailFile = (name: string) => /^thumbnail(-[0-9]+x[0-9]+)?\.(jpg|webp)$/.test(name)

/** One template from disk, or null when it is missing or unreadable. */
export async function readMotionTemplate(id: string): Promise<MotionTemplate | null> {
  try {
    const raw = await readJson<unknown>(requireWorkspaceRoot(), templateFile(id))
    return raw ? parseMotionTemplate(raw) : null
  } catch (error) {
    logger.warn(`Unreadable motion template ${id}`, error)
    return null
  }
}

/** Every readable template in the library, by name. */
export async function listMotionTemplates(): Promise<MotionTemplate[]> {
  const entries = await listDirectory(requireWorkspaceRoot(), MOTION_TEMPLATES_DIR)
  const templates = await Promise.all(
    entries
      .filter((entry) => entry.kind === 'directory' && !entry.name.startsWith('.'))
      .map((entry) => readMotionTemplate(entry.name)),
  )
  return templates
    .filter((template): template is MotionTemplate => template !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** A variant's thumbnail (`variant.thumbnail`), or null when it has none on disk. */
export async function readMotionTemplateThumbnail(
  id: string,
  fileName: string | undefined,
): Promise<Blob | null> {
  if (!fileName) return null
  return readBlob(requireWorkspaceRoot(), fileIn(id, fileName))
}

/** Write one variant's thumbnail (the template file is left alone). */
export async function writeMotionTemplateThumbnail(
  id: string,
  fileName: string | undefined,
  blob: Blob,
): Promise<void> {
  if (fileName) await writeBlob(requireWorkspaceRoot(), fileIn(id, fileName), blob)
}

/** Thumbnails no variant names any more (a format 1 thumbnail.jpg re-rendered). */
async function pruneThumbnails(template: MotionTemplate): Promise<void> {
  const root = requireWorkspaceRoot()
  const kept = new Set(Object.values(template.variants).map((variant) => variant.thumbnail))
  const entries = await listDirectory(root, [...MOTION_TEMPLATES_DIR, template.id])
  for (const entry of entries)
    if (entry.kind === 'file' && isThumbnailFile(entry.name) && !kept.has(entry.name))
      await removeEntry(root, fileIn(template.id, entry.name))
}

/**
 * Write a template built against `basedOnVersion` (the version it replaces, 0
 * for a new one), with new thumbnails by aspect. Throws when the library moved
 * on meanwhile, e.g. the agent saved a newer version, instead of overwriting it.
 */
export async function saveMotionTemplate(
  template: MotionTemplate,
  basedOnVersion: number,
  thumbnails: Record<string, Blob | null> = {},
): Promise<void> {
  const root = requireWorkspaceRoot()
  const onDisk = await readMotionTemplate(template.id)
  if ((onDisk?.version ?? 0) !== basedOnVersion) {
    throw new Error(
      `"${template.name}" changed in the library (now version ${onDisk?.version ?? 0}); save again`,
    )
  }
  for (const [aspect, blob] of Object.entries(thumbnails)) {
    const name = template.variants[aspect]?.thumbnail
    if (blob && name) await writeBlob(root, fileIn(template.id, name), blob)
  }
  await writeJsonAtomic(root, templateFile(template.id), template)
  await pruneThumbnails(template).catch((error) =>
    logger.warn(`Could not tidy thumbnails of ${template.id}`, error),
  )
}
