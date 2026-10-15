// `shred motion library|show|save|clone|export|import`: the workspace's motion
// graphics template library
// (<workspace>/app/templates/<id>/). A template has one variant per aspect ratio
// (9:16, 16:9, ...). library, show, save (a project's composition becomes the variant
// for its aspect), clone (a new aspect's variant from an existing one), export (a
// template pack: template.json, thumbnails and the media it uses) and import
// (brings the media in through the normal import path).
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
  formatTemplateHold,
  MOTION_TEMPLATE_CATEGORIES,
  MOTION_TEMPLATE_FILE,
  parseMotionTemplate,
  parseTemplateHold,
  templateAspects,
  templateVariant,
} from '../../../src/shared/motion-templates/template-core.mjs'
import {
  cloneSourceAspect,
  cloneTemplateVariant,
} from '../../../src/shared/motion-templates/template-variants.mjs'
import { canvasForAspect, parseAspect } from '../../../src/shared/projects/aspect.mjs'

const THUMBNAIL_EDGE = 480
const workspaceHas = (workspace) => (mediaId) => {
  try {
    return Boolean(resolveMediaFile(workspace, mediaId))
  } catch {
    return false
  }
}
const seconds = (variant) => (variant.durationInFrames / variant.fps).toFixed(2)
const holdText = (variant) => (variant.hold ? `, hold ${formatTemplateHold(variant.hold)}` : '')
const variantLine = (variant) =>
  `${variant.aspect} ${variant.width}x${variant.height} @${variant.fps} ${variant.durationInFrames}f (${seconds(variant)}s${holdText(variant)}) v${variant.version}`
const variantsOf = (template) => templateAspects(template).map((a) => template.variants[a])
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
        shown.map(({ template, dir, thumbnails }) => ({ ...summary(template), dir, thumbnails })),
        null,
        2,
      ),
    )
  if (!shown.length)
    ctx.say(`No templates${category ? ` in ${category}` : ''} in ${templatesRoot(ctx.workspace)}.`)
  for (const { template } of shown) {
    ctx.say(
      `${template.name}  [${template.category}${template.role ? `, role ${template.role}` : ''}]  v${template.version}  ${template.id}`,
    )
    for (const variant of variantsOf(template)) ctx.say(`    ${variantLine(variant)}`)
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
  aspects: templateAspects(template),
  variants: variantsOf(template).map((variant) => ({
    aspect: variant.aspect,
    version: variant.version,
    width: variant.width,
    height: variant.height,
    fps: variant.fps,
    durationInFrames: variant.durationInFrames,
    hold: variant.hold ?? null,
  })),
  controls: template.controls,
  media: template.media,
})

function show(ctx, ref) {
  if (!ref) throw new Error('Usage: shred motion show <name|id>')
  const { template, dir, thumbnails } = resolveTemplate(ctx.workspace, ref)
  const missing = new Set(
    missingTemplateMedia(template, workspaceHas(ctx.workspace)).map((m) => m.mediaId),
  )
  if (ctx.opt.json)
    return ctx.say(
      JSON.stringify(
        { ...summary(template), dir, thumbnails, missingMedia: [...missing] },
        null,
        2,
      ),
    )
  ctx.say(`${template.name}  v${template.version}  (${template.id})`)
  ctx.say(`category   ${template.category}${template.role ? `, fills role ${template.role}` : ''}`)
  ctx.say('versions (addTemplate uses the one matching the project aspect ratio):')
  for (const variant of variantsOf(template))
    ctx.say(
      `  ${variantLine(variant)}${thumbnails[variant.aspect] ? `  ${thumbnails[variant.aspect]}` : ''}`,
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
  ctx.say(`folder     ${dir}`)
}

/** The hold frame when there is one (the template fully in), else the middle. */
const thumbnailFrame = (variant) =>
  variant.hold ? variant.hold.start : Math.floor(variant.durationInFrames / 2)

/** A transparent WebP of one variant (shown on a checkerboard), or null when the service is down. */
async function renderThumbnail(ctx, template, aspect) {
  const variant = templateVariant(template, aspect)
  const scale = THUMBNAIL_EDGE / Math.max(variant.width, variant.height)
  try {
    return await ctx.call('POST', '/frame', {
      projectObject: templatePreviewProject(variant),
      frame: thumbnailFrame(variant),
      width: Math.max(16, Math.round(variant.width * scale)),
      height: Math.max(16, Math.round(variant.height * scale)),
      format: 'webp',
    })
  } catch (error) {
    ctx.say(`warning: no thumbnail (${error.message}); is the service up? (shred start)`)
    return null
  }
}

async function save(ctx, projectId, ref) {
  if (!projectId || !ref)
    throw new Error(
      'Usage: shred motion save <projectId> <compositionItemId|compositionId> --name "..." --category <c> [--role r] [--hold <frame|start-end|none>]',
    )
  await ctx.warnUnsaved(projectId)
  const { project } = await ctx.getProject(projectId)
  const template = buildTemplateFromProject(
    ctx.workspace,
    project,
    ref,
    {
      name: ctx.opt.name,
      category: ctx.opt.category,
      role: ctx.opt.role,
      hold: ctx.opt.hold === undefined ? undefined : parseTemplateHold(ctx.opt.hold),
    },
    (mediaId) => readMediaMetadata(ctx.workspace, mediaId)?.fileName ?? mediaId,
  )
  const aspect = savedAspect(template)
  const thumbnail = await renderThumbnail(ctx, template, aspect)
  const dir = writeTemplate(ctx.workspace, template, { [aspect]: thumbnail })
  ctx.say(
    `${template.version > 1 ? 'new version' : 'saved'}  ${template.name}  v${template.version}  (${template.id})`,
  )
  ctx.say(`variant   ${variantLine(template.variants[aspect])}`)
  ctx.say(`versions  ${templateAspects(template).join(', ')}`)
  ctx.say(`controls  ${describeControls(template)}`)
  ctx.say(`folder    ${dir}`)
  if (!template.controls.length)
    ctx.say(
      'note: no controls, so every instance looks the same (setCompositionControls, then save again)',
    )
}

/** The variant a save wrote: the one saved in the template's newest version. */
function savedAspect(template) {
  return variantsOf(template).find((variant) => variant.version === template.version).aspect
}

function cloneCanvas(ctx, template, aspect, from) {
  if (ctx.opt.size) {
    const [width, height] = String(ctx.opt.size).split('x').map(Number)
    if (!(width > 0) || !(height > 0)) throw new Error(`--size "${ctx.opt.size}" must be WxH`)
    return { width, height }
  }
  const source = template.variants[from]
  return canvasForAspect(aspect, Math.min(source.width, source.height))
}

/**
 * A variant for another aspect ratio, copied from an existing one and re-laid
 * for the new canvas (items keep their nearest edge, sizes follow the short
 * side): a starting point to adjust in a project of that aspect, then save.
 */
async function clone(ctx, ref) {
  if (!ref || !ctx.opt.aspect)
    throw new Error(
      'Usage: shred motion clone <name|id> --aspect <9:16|16:9|1:1|4:5|W:H> [--from <aspect>] [--size WxH]',
    )
  const { template } = resolveTemplate(ctx.workspace, ref)
  const aspect = parseAspect(ctx.opt.aspect)
  if (template.variants[aspect])
    throw new Error(`"${template.name}" already has a ${aspect} version`)
  const from = cloneSourceAspect(
    template,
    aspect,
    ctx.opt.from ? parseAspect(ctx.opt.from) : undefined,
  )
  const result = cloneTemplateVariant(template, {
    aspect,
    from,
    canvas: cloneCanvas(ctx, template, aspect, from),
  })
  const thumbnail = await renderThumbnail(ctx, result.template, aspect)
  const dir = writeTemplate(ctx.workspace, result.template, { [aspect]: thumbnail })
  ctx.say(`cloned   ${template.name} ${from} -> ${variantLine(result.template.variants[aspect])}`)
  ctx.say(`versions ${templateAspects(result.template).join(', ')}`)
  ctx.say(`folder   ${dir}`)
  ctx.say(
    `next     addTemplate "${template.name}" in a ${aspect} project, adjust its composition with the usual ops, then shred motion save <projectId> <instanceId>`,
  )
}

function copyPreservingTime(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  const stat = fs.statSync(from)
  fs.utimesSync(to, stat.atime, stat.mtime)
}

function writePack(ctx, entry, packDir) {
  const { template, thumbnails } = entry
  fs.mkdirSync(packDir, { recursive: true })
  fs.writeFileSync(
    path.join(packDir, MOTION_TEMPLATE_FILE),
    `${JSON.stringify(template, null, 2)}\n`,
  )
  for (const file of Object.values(thumbnails).filter(Boolean))
    fs.copyFileSync(file, path.join(packDir, path.basename(file)))
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
    throw new Error('Usage: shred motion export <name|id> --out <dir|file.zip>')
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

/** The pack's thumbnail bytes by aspect (variants without one are left out). */
function packThumbnails(packDir, template) {
  const out = {}
  for (const [aspect, variant] of Object.entries(template.variants)) {
    const file = variant.thumbnail ? path.join(packDir, path.basename(variant.thumbnail)) : null
    if (file && fs.existsSync(file)) out[aspect] = fs.readFileSync(file)
  }
  return out
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
  writeTemplate(ctx.workspace, template, packThumbnails(packDir, template))
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
  if (!source) throw new Error('Usage: shred motion import <dir|file.zip>')
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
  clone: (ctx, [ref]) => clone(ctx, ref),
  export: (ctx, [ref]) => exportPack(ctx, ref),
  import: (ctx, [source]) => importPack(ctx, source),
}

/** The library commands `shred motion` takes (`library` lists it). */
export const LIBRARY_COMMANDS = ['library', 'show', 'save', 'clone', 'export', 'import']

export async function templatesCommand([sub = 'library', ...rest], ctx) {
  const name = sub === 'library' ? 'list' : sub
  const run = Object.hasOwn(SUBCOMMANDS, name) ? SUBCOMMANDS[name] : null
  if (!run)
    throw new Error(
      `Unknown motion library command "${sub}" (${LIBRARY_COMMANDS.join(', ')})`,
    )
  return run(ctx, rest)
}
