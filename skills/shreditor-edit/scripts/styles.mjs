// `shred styles`: the text style library (<workspace>/app/text-styles.json)
// and a project's copies of it. Writes to the library are atomic and re-read
// the file first; the editor re-reads it when it changes. Project changes go
// through the edit service (upsertTextStyle), so they restyle linked items.
import fs from 'node:fs'
import path from 'node:path'
import {
  findStyle,
  mergeStyles,
  readTextStyleLibrary,
  textStylePackSchema,
  updateTextStyleLibrary,
} from '../../../headless/lib/text-styles.mjs'

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

function summary(style) {
  const s = style.style ?? {}
  const parts = [
    s.fontFamily,
    s.fontWeight && s.fontWeight !== 'normal' ? s.fontWeight : null,
    s.fontSize ? `${s.fontSize}px@1080` : null,
    s.color,
    s.backgroundColor ? `bg ${s.backgroundColor}` : null,
    s.stroke ? `stroke ${s.stroke.width} ${s.stroke.color}` : null,
    style.layout?.yRatio !== undefined ? `y ${style.layout.yRatio}` : null,
    style.textMotion ? `motion ${Object.keys(style.textMotion).join('/')}` : null,
    style.caption
      ? `${style.caption.maxWordsPerChunk} words, ${style.caption.maxLines}x${style.caption.maxCharsPerLine} chars`
      : null,
  ]
  return parts.filter(Boolean).join(', ')
}

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
    const own = project.timeline?.textStyles ?? []
    const items = project.timeline?.items ?? []
    if (opt.json) return say(JSON.stringify(own, null, 2))
    say(`Project ${id}: ${own.length} style${own.length === 1 ? '' : 's'}`)
    const lib = library()
    for (const style of own) {
      const used = items.filter((item) => item.textStyleId === style.id).length
      const source = findStyle(lib, style.id)
      const state = !source
        ? 'project only'
        : sameStyle(source, style)
          ? 'same as library'
          : `differs from library v${source.version} (shred styles use ${id} ${style.id} takes the library's)`
      say(
        `  ${style.id.padEnd(22)} ${style.role.padEnd(11)} v${style.version}  ${used} item(s)  ${state}`,
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
          `${style.id.padEnd(22)} ${style.role.padEnd(11)} v${style.version}  ${style.name}  (${summary(style)})`,
        )
    },

    async show([name]) {
      if (!name) throw new Error('Usage: shred styles show <name|id> [--project <id>]')
      const style = opt.project
        ? findStyle((await getProject(opt.project)).project.timeline?.textStyles ?? [], name)
        : libraryStyle(name)
      if (!style) throw new Error(`No style "${name}" in project ${opt.project}`)
      say(JSON.stringify(style, null, 2))
    },

    /** Copy library styles into a project; a copy already there takes the library's look. */
    async use([id, ...names]) {
      if (!id || !names.length) throw new Error('Usage: shred styles use <projectId> <name|id...>')
      const styles = names.map(libraryStyle)
      const { revision } = await getProject(id)
      const res = await applyBatch(
        id,
        styles.map((style) => ({ op: 'upsertTextStyle', style })),
        revision,
      )
      for (const result of res.results ?? [])
        say(
          `  ${result.detail.styleId} v${result.detail.version}: restyled ${result.detail.updatedItems.length} item(s)`,
        )
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
      const source = opt.project
        ? ((await getProject(opt.project)).project.timeline?.textStyles ?? [])
        : library()
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
