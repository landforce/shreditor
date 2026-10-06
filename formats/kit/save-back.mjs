// Save-back: a project's `kit:*` style, as tweaked in Shreditor, written into
// the kit's own values (pixels at the kit canvas, weights as numbers, the
// section's anchor kept), with the version bump and changelog entry the kit
// expects. Only the look for the kit canvas's aspect is written. Pure: the
// caller reads and writes the file (only when the user asks).
import { bumpPatch, kitAspect, kitCanvas } from './kit.mjs'
import { kitStyleSource, kitWeightFromFontWeight, layoutToAnchorBox } from './mapping.mjs'

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const round = (value, places) => Number(Number(value).toFixed(places))

function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005
  if (isObject(a) && isObject(b))
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) =>
      sameValue(a[key], b[key]),
    )
  return a === b || (a == null && b == null)
}

/** Set `path` (dot separated) in `target` to `value`, recording the change when it differs. */
function setValue(target, path, value, changes) {
  const keys = path.split('.')
  const last = keys.pop()
  let node = target
  for (const key of keys) {
    if (!isObject(node[key])) node[key] = {}
    node = node[key]
  }
  if (sameValue(node[last], value)) return
  changes.push({ path, from: node[last], to: value })
  node[last] = value
}

const outlineOf = (look) =>
  look.stroke && look.stroke.width > 0
    ? { color: look.stroke.color, width: round(look.stroke.width, 2) }
    : null

function boxOf(look, outline) {
  if (!look.backgroundColor) return null
  const pad = outline?.width ?? 0
  return {
    color: look.backgroundColor,
    radius: round(look.backgroundRadius ?? 0, 2),
    padX: round((look.textPaddingX ?? look.textPadding ?? 0) - pad, 2),
    padY: round((look.textPaddingY ?? look.textPadding ?? 0) - pad, 2),
    perLine: look.backgroundMode === 'lines',
  }
}

/** A nested kit object (box, outline): field by field when both exist, else whole. */
function setObject(next, path, current, value, changes) {
  if (!isObject(current) || !value) return setValue(next, path, value, changes)
  for (const [key, field] of Object.entries(value)) setValue(next, `${path}.${key}`, field, changes)
}

/** The look fields of a kit text style (`<section>.style`). */
function writeStyle(next, section, look, changes) {
  const at = `${section}.style`
  const current = next[section].style
  const outline = outlineOf(look)
  setValue(next, `${at}.size`, round(look.fontSize, 2), changes)
  setValue(next, `${at}.weight`, kitWeightFromFontWeight(look.fontWeight), changes)
  setValue(next, `${at}.lineHeight`, round(look.lineHeight ?? 1.2, 3), changes)
  setValue(next, `${at}.letterSpacing`, round(look.letterSpacing ?? 0, 2), changes)
  setValue(next, `${at}.color`, look.color, changes)
  setObject(next, `${at}.outline`, current.outline, outline, changes)
  setObject(next, `${at}.box`, current.box, boxOf(look, outline), changes)
}

function writePlacement(next, section, variant, canvas, changes, { yPath, keepAlign } = {}) {
  const placement = next[section].placement
  const box = layoutToAnchorBox(variant.layout ?? {}, placement.anchor, canvas)
  if (!keepAlign)
    setValue(next, `${section}.placement.align`, variant.style.textAlign ?? 'center', changes)
  setValue(next, `${section}.placement.x`, box.x, changes)
  setValue(next, `${section}.placement.width`, box.width, changes)
  setValue(next, yPath ?? `${section}.placement.y`, box.y, changes)
}

function fontNote(kit, section, look, familyFor) {
  const font = kit[section].style.font
  const expected = familyFor(font)
  return look.fontFamily && look.fontFamily !== expected
    ? `${section}: font family "${look.fontFamily}" not written (the kit picks fonts by stack: add it to fonts.${font}.stack)`
    : null
}

const WRITERS = {
  'kit:title': (ctx) => {
    writeStyle(ctx.next, 'titles', ctx.look, ctx.changes)
    writePlacement(ctx.next, 'titles', ctx.variant, ctx.canvas, ctx.changes)
  },
  'kit:caption': (ctx) => {
    const name = ctx.kit.captions.placement.default
    writeStyle(ctx.next, 'captions', ctx.look, ctx.changes)
    writePlacement(ctx.next, 'captions', ctx.variant, ctx.canvas, ctx.changes, {
      yPath: `captions.placement.positions.${name}.y`,
    })
  },
  'kit:overlay': (ctx) => {
    writeStyle(ctx.next, 'overlays', ctx.look, ctx.changes)
    writePlacement(ctx.next, 'overlays', ctx.variant, ctx.canvas, ctx.changes)
  },
  'kit:listicle-headline': (ctx) => {
    const box = layoutToAnchorBox(
      ctx.variant.layout ?? {},
      ctx.kit.overlays.placement.anchor,
      ctx.canvas,
    )
    setValue(ctx.next, 'overlays.listicle.headlineSize', round(ctx.look.fontSize, 2), ctx.changes)
    setValue(
      ctx.next,
      'overlays.listicle.headlineWeight',
      kitWeightFromFontWeight(ctx.look.fontWeight),
      ctx.changes,
    )
    setValue(ctx.next, 'overlays.listicle.align', ctx.look.textAlign ?? 'left', ctx.changes)
    setValue(ctx.next, 'overlays.listicle.x', box.x, ctx.changes)
    setValue(ctx.next, 'overlays.listicle.width', box.width, ctx.changes)
  },
}

function writePosition(ctx, source) {
  const box = layoutToAnchorBox(
    ctx.variant.layout ?? {},
    ctx.kit.captions.placement.anchor,
    ctx.canvas,
  )
  setValue(ctx.next, `captions.placement.positions.${source.position}.y`, box.y, ctx.changes)
  return `${ctx.style.id}: only its y is saved (captions share one look; save kit:caption for the rest)`
}

function writeOne(ctx) {
  const source = kitStyleSource(ctx.kit, ctx.style.id)
  if (!source) return `${ctx.style.id}: not a kit style`
  const writer = WRITERS[ctx.style.id]
  if (writer) {
    writer(ctx)
    return fontNote(ctx.kit, source.section, ctx.look, ctx.familyFor)
  }
  if (source.position) return writePosition(ctx, source)
  return `${ctx.style.id}: derived from another kit style, nothing of its own to save`
}

/**
 * The kit with these project styles' looks written into it: `{ kit, changes,
 * notes }`, where `changes` are { path, from, to } and `notes` say what was
 * not written and why. `familyFor(fontKey)` is the family the kit's font
 * stack resolves to here (a different family on the style is reported, not
 * written). Nothing changes when the styles match the kit.
 */
export function kitWithStyles(kit, styles, { familyFor }) {
  const next = structuredClone(kit)
  const aspect = kitAspect(kit)
  const canvas = kitCanvas(kit)
  const changes = []
  const notes = []
  for (const style of styles) {
    const variant = style.variants?.find((entry) => entry.aspect === aspect)
    if (!variant) {
      notes.push(`${style.id}: no ${aspect} look to save`)
      continue
    }
    const note = writeOne({
      kit,
      next,
      style,
      variant,
      look: variant.style,
      canvas,
      changes,
      familyFor,
    })
    if (note) notes.push(note)
  }
  return { kit: next, changes, notes }
}

/**
 * A saved change recorded the kit's way: kitVersion bumped (patch),
 * updatedAt now, and a changelog entry { date, version, change, why }.
 */
export function withChangelogEntry(
  kit,
  changes,
  { now = new Date(), why = 'from Shreditor' } = {},
) {
  const version = bumpPatch(kit.kitVersion)
  const change = changes
    .map((c) => `${c.path} ${JSON.stringify(c.from ?? null)} -> ${JSON.stringify(c.to)}`)
    .join('; ')
  return {
    ...kit,
    kitVersion: version,
    updatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    changelog: [
      ...(Array.isArray(kit.changelog) ? kit.changelog : []),
      { date: now.toISOString().slice(0, 10), version, change: change.slice(0, 600), why },
    ],
  }
}
