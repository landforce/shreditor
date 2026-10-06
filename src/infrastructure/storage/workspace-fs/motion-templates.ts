/**
 * The workspace's motion graphics template library:
 * `app/templates/<id>/template.json` plus `thumbnail.jpg`, one folder per
 * template, shared by every project in the workspace and by the agent
 * (`shred templates`). The file format lives in
 * `src/shared/motion-templates/template-core.mjs`.
 *
 * Each template is its own file and a save re-reads that file's version from
 * disk before bumping it, so the editor never writes back a stale library.
 */
import {
  MOTION_TEMPLATE_FILE,
  MOTION_TEMPLATE_THUMBNAIL,
  MOTION_TEMPLATES_DIR,
  parseMotionTemplate,
  type MotionTemplate,
} from '@/shared/motion-templates/template-core.mjs'
import { createLogger } from '@/shared/logging/logger'
import { requireWorkspaceRoot } from './root'
import { listDirectory, readBlob, readJson, writeBlob, writeJsonAtomic } from './fs-primitives'

const logger = createLogger('WorkspaceFS:MotionTemplates')

const templateFile = (id: string) => [...MOTION_TEMPLATES_DIR, id, MOTION_TEMPLATE_FILE]
const thumbnailFile = (id: string) => [...MOTION_TEMPLATES_DIR, id, MOTION_TEMPLATE_THUMBNAIL]

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

export async function readMotionTemplateThumbnail(id: string): Promise<Blob | null> {
  return readBlob(requireWorkspaceRoot(), thumbnailFile(id))
}

/**
 * Write a template built against `basedOnVersion` (the version it replaces, 0
 * for a new one). Throws when the library moved on meanwhile, e.g. the agent
 * saved a newer version, instead of overwriting it.
 */
export async function saveMotionTemplate(
  template: MotionTemplate,
  basedOnVersion: number,
  thumbnail: Blob | null,
): Promise<void> {
  const root = requireWorkspaceRoot()
  const onDisk = await readMotionTemplate(template.id)
  if ((onDisk?.version ?? 0) !== basedOnVersion) {
    throw new Error(
      `"${template.name}" changed in the library (now version ${onDisk?.version ?? 0}); save again`,
    )
  }
  if (thumbnail) await writeBlob(root, thumbnailFile(template.id), thumbnail)
  await writeJsonAtomic(root, templateFile(template.id), template)
}
