// `shred templates`: the workspace's motion graphics template library
// (<workspace>/app/templates/<id>/). list, show, save (from a project's
// composition), export (a template pack: template.json, thumbnail and the media it
// uses) and import (brings the media in through the normal import path).
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildTemplateFromProject,
  listTemplates,
  missingTemplateMedia,
  remapTemplateMedia,
  resolveTemplate,
  templatePreviewProject,
  templatesRoot,
  writeTemplate,
} from '../../../headless/lib/templates.mjs'
import { readMediaMetadata, resolveMediaFile } from '../../../headless/lib/workspace.mjs'
import {
  findMotionTemplate,
  MOTION_TEMPLATE_CATEGORIES,
  MOTION_TEMPLATE_FILE,
  MOTION_TEMPLATE_THUMBNAIL,
  parseMotionTemplate,
} from '../../../src/shared/motion-templates/template-core.mjs'

const THUMBNAIL_EDGE = 480
const workspaceHas = (workspace) => (mediaId) => {
  try {
    return Boolean(resolveMediaFile(workspace, mediaId))
  } catch {
    return false
  }
}
const seconds = (template) => (template.durationInFrames / template.fps).toFixed(2)
const slugOf = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'template'

function describeControls(template) {
  if (!template.controls.length) return 'no controls'
  return template.controls
    .map((control) => `${control.name} (${control.kind}) = ${JSON.stringify(control.defaultValue)}`)
    .join('; ')
}

function list(ctx) {
  const category = ctx.opt.category
  if (category && !MOTION_TEMPLATE_CATEGORIES.includes(category))
    throw new Error(`--category must be one of ${MOTION_TEMPLATE_CATEGORIES.join(', ')}`)
  const { entries, problems } = listTemplates(ctx.workspace)
  const shown = entries.filter((entry) => !category || entry.template.category === category)
  if (ctx.opt.json)
    return ctx.say(
      JSON.stringify(
        shown.map(({ template, dir, thumbnail }) => ({ ...summary(template), dir, thumbnail })),
        null,
        2,
      ),
    )
  if (!shown.length)
    ctx.say(`No templates${category ? ` in ${category}` : ''} in ${templatesRoot(ctx.workspace)}.`)
  for (const { template } of shown) {
    ctx.say(
      `${template.name}  [${template.category}${template.role ? `, role ${template.role}` : ''}]  ${template.width}x${template.height} @${template.fps}  ${template.durationInFrames} frames (${seconds(template)}s)  v${template.version}  ${template.id}`,
    )
    ctx.say(`    controls: ${describeControls(template)}`)
  }
  for (const problem of problems) ctx.say(`unreadable template: ${problem}`)
}

const summary = (template) => ({
  id: template.id,
  name: template.name,
  category: template.category,
  role: template.role ?? null,
  version: template.version,
  width: template.width,
  height: template.height,
  fps: template.fps,
  durationInFrames: template.durationInFrames,
  controls: template.controls.map(({ name, kind, property, defaultValue }) => ({
    name,
    kind,
    property,
    defaultValue,
  })),
  media: template.media,
})

function show(ctx, ref) {
  if (!ref) throw new Error('Usage: shred templates show <name|id>')
  const { template, dir, thumbnail } = resolveTemplate(ctx.workspace, ref)
  const missing = new Set(
    missingTemplateMedia(template, workspaceHas(ctx.workspace)).map((m) => m.mediaId),
  )
  if (ctx.opt.json)
    return ctx.say(
      JSON.stringify({ ...summary(template), dir, thumbnail, missingMedia: [...missing] }, null, 2),
    )
  ctx.say(`${template.name}  v${template.version}  (${template.id})`)
  ctx.say(`category   ${template.category}${template.role ? `, fills role ${template.role}` : ''}`)
  ctx.say(
    `canvas     ${template.width}x${template.height} @${template.fps}, ${template.durationInFrames} frames (${seconds(template)}s)`,
  )
  ctx.say(`updated    ${new Date(template.updatedAt).toISOString()}`)
  ctx.say('controls (addTemplate/setTemplateControls take these names):')
  for (const c of template.controls)
    ctx.say(
      `  ${c.name.padEnd(20)} ${c.kind.padEnd(6)} ${c.property.padEnd(18)} default ${JSON.stringify(c.defaultValue)}`,
    )
  if (!template.controls.length) ctx.say('  (none: every instance looks the same)')
  ctx.say(
    `media      ${template.media.length ? template.media.map((m) => `${m.fileName}${missing.has(m.mediaId) ? ' (MISSING)' : ''}`).join(', ') : 'none'}`,
  )
  ctx.say(`nested     ${template.subCompositions.length} sub-composition(s)`)
  ctx.say(`folder     ${dir}`)
  if (thumbnail) ctx.say(`thumbnail  ${thumbnail}`)
}

async function renderThumbnail(ctx, template) {
  const scale = THUMBNAIL_EDGE / Math.max(template.width, template.height)
  try {
    return await ctx.call('POST', '/frame', {
      projectObject: templatePreviewProject(template),
      frame: Math.floor(template.durationInFrames / 2),
      width: Math.max(16, Math.round(template.width * scale)),
      height: Math.max(16, Math.round(template.height * scale)),
      format: 'jpeg',
    })
  } catch (error) {
    ctx.say(`warning: no thumbnail (${error.message}); is the service up? (shred start)`)
    return null
  }
}

async function save(ctx, projectId, ref) {
  if (!projectId || !ref)
    throw new Error(
      'Usage: shred templates save <projectId> <compositionItemId|compositionId> --name "..." --category <c> [--role r]',
    )
  await ctx.warnUnsaved(projectId)
  const { project } = await ctx.getProject(projectId)
  const template = buildTemplateFromProject(
    ctx.workspace,
    project,
    ref,
    { name: ctx.opt.name, category: ctx.opt.category ?? 'other', role: ctx.opt.role },
    (mediaId) => readMediaMetadata(ctx.workspace, mediaId)?.fileName ?? mediaId,
  )
  const thumbnail = await renderThumbnail(ctx, template)
  const dir = writeTemplate(ctx.workspace, template, thumbnail)
  ctx.say(
    `${template.version > 1 ? 'new version' : 'saved'}  ${template.name}  v${template.version}  (${template.id})`,
  )
  ctx.say(`controls  ${describeControls(template)}`)
  ctx.say(`folder    ${dir}`)
  if (!template.controls.length)
    ctx.say(
      'note: no controls, so every instance looks the same (setCompositionControls, then save again)',
    )
}

function copyPreservingTime(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  const stat = fs.statSync(from)
  fs.utimesSync(to, stat.atime, stat.mtime)
}

function writePack(ctx, entry, packDir) {
  const { template, thumbnail } = entry
  fs.mkdirSync(packDir, { recursive: true })
  fs.writeFileSync(
    path.join(packDir, MOTION_TEMPLATE_FILE),
    `${JSON.stringify(template, null, 2)}\n`,
  )
  if (thumbnail) fs.copyFileSync(thumbnail, path.join(packDir, MOTION_TEMPLATE_THUMBNAIL))
  for (const ref of template.media) {
    const source = resolveMediaFile(ctx.workspace, ref.mediaId, { original: true })
    if (!source)
      throw new Error(
        `${ref.fileName} (${ref.mediaId}) is missing from the workspace; cannot export it`,
      )
    copyPreservingTime(
      source,
      path.join(packDir, 'media', ref.mediaId, path.basename(ref.fileName)),
    )
  }
}

function exportPack(ctx, ref) {
  if (!ref || !ctx.opt.out)
    throw new Error('Usage: shred templates export <name|id> --out <dir|file.zip>')
  const entry = resolveTemplate(ctx.workspace, ref)
  const out = path.resolve(ctx.opt.out)
  const slug = slugOf(entry.template.name)
  if (!out.endsWith('.zip')) {
    writePack(ctx, entry, path.join(out, slug))
    return ctx.say(path.join(out, slug))
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const staging = fs.mkdtempSync(path.join(path.dirname(out), '.template-pack-'))
  try {
    writePack(ctx, entry, path.join(staging, slug))
    fs.rmSync(out, { force: true })
    execFileSync('zip', ['-qr', out, slug], { cwd: staging })
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
  ctx.say(out)
}

function packTemplateDirs(dir) {
  if (fs.existsSync(path.join(dir, MOTION_TEMPLATE_FILE))) return [dir]
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, MOTION_TEMPLATE_FILE)),
    )
    .map((entry) => path.join(dir, entry.name))
}

function packMediaFile(packDir, ref) {
  const dir = path.join(packDir, 'media', path.basename(ref.mediaId))
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((name) => !name.startsWith('.')) : null
  if (!file) throw new Error(`the pack has no file for ${ref.fileName} (${ref.mediaId})`)
  return path.join(dir, file)
}

/** Import the media the workspace lacks; returns old id -> new id and how each landed. */
async function importPackMedia(ctx, packDir, template) {
  const has = workspaceHas(ctx.workspace)
  const needed = template.media.filter((ref) => !has(ref.mediaId))
  if (!needed.length) return { idMap: new Map(), linked: false }
  const { importMediaByPath } = await import('../../../server/media-bridge.mjs')
  const results = await importMediaByPath(
    ctx.workspace,
    needed.map((ref) => packMediaFile(packDir, ref)),
    {
      mode: 'auto',
      prepare: 'wait',
    },
  )
  const failed = results.filter((result) => result.error)
  if (failed.length)
    throw new Error(
      `media import failed: ${failed.map((r) => `${r.sourcePath}: ${r.error.message}`).join('; ')}`,
    )
  const idMap = new Map(needed.map((ref, index) => [ref.mediaId, results[index].id]))
  for (const [index, ref] of needed.entries())
    ctx.say(
      `  media  ${ref.fileName} -> ${results[index].id}${results[index].duplicate ? ' (already imported)' : ''}`,
    )
  return { idMap, linked: results.some((result) => result.method === 'link') }
}

function uniqueName(ctx, template) {
  const { entries } = listTemplates(ctx.workspace)
  const clash = findMotionTemplate(
    entries.map((entry) => entry.template),
    template.name,
  )
  return clash && clash.id !== template.id ? `${template.name} (imported)` : template.name
}

async function importOne(ctx, packDir) {
  const parsed = parseMotionTemplate(
    JSON.parse(fs.readFileSync(path.join(packDir, MOTION_TEMPLATE_FILE), 'utf8')),
  )
  const current = listTemplates(ctx.workspace).entries.find(
    (entry) => entry.template.id === parsed.id,
  )
  if (current && current.template.version >= parsed.version) {
    ctx.say(
      `kept     ${current.template.name} v${current.template.version} (the pack has v${parsed.version})`,
    )
    return false
  }
  const { idMap, linked } = await importPackMedia(ctx, packDir, parsed)
  const template = { ...remapTemplateMedia(parsed, idMap), name: uniqueName(ctx, parsed) }
  const thumbnailFile = path.join(packDir, MOTION_TEMPLATE_THUMBNAIL)
  writeTemplate(
    ctx.workspace,
    template,
    fs.existsSync(thumbnailFile) ? fs.readFileSync(thumbnailFile) : null,
  )
  ctx.say(`imported ${template.name} v${template.version} (${template.id})`)
  return linked
}

function extractZip(ctx, file) {
  const dir = path.join(
    ctx.workspace,
    'app',
    'template-packs',
    `${slugOf(path.parse(file).name)}-${crypto.randomUUID().slice(0, 8)}`,
  )
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('unzip', ['-q', file, '-d', dir])
  return dir
}

async function importPack(ctx, source) {
  if (!source) throw new Error('Usage: shred templates import <dir|file.zip>')
  const full = path.resolve(source)
  if (!fs.existsSync(full)) throw new Error(`${full} does not exist`)
  const zipped = full.endsWith('.zip')
  const dir = zipped ? extractZip(ctx, full) : full
  const dirs = packTemplateDirs(dir)
  if (!dirs.length) throw new Error(`No ${MOTION_TEMPLATE_FILE} in ${full}`)
  let linked = false
  for (const packDir of dirs) linked = (await importOne(ctx, packDir)) || linked
  // Imported media is cloned into the workspace; a linked one still reads the pack.
  if (zipped && !linked) {
    fs.rmSync(dir, { recursive: true, force: true })
    if (!fs.readdirSync(path.dirname(dir)).length) fs.rmdirSync(path.dirname(dir))
  } else if (zipped) ctx.say(`kept the unpacked files in ${dir}: some media links to them`)
}

const SUBCOMMANDS = {
  list: (ctx) => list(ctx),
  show: (ctx, [ref]) => show(ctx, ref),
  save: (ctx, [projectId, ref]) => save(ctx, projectId, ref),
  export: (ctx, [ref]) => exportPack(ctx, ref),
  import: (ctx, [source]) => importPack(ctx, source),
}

export async function templatesCommand([sub = 'list', ...rest], ctx) {
  const run = Object.hasOwn(SUBCOMMANDS, sub) ? SUBCOMMANDS[sub] : null
  if (!run) throw new Error(`Unknown templates command "${sub}" (list, show, save, export, import)`)
  return run(ctx, rest)
}
