// `shred kit`: a Video Style Kit (kit.json) on a project. `apply` maps the
// kit's titles, captions and overlays to `kit:*` text styles (project and
// library), records the kit on the project and prints what mapped, what
// didn't, the fonts and the kit's preferences; `status` says whether the
// file changed since; `show` summarises a kit; `save-back` writes project
// style tweaks into kit.json and `set` changes kit values by path (both only
// when the user asks); `detach` stops following it. `shred check` adds
// the kit's rules (kitCheck below). The model lives in formats/kit/.
import fs from 'node:fs'
import path from 'node:path'
import {
  mergeStyles,
  readTextStyleLibrary,
  updateTextStyleLibrary,
} from '../../../headless/lib/text-styles.mjs'
import { aspectKey } from '../../../src/shared/projects/aspect.mjs'
import { toTextStyleFamily } from '../../../src/shared/typography/text-styles/text-style-family.mjs'
import { canonicalJson, kitAspect, parseKit } from '../../../formats/kit/kit.mjs'
import { kitTextStyles } from '../../../formats/kit/mapping.mjs'
import { describeKitFonts, resolveKitFonts } from '../../../formats/kit/fonts.mjs'
import { describeKitDiff, diffKits } from '../../../formats/kit/diff.mjs'
import {
  describeMapping,
  describePreferences,
  describeReferenceFrames,
  kitBrandColors,
  kitTargetOverrides,
  summarizeKit,
} from '../../../formats/kit/report.mjs'
import { kitWithStyles, withChangelogEntry } from '../../../formats/kit/save-back.mjs'
import { kitPairs, kitWithValues } from '../../../formats/kit/set.mjs'
import { kitLayoutItems, scoreKit } from '../../../formats/kit/checks.mjs'
import {
  catalogFontFamilies,
  installedFontFamilies,
  kitHash,
  readKitFile,
  writeKitFile,
} from '../../../formats/kit/node.mjs'

const SNAPSHOT = ['agent', 'kit-applied.json']

/** Fonts resolved on this machine: { fonts, familyFor(fontKey) }. */
function kitFonts(kit) {
  const fonts = resolveKitFonts(kit, {
    installed: installedFontFamilies(),
    catalog: catalogFontFamilies(),
  })
  return { fonts, familyFor: (key) => fonts[key]?.family ?? 'Inter' }
}

const projectAspect = (project) =>
  aspectKey(project.metadata?.width || 1080, project.metadata?.height || 1920)

const projectStyles = (project) =>
  (project.timeline?.textStyles ?? []).map((style) =>
    toTextStyleFamily(style, projectAspect(project)),
  )

/** Same name, role, notes and looks for the aspects `mapped` has (version and time aside). */
export function sameAsMapped(style, mapped) {
  if (!style || !mapped) return false
  const head = (s) =>
    canonicalJson([s.name, s.role, s.description ?? null, s.defaultDurationFrames ?? null])
  if (head(style) !== head(mapped)) return false
  return mapped.variants.every((variant) => {
    const own = style.variants.find((entry) => entry.aspect === variant.aspect)
    return own && canonicalJson(own) === canonicalJson(variant)
  })
}

const snapshotPath = (workspace, id) => path.join(workspace, 'projects', id, ...SNAPSHOT)

function readSnapshot(workspace, id) {
  try {
    return parseKit(JSON.parse(fs.readFileSync(snapshotPath(workspace, id), 'utf8'))).kit
  } catch {
    return null
  }
}

function writeSnapshot(workspace, id, kit) {
  const file = snapshotPath(workspace, id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(kit, null, 2)}\n`)
}

/**
 * What to do with each kit style, three ways: the kit's look now, the look
 * the project last applied (from the snapshot), and the project's copy. A
 * style the project changed is kept unless the kit changed it too (or --force).
 */
export function planStyles(mapped, base, current, force) {
  return mapped.map((style) => {
    const own = current.find((entry) => entry.id === style.id)
    const before = base?.find((entry) => entry.id === style.id)
    if (!own) return { style, action: 'add' }
    if (sameAsMapped(own, style)) return { style, action: 'same' }
    if (force) return { style, action: 'reset' }
    if (before && sameAsMapped(before, style)) return { style, action: 'keep' }
    const lost = before && !sameAsMapped(own, before)
    return { style, action: lost ? 'replace' : 'update' }
  })
}

const ACTION_TEXT = {
  add: 'added',
  update: 'updated from the kit',
  replace: "updated from the kit (the project's own changes to it were replaced)",
  reset: 'reset to the kit (--force)',
  saved: 'saved to the kit; the project copy now matches it',
  same: 'unchanged',
  keep: 'changed in the project, kept (shred kit save-back puts it in the kit; --force takes the kit’s)',
}

function kitRecord(file, kit, hash, appliedAt) {
  const brandColors = kitBrandColors(kit)
  return {
    path: file,
    ...(kit.creator ? { creator: String(kit.creator) } : {}),
    kitVersion: kit.kitVersion,
    hash,
    appliedAt,
    ...(brandColors.length ? { brandColors } : {}),
  }
}

const sameRecord = (a, b) =>
  Boolean(a) && canonicalJson({ ...a, appliedAt: 0 }) === canonicalJson({ ...b, appliedAt: 0 })

function printList(say, title, lines) {
  if (!lines.length) return
  say(title)
  for (const line of lines) say(`  ${line}`)
}

function printPlan(say, kit, folder) {
  const mapping = describeMapping(kit)
  printList(say, 'Mapped', mapping.mapped)
  printList(say, 'Not mapped (and why)', mapping.unmapped)
  printList(
    say,
    "Preferences (follow these over the format's defaults)",
    describePreferences(kit.preferences),
  )
  printList(say, 'Reference frames', describeReferenceFrames(kit, folder))
}

export function kitCommands({ say, opt, workspace, getProject, applyBatch, call, key }) {
  const patchKit = async (id, kitValue, revision) =>
    call(
      'PATCH',
      `/v1/projects/${id}`,
      { updates: { kit: kitValue }, expectedRevision: revision },
      {
        'Idempotency-Key': key('kit'),
      },
    )

  /** Write `plan`'s changed styles to the project (restyling its items) and the library. */
  async function writeStyles(id, plan, revision) {
    const changed = plan.filter((entry) => !['same', 'keep'].includes(entry.action))
    const library = readTextStyleLibrary(workspace())
    const missing = plan.filter((entry) => !library.some((style) => style.id === entry.style.id))
    const toLibrary = [...new Set([...changed, ...missing].map((entry) => entry.style))]
    if (toLibrary.length)
      updateTextStyleLibrary(workspace(), (styles) => mergeStyles(styles, toLibrary))
    if (!changed.length) return revision
    const res = await applyBatch(
      id,
      changed.map((entry) => ({ op: 'upsertTextStyle', style: entry.style })),
      revision,
    )
    for (const result of res.results ?? [])
      say(
        `  ${result.detail.styleId} v${result.detail.version}: restyled ${result.detail.updatedItems.length} item(s)`,
      )
    return res.revision
  }

  /**
   * Bring the project in line with a kit: its `kit:*` styles (three-way
   * against `base`, the kit last applied), the library copies, the kit record
   * and the snapshot. Prints the style actions; returns what changed.
   */
  async function syncProject(id, read, { base, force, saved = false }) {
    const { kit } = read
    const { familyFor } = kitFonts(kit)
    const { project, revision } = await getProject(id)
    const mapped = kitTextStyles(kit, { familyFor })
    const plan = planStyles(
      mapped,
      base && kitTextStyles(base, { familyFor }),
      projectStyles(project),
      force,
    )
    say(`Styles (project ${id} and the library)`)
    for (const entry of plan) {
      const action = saved && entry.action === 'replace' ? 'saved' : entry.action
      say(`  ${entry.style.id.padEnd(24)} ${ACTION_TEXT[action]}`)
    }
    const next = await writeStyles(id, plan, revision)
    const record = kitRecord(read.path, kit, read.hash, new Date().toISOString())
    const recorded = sameRecord(project.kit, record)
    if (!recorded) await patchKit(id, record, next)
    writeSnapshot(workspace(), id, kit)
    return {
      record,
      changed: !recorded || plan.some((entry) => !['same', 'keep'].includes(entry.action)),
    }
  }

  async function apply([input]) {
    if (!input || !opt.project)
      throw new Error('Usage: shred kit apply <kit.json|kit folder> --project <id> [--force]')
    const id = opt.project
    const read = readKitFile(input)
    const { kit } = read
    const { project } = await getProject(id)
    const base = readSnapshot(workspace(), id)
    say(
      `Kit: ${kit.creator ?? 'Video Style Kit'} v${kit.kitVersion}  ${read.path}  (${read.hash.slice(0, 19)}…)`,
    )
    for (const warning of read.warnings) say(`warning: ${warning}`)
    printList(say, 'Fonts', describeKitFonts(kitFonts(kit).fonts))
    if (projectAspect(project) !== kitAspect(kit))
      say(
        `note: the project is ${projectAspect(project)}; the kit is ${kitAspect(kit)}. Styles carry both looks; the kit's positions and rules are for ${kitAspect(kit)}.`,
      )
    if (base && project.kit?.hash !== read.hash)
      printList(say, 'Kit changes since the last apply', describeKitDiff(diffKits(base, kit)))
    const { record, changed } = await syncProject(id, read, { base, force: opt.force })
    say(changed ? `Recorded on ${id}: kit v${kit.kitVersion}` : 'Already applied: nothing changed.')
    if (record.brandColors)
      say(
        `Brand colours offered in the text colour pickers: ${record.brandColors.map((c) => c.hex).join(', ')}`,
      )
    printPlan(say, kit, path.dirname(read.path))
    say(
      'Use kit:title, kit:caption (kit:caption-low when the face fills the middle), kit:overlay, kit:listicle-headline and kit:emphasis; shred check includes the kit rules.',
    )
  }

  /** The project's kit record and the kit file now (or why it can't be read). */
  function currentKit(project) {
    if (!project.kit) return null
    try {
      return { ...readKitFile(project.kit.path), error: null }
    } catch (error) {
      return { kit: null, error: error.message }
    }
  }

  async function status([id]) {
    if (!id) throw new Error('Usage: shred kit status <projectId>')
    const { project } = await getProject(id)
    if (!project.kit) return say(`${id} has no kit (shred kit apply <kit.json> --project ${id}).`)
    const record = project.kit
    say(`Kit: ${record.creator ?? 'Video Style Kit'} v${record.kitVersion}  ${record.path}`)
    say(`hash ${record.hash}  applied ${record.appliedAt}`)
    const now = currentKit(project)
    if (!now.kit) return say(`The kit file can't be read: ${now.error}`)
    const base = readSnapshot(workspace(), id)
    if (now.hash === record.hash) say('In sync: the file is what the project applied.')
    else {
      say(
        `DRIFT: the file changed since apply (now v${now.kit.kitVersion}, ${now.hash.slice(0, 19)}…). Re-apply: shred kit apply ${record.path} --project ${id}`,
      )
      printList(
        say,
        'Changes',
        base
          ? describeKitDiff(diffKits(base, now.kit))
          : ['(no copy of the applied kit to compare with)'],
      )
    }
    const { fonts, familyFor } = kitFonts(now.kit)
    printList(say, 'Fonts', describeKitFonts(fonts))
    const mapped = kitTextStyles(now.kit, { familyFor })
    const own = projectStyles(project)
    printList(
      say,
      'Styles',
      mapped.map((style) => {
        const copy = own.find((entry) => entry.id === style.id)
        return `${style.id.padEnd(24)} ${!copy ? 'missing (re-apply)' : sameAsMapped(copy, style) ? 'matches the kit' : 'differs from the kit file'}`
      }),
    )
    printList(
      say,
      "Preferences (follow these over the format's defaults)",
      describePreferences(now.kit.preferences),
    )
  }

  async function show([input]) {
    if (!input) throw new Error('Usage: shred kit show <kit.json|kit folder>')
    const read = readKitFile(input)
    say(read.path)
    for (const line of summarizeKit(read.kit)) say(line)
    printList(say, 'Fonts on this machine', describeKitFonts(kitFonts(read.kit).fonts))
  }

  async function saveBack([id]) {
    if (!id) throw new Error('Usage: shred kit save-back <projectId> [--style kit:title] [--force]')
    const { project } = await getProject(id)
    const read = await appliedKit(id)
    const wanted = opt.style ? opt.style.split(',').map((s) => s.trim()) : null
    const styles = projectStyles(project).filter(
      (s) => s.id.startsWith('kit:') && (!wanted || wanted.includes(s.id)),
    )
    if (wanted)
      for (const name of wanted)
        if (!styles.some((s) => s.id === name)) throw new Error(`No style ${name} in ${id}`)
    const { familyFor } = kitFonts(read.kit)
    const result = kitWithStyles(read.kit, styles, { familyFor })
    for (const note of result.notes) say(`note: ${note}`)
    if (!result.changes.length) return say('Nothing to save: the kit already has these looks.')
    const saved = withChangelogEntry(result.kit, result.changes)
    writeKitFile(read.path, saved)
    say(`Saved to ${read.path}: v${read.kit.kitVersion} -> v${saved.kitVersion}`)
    for (const line of describeKitDiff(result.changes, 40)) say(`  ${line}`)
    // The project takes the saved kit, so the styles derived from it follow.
    await syncProject(
      id,
      { path: read.path, kit: saved, hash: kitHash(saved) },
      { base: read.kit, saved: true },
    )
  }

  /** The project's kit, refused when the file changed since it was applied (unless --force). */
  async function appliedKit(id) {
    const { project } = await getProject(id)
    if (!project.kit)
      throw new Error(`${id} has no kit (shred kit apply <kit.json> --project ${id})`)
    const read = readKitFile(project.kit.path)
    if (read.hash !== project.kit.hash && !opt.force)
      throw new Error(
        `${read.path} changed since it was applied (shred kit status ${id}). Re-apply it first, or --force to write over those changes.`,
      )
    return read
  }

  async function set([id, ...rest]) {
    const usage =
      'Usage: shred kit set <projectId> <path> <value> | <path>=<value> ... [--why "..."] [--force]'
    if (!id || !rest.length) throw new Error(usage)
    let pairs
    try {
      pairs = kitPairs(rest)
    } catch (error) {
      throw new Error(`${error.message}. ${usage}`)
    }
    const read = await appliedKit(id)
    const { kit, changes } = kitWithValues(read.kit, pairs, { force: opt.force })
    if (!changes.length) return say('Nothing to set: the kit already has these values.')
    const saved = withChangelogEntry(kit, changes, { why: opt.why ?? 'shred kit set' })
    writeKitFile(read.path, saved)
    say(`Saved to ${read.path}: v${read.kit.kitVersion} -> v${saved.kitVersion}`)
    for (const line of describeKitDiff(changes, 40)) say(`  ${line}`)
    // The project takes the new kit, so its kit:* styles follow.
    await syncProject(id, { path: read.path, kit: saved, hash: kitHash(saved) }, { base: read.kit })
  }

  /** Stop following a kit: the record and the applied copy go; the kit:* styles stay. */
  async function detach([id]) {
    if (!id) throw new Error('Usage: shred kit detach <projectId>')
    const { project, revision } = await getProject(id)
    if (!project.kit) return say(`${id} has no kit.`)
    await patchKit(id, null, revision)
    fs.rmSync(snapshotPath(workspace(), id), { force: true })
    say(`${id} no longer follows ${project.kit.path}.`)
    say(
      'Its kit:* styles stay in the project (text using them keeps its look); shred check stops checking the kit rules.',
    )
  }

  return { apply, status, show, set, detach, 'save-back': saveBack }
}

// ---------------------------------------------------------------------------
// shred check: the kit's rules, from the timeline and the rendered layout
// ---------------------------------------------------------------------------

/** Frames that put every item on screen at least once: greedy, at item ends. */
export function layoutFrames(items) {
  const frames = []
  let last = -1
  const sorted = [...items].sort(
    (a, b) => a.from + a.durationInFrames - (b.from + b.durationInFrames),
  )
  for (const item of sorted) {
    if (last >= item.from && last < item.from + item.durationInFrames) continue
    last = item.from + item.durationInFrames - 1
    frames.push(last)
  }
  return frames
}

/** dumpLayout entries (item id -> entry) for the items the kit rules need. */
async function fetchLayouts(call, id, items) {
  const wanted = new Set(items.map((item) => item.id))
  const layouts = new Map()
  for (const frame of layoutFrames(items)) {
    const layout = await call('POST', '/layout', { project: id, frame })
    for (const entry of layout.items ?? [])
      if (wanted.has(entry.id) && !layouts.has(entry.id)) layouts.set(entry.id, entry)
  }
  return layouts
}

/**
 * The kit part of `shred check` for a project with a kit: the kit (the file,
 * else the copy applied), the target overrides its preferences make, and its
 * scored rules. Null without a kit.
 */
export async function kitCheck({ call, workspace }, id, project, mediaById) {
  if (!project.kit) return null
  let kit
  let note = null
  try {
    const read = readKitFile(project.kit.path)
    kit = read.kit
    if (read.hash !== project.kit.hash)
      note = 'kit.json changed since it was applied (shred kit status); checked against the file'
  } catch (error) {
    kit = readSnapshot(workspace(), id)
    if (!kit) return { error: `the kit can't be read (${error.message})` }
    note = `kit.json can't be read (${error.message}); checked against the copy applied`
  }
  const layouts = await fetchLayouts(call, id, kitLayoutItems(project, { mediaById }))
  const card = scoreKit(project, kit, { layouts, mediaById })
  return {
    card,
    note,
    overrides: kitTargetOverrides(kit),
    preferences: describePreferences(kit.preferences),
  }
}

const TAG = { pass: 'pass', fail: 'FAIL', warn: 'WARN', look: 'LOOK', listen: 'LISTEN', na: 'n/a' }

/** The kit section of `shred check` in words. */
export function printKitCheck(say, result, fps) {
  if (!result) return
  if (result.error) return say(`Kit: ${result.error}`)
  const { card } = result
  const s = card.summary
  say(
    `Kit: ${card.creator ?? 'Video Style Kit'} v${card.kitVersion}  (${s.pass} pass, ${s.fail} fail, ${s.warn} warn, ${s.look} look, ${s.listen} listen, ${s.na} n/a)`,
  )
  if (result.note) say(`  note: ${result.note}`)
  const sec = (frame) => (frame / fps).toFixed(2)
  for (const c of card.checks) {
    say(`  ${TAG[c.status].padEnd(6)} ${c.id.padEnd(28)} ${c.type.padEnd(20)} ${c.detail}`)
    if (c.ranges.length && c.status !== 'pass')
      say(
        `         frames ${c.ranges.map((r) => `${r.startFrame}-${r.endFrame} [${sec(r.startFrame)}-${sec(r.endFrame)} s]`).join(', ')}`,
      )
  }
  if (s.look || s.listen)
    say('  LOOK/LISTEN: open those frames (shred frames) or listen, and say what you found.')
  say('  Kit preferences (over the format defaults)')
  for (const line of result.preferences) say(`    ${line}`)
}
