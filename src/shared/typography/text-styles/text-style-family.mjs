// Text style families: one style (id, name, role) with one look per aspect
// ratio. Shared by the editor and the agent tools, so both migrate old
// single-look styles, pick variants and clone them the same way.
//
// A variant's lengths are pixels on its aspect's reference canvas, whose
// short side is 1080 (1080x1920 for 9:16, 1920x1080 for 16:9, 1080x1350 for
// 4:5), and scale uniformly on other resolutions of the same aspect.
import { canvasForAspect, closestAspect, sortAspects } from '../../projects/aspect.mjs'

/** The aspect an old single-look style becomes when nothing says otherwise. */
export const LEGACY_TEXT_STYLE_ASPECT = '9:16'

/** The short side, in pixels, of every variant's reference canvas. */
const TEXT_STYLE_REFERENCE_SHORT_SIDE = 1080

/** The canvas a variant's lengths are written for: short side 1080. */
export function referenceCanvasForAspect(aspect) {
  return canvasForAspect(aspect, TEXT_STYLE_REFERENCE_SHORT_SIDE)
}

/** Variants in the shared aspect order: 9:16, 16:9, 1:1, 4:5, then the rest. */
function sortTextStyleVariants(variants) {
  const order = sortAspects(variants.map((variant) => variant.aspect))
  return [...variants].sort((a, b) => order.indexOf(a.aspect) - order.indexOf(b.aspect))
}

function compact(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

/**
 * A style in its family shape. An old single-look style (look fields at the
 * top, no `variants`) becomes a one-variant family for its `aspect`, else
 * `legacyAspect`: a project's copies use the project's aspect, the library
 * and packs 9:16 (every format is vertical).
 */
export function toTextStyleFamily(entry, legacyAspect = LEGACY_TEXT_STYLE_ASPECT) {
  if (!entry || typeof entry !== 'object') return entry
  const { style, layout, textMotion, spanStyles, caption, aspect, variants, ...shared } = entry
  if (Array.isArray(variants)) return { ...shared, variants: sortTextStyleVariants(variants) }
  const variant = compact({
    aspect: aspect ?? legacyAspect,
    style: style ?? {},
    layout,
    textMotion,
    spanStyles,
    caption,
  })
  return { ...shared, variants: [variant] }
}

/** The variant for an aspect, or undefined. */
export function textStyleVariantFor(style, aspect) {
  return style.variants.find((variant) => variant.aspect === aspect)
}

/** The aspects a style has a look for. */
export function textStyleAspects(style) {
  return style.variants.map((variant) => variant.aspect)
}

/** The style with `variant` added, or replacing the one for its aspect. */
export function withTextStyleVariant(style, variant) {
  return {
    ...style,
    variants: sortTextStyleVariants([
      ...style.variants.filter((entry) => entry.aspect !== variant.aspect),
      variant,
    ]),
  }
}

/**
 * `incoming` laid over `base`: its name, role and rules win, its variants
 * replace those for the same aspect, and the variants only `base` has stay.
 */
export function mergeTextStyleFamilies(base, incoming) {
  return incoming.variants.reduce(withTextStyleVariant, {
    ...base,
    ...incoming,
    variants: base.variants,
  })
}

const round3 = (value) => Math.round(value * 1000) / 1000

/** Offsets this close to the middle count as centred. */
const CENTRED = 0.05

/**
 * One layout axis on a new canvas. Box sizes keep their pixels (the short
 * sides match), capped to fit. Positions keep their anchor: a box near an
 * edge keeps its margin to that edge (as a share of the canvas), a centred
 * box stays centred.
 */
function cloneAxis(offsetRatio, sizeRatio, from, to) {
  const sizePx = sizeRatio === undefined ? undefined : sizeRatio * from
  const size =
    sizePx === undefined ? undefined : round3(Math.min(sizePx / to, Math.max(sizeRatio, 0.9)))
  if (offsetRatio === undefined) return { size }
  if (Math.abs(offsetRatio) <= CENTRED) return { size, offset: offsetRatio }
  const halfFrom = (sizePx ?? 0) / 2
  const halfTo = ((size ?? 0) * to) / 2
  const margin = Math.max(0, from / 2 - Math.abs(offsetRatio * from) - halfFrom) / from
  const centre = Math.max(0, to / 2 - margin * to - halfTo)
  return { size, offset: round3((Math.sign(offsetRatio) * centre) / to) }
}

function cloneLayout(layout, from, to) {
  const x = cloneAxis(layout.xRatio, layout.widthRatio, from.width, to.width)
  const y = cloneAxis(layout.yRatio, layout.heightRatio, from.height, to.height)
  return compact({ xRatio: x.offset, yRatio: y.offset, widthRatio: x.size, heightRatio: y.size })
}

/**
 * A variant for another aspect, as a starting point to adjust: the same look
 * (sizes are short-side pixels on both reference canvases), motion and
 * caption rules, with the layout re-anchored for the new canvas.
 */
export function cloneTextStyleVariant(variant, toAspect) {
  const next = { ...structuredClone(variant), aspect: toAspect }
  if (variant.layout) {
    next.layout = cloneLayout(
      variant.layout,
      referenceCanvasForAspect(variant.aspect),
      referenceCanvasForAspect(toAspect),
    )
  }
  return next
}

/**
 * Add a variant for `toAspect` cloned from the `fromAspect` one (else the
 * closest aspect the style has). Version and time are the caller's.
 */
export function addClonedTextStyleVariant(style, toAspect, fromAspect) {
  if (textStyleVariantFor(style, toAspect)) {
    throw new Error(`"${style.name}" already has a ${toAspect} version`)
  }
  const from = fromAspect ?? closestAspect(toAspect, textStyleAspects(style))
  const source = from ? textStyleVariantFor(style, from) : undefined
  if (!source) {
    throw new Error(
      `"${style.name}" has no ${from} version to copy (it has ${textStyleAspects(style).join(', ')})`,
    )
  }
  return { style: withTextStyleVariant(style, cloneTextStyleVariant(source, toAspect)), from }
}

/** What to say when a style has no look for the canvas it is used on. */
export function missingTextStyleVariantMessage(style, aspect, projectId) {
  const target = projectId ? ` --project ${projectId}` : ''
  return (
    `text style "${style.name}" has no ${aspect} version (it has ${textStyleAspects(style).join(', ')}). ` +
    `Make one from the closest: shred styles clone ${style.id} --aspect ${aspect}${target}`
  )
}

/**
 * Seed marker of the library file (`seeded` in app/text-styles.json). A
 * library at this mark has had the built-in styles added once; deleting one
 * does not bring it back.
 */
export const TEXT_STYLE_LIBRARY_SEED = 1

/** Whether a library file (parsed JSON, or null when missing) still needs seeding. */
export function textStyleLibraryNeedsSeed(file) {
  return !(Number(file?.seeded) >= TEXT_STYLE_LIBRARY_SEED)
}

/** `styles` plus the built-ins whose id and name no style there has. */
export function seedTextStyles(styles, builtins) {
  const ids = new Set(styles.map((style) => style.id))
  const names = new Set(styles.map((style) => style.name.toLowerCase()))
  return [
    ...styles,
    ...builtins.filter((style) => !ids.has(style.id) && !names.has(style.name.toLowerCase())),
  ]
}
