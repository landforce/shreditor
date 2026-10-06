// Creator Stylesheet (kit.json, schema v2): a creator's look and editing rules,
// defined outside Shreditor. This module reads one: validation with clear
// errors for the parts Shreditor needs (unknown fields are kept and ignored),
// a canonical form for hashing and diffing, sections with their aspect
// variants merged, and the version bump save-back uses. Plain ESM, shared by
// the agent tools (Node) and the editor, like ../registry.mjs.
//
// Units are the kit's: pixels at `canvas` (1080x1920), weights 400/500/600/700,
// times in seconds (milliseconds when a key ends in Ms). See docs/creator-kit.md.

import { aspectKey } from '../../src/shared/projects/aspect.mjs'

/** The kit schema this code reads. Newer kits load with a warning. */
const KIT_SCHEMA_VERSION = 2

/** Text sections Shreditor maps to text styles; the others are checked only. */
const KIT_TEXT_SECTIONS = Object.freeze(['titles', 'captions', 'overlays'])
const KIT_SECTIONS = Object.freeze([
  'titles',
  'captions',
  'overlays',
  'images',
  'greenscreen',
  'objects',
])

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const HEX = /^#[0-9A-Fa-f]{6}$/
const WEIGHTS = new Set([400, 500, 600, 700])

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/** A kit that can't be used: every problem found, one per line. */
class KitError extends Error {
  constructor(problems, source) {
    super(
      `${source ? `${source}: ` : ''}not a usable kit.json:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    )
    this.name = 'KitError'
    this.problems = problems
  }
}

const isSemver = (value) => typeof value === 'string' && SEMVER.test(value)
const isCanvas = (value) =>
  Array.isArray(value) && value.length === 2 && value.every((n) => isNumber(n) && n > 0)
const hasEntries = (value) => isObject(value) && Object.keys(value).length > 0
const hasStack = (font) =>
  Array.isArray(font?.stack) && font.stack.some((family) => typeof family === 'string')

/** Top-level fields: [key, valid?, what is expected]. */
const TOP_FIELDS = [
  ['schemaVersion', isNumber, 'missing (expected 2)'],
  ['kitVersion', isSemver, 'missing or not semver (like "0.2.0")'],
  ['canvas', isCanvas, 'missing (expected [width, height], like [1080, 1920])'],
  ['fonts', hasEntries, 'missing (expected { name: { stack: [...] } })'],
]

function checkTop(kit, problems) {
  for (const [key, valid, expected] of TOP_FIELDS)
    if (!valid(kit[key])) problems.push(`${key}: ${expected}`)
  for (const [name, font] of Object.entries(isObject(kit.fonts) ? kit.fonts : {}))
    if (!hasStack(font))
      problems.push(`fonts.${name}.stack: missing (an ordered list of font families)`)
}

/** Text style fields: [key, valid?(value, kit), what is expected]. */
const STYLE_FIELDS = [
  [
    'font',
    (font, kit) => typeof font === 'string' && isObject(kit.fonts?.[font]),
    (kit) => `must name one of fonts (${Object.keys(kit.fonts ?? {}).join(', ')})`,
  ],
  ['weight', (weight) => WEIGHTS.has(weight), () => 'must be 400, 500, 600 or 700'],
  ['size', (size) => isNumber(size) && size > 0, () => 'missing'],
  [
    'color',
    (color) => typeof color === 'string' && HEX.test(color),
    () => 'missing or not #RRGGBB',
  ],
]

function checkTextStyle(section, name, kit, problems) {
  const style = section.style
  if (!isObject(style)) return problems.push(`${name}.style: missing`)
  for (const [key, valid, expected] of STYLE_FIELDS)
    if (!valid(style[key], kit)) problems.push(`${name}.style.${key}: ${expected(kit)}`)
}

function checkPlacement(section, name, problems) {
  const placement = section.placement
  if (!isObject(placement)) return problems.push(`${name}.placement: missing`)
  for (const key of ['x', 'width'])
    if (!isNumber(placement[key])) problems.push(`${name}.placement.${key}: missing`)
  if (typeof placement.anchor !== 'string') problems.push(`${name}.placement.anchor: missing`)
}

function checkMust(section, name, problems) {
  if (section.must === undefined) return
  if (!Array.isArray(section.must)) return problems.push(`${name}.must: must be a list`)
  section.must.forEach((rule, index) => {
    const at = `${name}.must[${index}]`
    if (typeof rule?.id !== 'string' || !rule.id) problems.push(`${at}.id: missing`)
    if (typeof rule?.check?.type !== 'string') problems.push(`${at}.check.type: missing`)
  })
}

function checkSections(kit, problems) {
  for (const name of KIT_SECTIONS) {
    const section = kit[name]
    if (section === undefined && !KIT_TEXT_SECTIONS.includes(name)) continue
    if (!isObject(section)) {
      problems.push(`${name}: missing`)
      continue
    }
    if (KIT_TEXT_SECTIONS.includes(name)) {
      checkTextStyle(section, name, kit, problems)
      checkPlacement(section, name, problems)
    }
    checkMust(section, name, problems)
  }
}

/**
 * Validate a parsed kit.json. Returns `{ kit, warnings }` (the kit as given:
 * unknown fields stay); throws a KitError listing every missing or malformed
 * part Shreditor needs.
 */
export function parseKit(value, { source } = {}) {
  if (!isObject(value)) throw new KitError(['the file is not a JSON object'], source)
  const problems = []
  checkTop(value, problems)
  checkSections(value, problems)
  if (problems.length) throw new KitError(problems, source)
  const warnings = []
  if (value.schemaVersion > KIT_SCHEMA_VERSION)
    warnings.push(
      `schemaVersion ${value.schemaVersion} is newer than ${KIT_SCHEMA_VERSION}: unknown parts are ignored`,
    )
  return { kit: value, warnings }
}

/** JSON with sorted keys and no spacing: the same kit always gives the same text. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** `overrides` laid over `base`, objects merged key by key, everything else replaced. */
function deepMerge(base, overrides) {
  if (!isObject(base) || !isObject(overrides)) return overrides === undefined ? base : overrides
  const merged = { ...base }
  for (const [key, value] of Object.entries(overrides)) merged[key] = deepMerge(base[key], value)
  return merged
}

/** The kit's reference canvas as { width, height }. */
export function kitCanvas(kit) {
  return { width: kit.canvas[0], height: kit.canvas[1] }
}

/** The landscape canvas a 16:9 variant's pixels are written for (short side as the kit's). */
function landscapeCanvas(kit) {
  const short = Math.min(...kit.canvas)
  return { width: Math.round((short * 16) / 9), height: short }
}

/**
 * A section as one aspect sees it: `variants[aspect]` merged over it, and the
 * canvas its pixels are at (the variant's own `canvas`, else the kit's, or the
 * landscape canvas for 16:9). Undefined when the section has no such variant
 * and `aspect` is not the kit's own.
 */
export function kitSectionFor(kit, name, aspect) {
  const section = kit[name]
  if (!isObject(section)) return undefined
  const own = aspect === undefined || aspect === kitAspect(kit)
  if (own) return { section, canvas: kitCanvas(kit) }
  const variant = section.variants?.[aspect]
  if (!isObject(variant)) return undefined
  const { canvas, ...overrides } = variant
  const size = Array.isArray(canvas)
    ? { width: canvas[0], height: canvas[1] }
    : landscapeCanvas(kit)
  return { section: deepMerge(section, overrides), canvas: size }
}

/** The kit canvas's aspect key ("9:16" for 1080x1920). */
export function kitAspect(kit) {
  return aspectKey(kit.canvas[0], kit.canvas[1])
}

/** Every `must` rule of the kit, with its section. */
export function kitRules(kit) {
  return KIT_SECTIONS.flatMap((name) =>
    (Array.isArray(kit[name]?.must) ? kit[name].must : []).map((rule) => ({
      ...rule,
      section: name,
    })),
  )
}

/** "0.2.0" -> "0.2.1" (a pre-release or build suffix is dropped). */
export function bumpPatch(version) {
  const [major, minor, patch] = String(version).split(/[-+]/)[0].split('.').map(Number)
  return `${major}.${minor}.${(patch || 0) + 1}`
}
