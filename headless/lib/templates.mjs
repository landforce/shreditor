// The motion template library on disk: <workspace>/app/templates/<id>/template.json
// (+ thumbnail.jpg). Read by the edit service (addTemplate/updateTemplate ops get
// the templates they name in their edit input) and written by `shred templates`.
// The file format and the build logic live in src/shared/motion-templates.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildMotionTemplate,
  findMotionTemplate,
  MOTION_TEMPLATE_FILE,
  MOTION_TEMPLATE_THUMBNAIL,
  MOTION_TEMPLATES_DIR,
  parseMotionTemplate,
} from '../../src/shared/motion-templates/template-core.mjs'
import { assertSinglePathComponent, HttpError, resolveContained } from './http-security.mjs'

const TEMPLATE_OPS = new Set(['addTemplate', 'updateTemplate'])

export const templatesRoot = (workspace) => path.join(workspace, ...MOTION_TEMPLATES_DIR)

function templateDir(workspace, id) {
  assertSinglePathComponent(id, 'template id')
  return resolveContained(templatesRoot(workspace), id)
}

function readTemplateDir(dir) {
  const file = path.join(dir, MOTION_TEMPLATE_FILE)
  const template = parseMotionTemplate(JSON.parse(fs.readFileSync(file, 'utf8')))
  const thumbnail = path.join(dir, MOTION_TEMPLATE_THUMBNAIL)
  return { template, dir, thumbnail: fs.existsSync(thumbnail) ? thumbnail : null }
}

/** Template folder names in the library (dot-folders are temporaries). */
function templateDirNames(root) {
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
}

function tryReadTemplateDir(root, name) {
  try {
    return { entry: readTemplateDir(path.join(root, name)) }
  } catch (error) {
    return { problem: `${name}: ${error.message}` }
  }
}

/** Every readable template in the library (unreadable ones are reported, not thrown). */
export function listTemplates(workspace) {
  const root = templatesRoot(workspace)
  const read = templateDirNames(root).map((name) => tryReadTemplateDir(root, name))
  const entries = read.flatMap((result) => (result.entry ? [result.entry] : []))
  entries.sort((a, b) => a.template.name.localeCompare(b.template.name))
  return { entries, problems: read.flatMap((result) => result.problem ?? []) }
}

/** A library template by id or name; 404 with the names there are. */
export function resolveTemplate(workspace, ref) {
  const { entries } = listTemplates(workspace)
  let found
  try {
    found = findMotionTemplate(
      entries.map((entry) => entry.template),
      String(ref),
    )
  } catch (error) {
    throw new HttpError(409, 'TEMPLATE_AMBIGUOUS', error.message)
  }
  if (!found) {
    const names = entries.map((entry) => `"${entry.template.name}"`).join(', ')
    throw new HttpError(
      404,
      'TEMPLATE_NOT_FOUND',
      `No template "${ref}" in ${templatesRoot(workspace)}. ${names ? `Templates: ${names}` : 'The library is empty'} (shred templates list)`,
    )
  }
  return entries.find((entry) => entry.template.id === found.id)
}

/** Media the template uses that this workspace does not have (`hasMedia(id)` says). */
export function missingTemplateMedia(template, hasMedia) {
  return template.media.filter((ref) => !hasMedia(ref.mediaId))
}

function assertTemplateMedia(template, hasMedia) {
  const missing = missingTemplateMedia(template, hasMedia)
  if (missing.length === 0) return
  const files = missing.map((ref) => `${ref.fileName} (${ref.mediaId})`).join(', ')
  throw new HttpError(
    409,
    'TEMPLATE_MEDIA_MISSING',
    `Template "${template.name}" uses media this workspace does not have: ${files}. Import its template pack (shred templates import) or import those files again.`,
  )
}

/** The templates addTemplate/updateTemplate ops name, for the edit input (media checked). */
export function collectTemplateInputs(workspace, ops, hasMedia) {
  const refs = [...new Set(ops.filter((op) => TEMPLATE_OPS.has(op.op)).map((op) => op.template))]
  const byId = new Map()
  for (const ref of refs) {
    const { template } = resolveTemplate(workspace, ref)
    assertTemplateMedia(template, hasMedia)
    byId.set(template.id, template)
  }
  return [...byId.values()]
}

function writeFileAtomic(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${crypto.randomUUID()}.tmp`,
  )
  try {
    fs.writeFileSync(tmp, bytes)
    fs.renameSync(tmp, target)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

/** Write a template (and its thumbnail) into the library; each file lands atomically. */
export function writeTemplate(workspace, template, thumbnail) {
  const dir = templateDir(workspace, template.id)
  if (thumbnail) writeFileAtomic(path.join(dir, MOTION_TEMPLATE_THUMBNAIL), thumbnail)
  writeFileAtomic(path.join(dir, MOTION_TEMPLATE_FILE), `${JSON.stringify(template, null, 2)}\n`)
  return dir
}

const projectCompositions = (project) => project.timeline?.compositions ?? []

/** The composition id a composition item (top level or nested) points at. */
function itemCompositionId(project, ref) {
  const nested = projectCompositions(project).flatMap((c) => c.items ?? [])
  return [...(project.timeline?.items ?? []), ...nested].find(
    (candidate) => candidate.id === ref && candidate.compositionId,
  )?.compositionId
}

const compositionNotFound = (project, ref) =>
  new HttpError(
    404,
    'COMPOSITION_NOT_FOUND',
    `"${ref}" is neither a composition nor a composition item in ${project.name ?? project.id}`,
  )

/** The composition a ref names: a composition id, or a composition item. */
function findProjectComposition(project, ref) {
  const compositions = projectCompositions(project)
  const id = compositions.some((c) => c.id === ref) ? ref : itemCompositionId(project, ref)
  const composition = compositions.find((c) => c.id === id)
  if (!composition) throw compositionNotFound(project, ref)
  return composition
}

/**
 * Build a template from a project's composition. A library template with the same
 * name gets a new version (same id); otherwise it is a new template.
 */
export function buildTemplateFromProject(
  workspace,
  project,
  ref,
  { name, category, role },
  mediaFileName = (mediaId) => mediaId,
) {
  const composition = findProjectComposition(project, ref)
  const templateName = name ?? composition.name
  const { entries } = listTemplates(workspace)
  const previous = findMotionTemplate(
    entries.map((entry) => entry.template),
    templateName,
  )
  return buildMotionTemplate({
    rootCompositionId: composition.id,
    compositions: project.timeline.compositions,
    name: templateName,
    category,
    role,
    previous,
    mediaFileName,
  })
}

/**
 * A one-item project showing the template on its own canvas, for rendering its
 * thumbnail with the frame renderer.
 */
export function templatePreviewProject(template) {
  const trackId = 'template-preview-track'
  return {
    id: `template-preview-${template.id}`,
    name: template.name,
    description: '',
    createdAt: template.updatedAt,
    updatedAt: template.updatedAt,
    duration: template.durationInFrames / template.fps,
    metadata: { width: template.width, height: template.height, fps: template.fps },
    timeline: {
      tracks: [
        {
          id: trackId,
          name: 'V1',
          kind: 'video',
          height: 60,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
        },
      ],
      items: [
        {
          id: 'template-preview-item',
          type: 'composition',
          trackId,
          from: 0,
          durationInFrames: template.durationInFrames,
          label: template.name,
          compositionId: template.composition.id,
          compositionWidth: template.width,
          compositionHeight: template.height,
          transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
          sourceStart: 0,
          sourceEnd: template.durationInFrames,
          sourceDuration: template.durationInFrames,
          sourceFps: template.fps,
          speed: 1,
        },
      ],
      compositions: [template.composition, ...template.subCompositions],
    },
  }
}

function fileStamp(file) {
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  return stat ? `${Math.round(stat.mtimeMs)}:${stat.size}` : '-'
}

/** Stamp that changes whenever a template is added, removed or rewritten (editor polling). */
export function templateLibraryStamp(workspace) {
  const root = templatesRoot(workspace)
  if (!fs.existsSync(root)) return 'empty'
  const parts = templateDirNames(root).flatMap((name) =>
    [MOTION_TEMPLATE_FILE, MOTION_TEMPLATE_THUMBNAIL].map(
      (file) => `${name}/${file}:${fileStamp(path.join(root, name, file))}`,
    ),
  )
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex')
}

/** Every media id in a template, for rewriting after import. */
export function remapTemplateMedia(template, idMap) {
  const swap = (composition) => ({
    ...composition,
    items: composition.items.map((item) =>
      item.mediaId && idMap.has(item.mediaId)
        ? { ...item, mediaId: idMap.get(item.mediaId) }
        : item,
    ),
  })
  return {
    ...template,
    composition: swap(template.composition),
    subCompositions: template.subCompositions.map(swap),
    media: template.media.map((ref) => ({
      ...ref,
      mediaId: idMap.get(ref.mediaId) ?? ref.mediaId,
    })),
  }
}
