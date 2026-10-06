// `shred styles`: the text style library (<workspace>/app/text-styles.json)
// and a project's copies of it. Writes to the library are atomic and re-read
// the file first; the editor re-reads it when it changes. Project changes go
// through the edit service (upsertTextStyle), so they restyle linked items.
//
// A style has one variant (look) per aspect ratio; a project uses the one for
// its aspect. `clone` makes a variant for another aspect from the closest.
import fs from 'node:fs'
import path from 'node:path'
import {
  findStyle,
  mergeStyles,
  readTextStyleLibrary,
  textStylePackSchema,
  updateTextStyleLibrary,
} from '../../../headless/lib/text-styles.mjs'
import { aspectKey, parseAspect } from '../../../src/shared/projects/aspect.mjs'
import {
  addClonedTextStyleVariant,
  textStyleAspects,
  textStyleVariantFor,
  toTextStyleFamily,
} from '../../../src/shared/typography/text-styles/text-style-family.mjs'

const PACK_KIND = 'shreditor-text-styles'

/** Same look, layout and rules (version and time aside). */
function sameStyle(a, b) {
  const stable = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    if (value && typeof value === 'object')
      return `{${Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
        .join(',')}}`
    return JSON.stringify(value)
  }
  const strip = ({ version: _v, updatedAt: _u, ...rest }) => stable(rest)
  return strip(a) === strip(b)
}

/** One variant in a line: font, size on its reference canvas, colours, position, rules. */
function variantSummary(variant) {
  const s = variant.style ?? {}
  const parts = [
    s.fontFamily,
    s.fontWeight && s.fontWeight !== 'normal' ? s.fontWeight : null,
    s.fontSize ? `${s.fontSize}px` : null,
    s.color,
    s.backgroundColor ? `bg ${s.backgroundColor}` : null,
    s.stroke ? `stroke ${s.stroke.width} ${s.stroke.color}` : null,
    variant.layout?.yRatio !== undefined ? `y ${variant.layout.yRatio}` : null,
    variant.textMotion ? `motion ${Object.keys(variant.textMotion).join('/')}` : null,
    variant.caption
      ? `${variant.caption.maxWordsPerChunk} words, ${variant.caption.maxLines}x${variant.caption.maxCharsPerLine} chars`
      : null,
  ]
  return `${variant.aspect}: ${parts.filter(Boolean).join(', ')}`
}

const summary = (style) => style.variants.map(variantSummary).join(' | ')

const projectAspect = (project) =>
  aspectKey(project.metadata?.width || 1920, project.metadata?.height || 1080)

/** A project's styles as families (an old single-look copy is the project's aspect). */
const projectStyles = (project) =>
  (project.timeline?.textStyles ?? []).map((style) =>
    toTextStyleFamily(style, projectAspect(project)),
  )

/** `style` with only the versions (aspects) `source` has. */
const onlyAspectsOf = (source, style) => ({
  ...style,
  variants: style.variants.filter((variant) => textStyleVariantFor(source, variant.aspect)),
})

const cloneHint = (style, aspect, projectId) =>
  `no ${aspect} version: shred styles clone ${style.id} --aspect ${aspect}${projectId ? ` --project ${projectId}` : ''}`

function readPack(file) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  const pack = Array.isArray(raw)
    ? { kind: PACK_KIND, version: 1, styles: raw }
    : raw.kind
      ? raw
      : { kind: PACK_KIND, version: 1, styles: [raw] }
  const parsed = textStylePackSchema.safeParse(pack)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`${file}: ${issue?.path.join('.') || 'pack'}: ${issue?.message ?? 'invalid'}`)
  }
  return parsed.data
}

export function stylesCommands({ say, opt, workspace, getProject, applyBatch }) {
  const library = () => readTextStyleLibrary(workspace())
  const libraryStyle = (name) => {
    const style = findStyle(library(), name)
    if (!style) throw new Error(`No style "${name}" in the library (shred styles list)`)
    return style
  }

  const listProject = async (id) => {
    const { project } = await getProject(id)
    const own = projectStyles(project)
    const items = project.timeline?.items ?? []
    if (opt.json) return say(JSON.stringify(own, null, 2))
    const aspect = projectAspect(project)
    say(`Project ${id} (${aspect}): ${own.length} style${own.length === 1 ? '' : 's'}`)
    const lib = library()
    for (const style of own) {
      const used = items.filter((item) => item.textStyleId === style.id).length
      const source = findStyle(lib, style.id)
      const state = !source
        ? 'project only'
        : sameStyle(source, style)
          ? 'same as library'
          : sameStyle(source, onlyAspectsOf(source, style))
            ? `has versions the library lacks (the editor's Save to library, or shred styles save from an item, adds them)`
            : `differs from library v${source.version} (shred styles use ${id} ${style.id} takes the library's)`
      const fits = textStyleVariantFor(style, aspect) ? '' : `  ${cloneHint(style, aspect, id)}`
      say(
        `  ${style.id.padEnd(22)} ${style.role.padEnd(11)} v${style.version}  [${textStyleAspects(style).join(', ')}]  ${used} item(s)  ${state}${fits}`,
      )
    }
  }

  return {
    async list() {
      if (opt.project) return listProject(opt.project)
      const styles = library()
      if (opt.json) return say(JSON.stringify(styles, null, 2))
      if (!styles.length)
        return say(
          'The text style library is empty (shred styles import <kit.json>, or save one from an item).',
        )
      for (const style of styles)
        say(
          `${style.id.padEnd(22)} ${style.role.padEnd(11)} v${style.version}  ${style.name}  [${textStyleAspects(style).join(', ')}]  (${summary(style)})`,
        )
    },

    async show([name]) {
      if (!name) throw new Error('Usage: shred styles show <name|id> [--project <id>]')
      const style = opt.project
        ? findStyle(projectStyles((await getProject(opt.project)).project), name)
        : libraryStyle(name)
      if (!style) throw new Error(`No style "${name}" in project ${opt.project}`)
      say(JSON.stringify(style, null, 2))
    },

    /** Copy library styles into a project; a copy already there takes the library's look. */
    async use([id, ...names]) {
      if (!id || !names.length) throw new Error('Usage: shred styles use <projectId> <name|id...>')
      const styles = names.map(libraryStyle)
      const { project, revision } = await getProject(id)
      const aspect = projectAspect(project)
      const res = await applyBatch(
        id,
        styles.map((style) => ({ op: 'upsertTextStyle', style })),
        revision,
      )
      for (const result of res.results ?? []) {
        const style = result.detail.style
        const fits = style && !textStyleVariantFor(style, aspect)
        say(
          `  ${result.detail.styleId} v${result.detail.version}: restyled ${result.detail.updatedItems.length} item(s)${fits ? `  (${cloneHint(style, aspect, id)})` : ''}`,
        )
      }
    },

    /** Save an item's look as a style, in the project (linking the item) and the library. */
    async save([id, itemId]) {
      if (!id || !itemId || !opt.name || !opt.role)
        throw new Error(
          'Usage: shred styles save <projectId> <itemId> --name "..." --role title|caption|label|lower-third|other',
        )
      const { revision } = await getProject(id)
      const res = await applyBatch(
        id,
        [{ op: 'upsertTextStyle', fromItemId: itemId, name: opt.name, role: opt.role }],
        revision,
      )
      const style = res.results?.[0]?.detail?.style
      if (!style) throw new Error('The service did not return the saved style')
      updateTextStyleLibrary(workspace(), (styles) => mergeStyles(styles, [style]))
      say(`Saved "${style.name}" as ${style.id} in ${id} and the library (${summary(style)})`)
    },

    /**
     * Add a variant for another aspect, cloned from the closest one (or
     * --from): to the library, or with --project to that project's copy (the
     * library's style when the project has none yet) and the library too.
     */
    async clone([name]) {
      if (!name || !opt.aspect)
        throw new Error(
          'Usage: shred styles clone <name|id> --aspect 16:9 [--from 9:16] [--project <id>]',
        )
      const aspect = parseAspect(opt.aspect)
      const from = opt.from ? parseAspect(opt.from) : undefined
      if (!opt.project) {
        const source = libraryStyle(name)
        const { style, from: used } = addClonedTextStyleVariant(source, aspect, from)
        updateTextStyleLibrary(workspace(), (styles) => mergeStyles(styles, [style]))
        return say(
          `Added a ${aspect} version of "${source.name}" (from ${used}) to the library: ${variantSummary(textStyleVariantFor(style, aspect))}`,
        )
      }
      const { project, revision } = await getProject(opt.project)
      const source = findStyle(projectStyles(project), name) ?? libraryStyle(name)
      const { style, from: used } = addClonedTextStyleVariant(source, aspect, from)
      const res = await applyBatch(opt.project, [{ op: 'upsertTextStyle', style }], revision)
      const variant = textStyleVariantFor(style, aspect)
      // The library gets the new look too, when it has the style without one.
      const libraryCopy = findStyle(library(), style.id)
      const toLibrary = libraryCopy && !textStyleVariantFor(libraryCopy, aspect)
      if (toLibrary)
        updateTextStyleLibrary(workspace(), (styles) =>
          mergeStyles(styles, [{ ...libraryCopy, variants: [variant] }]),
        )
      const restyled = res.results?.[0]?.detail?.updatedItems?.length ?? 0
      say(
        `Added a ${aspect} version of "${source.name}" (from ${used}) in ${opt.project}${toLibrary ? ' and the library' : ''}; restyled ${restyled} item(s): ${variantSummary(variant)}`,
      )
    },

    async import([file]) {
      if (!file) throw new Error('Usage: shred styles import <pack.json>')
      const pack = readPack(file)
      const before = new Set(library().map((style) => style.id))
      const styles = updateTextStyleLibrary(workspace(), (current) =>
        mergeStyles(current, pack.styles),
      )
      const touched = styles.filter((style) =>
        pack.styles.some(
          (p) => p.id === style.id || p.name.toLowerCase() === style.name.toLowerCase(),
        ),
      )
      for (const style of touched)
        say(
          `  ${before.has(style.id) ? 'updated' : 'added  '} ${style.id} (${style.role}) v${style.version}`,
        )
      say(
        `${pack.name ? `${pack.name}: ` : ''}${touched.length} style(s) in the library. Use them in a project: shred styles use <projectId> <name...>`,
      )
    },

    async export(names) {
      const source = opt.project ? projectStyles((await getProject(opt.project)).project) : library()
      const styles = names.length
        ? names.map((name) => {
            const style = findStyle(source, name)
            if (!style) throw new Error(`No style "${name}"`)
            return style
          })
        : source
      const pack = { kind: PACK_KIND, version: 1, ...(opt.name ? { name: opt.name } : {}), styles }
      const text = `${JSON.stringify(pack, null, 2)}\n`
      if (!opt.out) return say(text.trimEnd())
      fs.writeFileSync(path.resolve(opt.out), text)
      say(`${path.resolve(opt.out)}  (${styles.length} style(s))`)
    },

    async remove([name]) {
      if (!name) throw new Error('Usage: shred styles remove <name|id>')
      const style = libraryStyle(name)
      updateTextStyleLibrary(workspace(), (styles) => styles.filter((s) => s.id !== style.id))
      say(`Removed ${style.id} from the library (projects keep their copies).`)
    },
  }
}
