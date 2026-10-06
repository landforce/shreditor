// Motion graphics templates: the file format and the pure logic both sides share.
//
// A template is a family of compositions (compound clips), one VARIANT per canvas
// aspect ratio (9:16, 16:9, ...), saved to the workspace library at
// `<workspace>/app/templates/<id>/template.json` plus one thumbnail per variant.
// Controls are shared across variants by name; each variant maps a name to its own
// item. The editor (TypeScript, through template-core.d.mts) and the agent tools
// (Node: shred and the edit service) build, read and look templates up with these
// functions, so both write exactly the same file. Format 1 files (one composition,
// no variants) still load: they read as a family with one variant.
import { FORMAT_ROLES } from '../../../formats/registry.mjs'
import { aspectKey, sortAspects } from '../projects/aspect.mjs'

const MOTION_TEMPLATE_FORMAT_VERSION = 2
export const MOTION_TEMPLATE_CATEGORIES = Object.freeze([
  'lower-third',
  'title',
  'callout',
  'transition',
  'overlay',
  'other',
])
const MOTION_TEMPLATE_CONTROL_PROPERTIES = Object.freeze([
  'text.text',
  'text.color',
  'shape.fillColor',
  'shape.strokeColor',
])
/** Library folder, relative to the workspace root. */
export const MOTION_TEMPLATES_DIR = ['app', 'templates']
export const MOTION_TEMPLATE_FILE = 'template.json'
/** The thumbnail of a format 1 (single variant) template. */
const MOTION_TEMPLATE_THUMBNAIL = 'thumbnail.jpg'
/** A variant's thumbnail file: transparent WebP, shown on a checkerboard. */
export const variantThumbnailFile = (aspect) => `thumbnail-${String(aspect).replace(':', 'x')}.webp`

const plainText = (item) => item.type === 'text' && !item.textSpans?.length

// What a control can point at (mirrors src/shared/utils/composition-controls.ts).
const CONTROL_READERS = {
  'text.text': (item) => (plainText(item) ? item.text : null),
  'text.color': (item) => (plainText(item) ? item.color : null),
  'shape.fillColor': (item) =>
    item.type === 'shape' && item.fillType !== 'linear' ? item.fillColor : null,
  'shape.strokeColor': (item) =>
    item.type === 'shape' && item.strokeEnabled && item.strokeColor ? item.strokeColor : null,
}

/** The value a control property reads from an item, or null when it does not apply. */
function readTemplateControlValue(item, property) {
  const reader = CONTROL_READERS[property]
  const value = reader ? reader(item) : null
  return typeof value === 'string' ? value : null
}

const controlKind = (property) => (property === 'text.text' ? 'text' : 'color')

/** The ids of compositions an item list nests (compound clips and their audio wrappers). */
function nestedCompositionIds(items) {
  return (items ?? []).flatMap((item) => (item.compositionId ? [item.compositionId] : []))
}

/** The root composition and every sub-composition it nests (root first). */
export function compositionClosure(rootId, compositions) {
  const byId = new Map((compositions ?? []).map((composition) => [composition.id, composition]))
  if (!byId.has(rootId)) throw new Error(`Composition "${rootId}" does not exist`)
  const seen = new Set()
  const out = []
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift()
    if (seen.has(id) || !byId.has(id)) continue
    seen.add(id)
    const composition = byId.get(id)
    out.push(composition)
    queue.push(...nestedCompositionIds(composition.items))
  }
  return out
}

/** Every media id the compositions' items use, sorted. */
function collectTemplateMediaIds(compositions) {
  const ids = new Set()
  for (const composition of compositions)
    for (const item of composition.items ?? []) if (item.mediaId) ids.add(item.mediaId)
  return [...ids].sort()
}

const normalizedName = (name) => String(name ?? '').trim()
const nameKey = (name) => normalizedName(name).toLowerCase()

function controlProblem(control, itemsById) {
  if (!normalizedName(control.name)) return 'every control needs a name'
  if (!MOTION_TEMPLATE_CONTROL_PROPERTIES.includes(control.property))
    return `control "${control.name}": property must be one of ${MOTION_TEMPLATE_CONTROL_PROPERTIES.join(', ')}`
  const target = itemsById.get(control.targetItemId)
  if (!target)
    return `control "${control.name}": item "${control.targetItemId}" is not inside the composition`
  if (readTemplateControlValue(target, control.property) === null)
    return `control "${control.name}": ${control.property} does not apply to ${target.type} "${target.label ?? target.id}"`
  return null
}

/**
 * Validate and complete control definitions against a composition's items: names
 * unique (case-insensitive), targets inside, property applicable, kind derived and
 * the default taken from the item when not given. Throws with every problem.
 */
export function resolveTemplateControls(composition, requested, newId) {
  const itemsById = new Map((composition.items ?? []).map((item) => [item.id, item]))
  const problems = []
  const names = new Set()
  const controls = []
  for (const control of requested ?? []) {
    const problem = controlProblem(control, itemsById)
    if (problem) {
      problems.push(problem)
      continue
    }
    const key = nameKey(control.name)
    if (names.has(key)) problems.push(`two controls are named "${normalizedName(control.name)}"`)
    names.add(key)
    const target = itemsById.get(control.targetItemId)
    controls.push({
      id: control.id || newId(),
      name: normalizedName(control.name),
      targetItemId: control.targetItemId,
      property: control.property,
      kind: controlKind(control.property),
      defaultValue:
        typeof control.defaultValue === 'string'
          ? control.defaultValue
          : readTemplateControlValue(target, control.property),
    })
  }
  if (problems.length > 0) throw new Error(problems.join('; '))
  return controls
}

/** A composition as it is stored in a template: no project-only tags or ranges. */
function storedComposition(composition) {
  const {
    templateId: _templateId,
    templateVersion: _templateVersion,
    templateAspect: _templateAspect,
    templateHold: _templateHold,
    inPoint: _inPoint,
    outPoint: _outPoint,
    ...rest
  } = composition
  // Tracks carry hydrated copies of their items; the items list is the source.
  return structuredClone({
    ...rest,
    tracks: (rest.tracks ?? []).map((track) => ({ ...track, items: [] })),
  })
}

function assertTemplateMeta({ name, category, role }) {
  if (!normalizedName(name) || normalizedName(name).length > 100)
    throw new Error('A template needs a name (1 to 100 characters)')
  if (!MOTION_TEMPLATE_CATEGORIES.includes(category))
    throw new Error(`category must be one of ${MOTION_TEMPLATE_CATEGORIES.join(', ')}`)
  if (role !== undefined && !FORMAT_ROLES.includes(role))
    throw new Error(`role must be one of ${FORMAT_ROLES.join(', ')}`)
}

// ---------------------------------------------------------------------------
// Hold: the frame (or range) a longer instance freezes on
// ---------------------------------------------------------------------------

/** What is wrong with a hold for a composition this long, or null. */
export function templateHoldProblem(hold, durationInFrames) {
  if (hold === undefined || hold === null) return null
  const { start, end } = hold
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start)
    return 'hold must be a frame, or a range start-end with start <= end'
  if (end >= durationInFrames)
    return `hold ${start === end ? start : `${start}-${end}`} is past the template's last frame (${durationInFrames - 1})`
  return null
}

/** Read "45" (one frame), "40-80" (a range) or "none" as a hold. */
export function parseTemplateHold(text) {
  const value = String(text ?? '').trim()
  if (!value || value.toLowerCase() === 'none') return null
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(value)
  if (!match) throw new Error(`hold "${value}" must be a frame (45), a range (40-80) or none`)
  const start = Number(match[1])
  return { start, end: match[2] === undefined ? start : Number(match[2]) }
}

/** "45" or "40-80". */
export const formatTemplateHold = (hold) =>
  hold ? (hold.start === hold.end ? `${hold.start}` : `${hold.start}-${hold.end}`) : ''

// ---------------------------------------------------------------------------
// Controls shared by name across variants
// ---------------------------------------------------------------------------

const variantList = (variants) =>
  sortAspects(Object.keys(variants ?? {})).map((aspect) => variants[aspect])

/** One entry per control name across the variants: what an instance can set. */
function summarizeControls(variants) {
  const byName = new Map()
  for (const variant of variantList(variants))
    for (const { name, kind, property, defaultValue } of variant.controls ?? [])
      if (!byName.has(nameKey(name)))
        byName.set(nameKey(name), { name, kind, property, defaultValue })
  return [...byName.values()]
}

/** Every media ref the variants use, one per media id. */
function unionMedia(variants) {
  const byId = new Map()
  for (const variant of variantList(variants))
    for (const ref of variant.media ?? []) if (!byId.has(ref.mediaId)) byId.set(ref.mediaId, ref)
  return [...byId.values()].sort((a, b) => a.mediaId.localeCompare(b.mediaId))
}

/** A control name must mean the same kind of value in every variant. */
function assertSharedControls(aspect, controls, variants) {
  const problems = []
  for (const other of variantList(variants)) {
    if (other.aspect === aspect) continue
    for (const control of controls) {
      const twin = other.controls.find((c) => nameKey(c.name) === nameKey(control.name))
      if (twin && twin.kind !== control.kind)
        problems.push(
          `control "${control.name}" is ${control.kind} in ${aspect} but ${twin.kind} in ${other.aspect}`,
        )
    }
  }
  if (problems.length > 0)
    throw new Error(`${problems.join('; ')} (controls are shared across versions by name)`)
}

function familyOf(meta, variants) {
  return {
    formatVersion: MOTION_TEMPLATE_FORMAT_VERSION,
    ...meta,
    variants,
    controls: summarizeControls(variants),
    media: unionMedia(variants),
  }
}

// ---------------------------------------------------------------------------
// Building a template (one variant at a time)
// ---------------------------------------------------------------------------

function resolveHold(hold, previousVariant, durationInFrames) {
  const chosen = hold === undefined ? previousVariant?.hold : hold
  const problem = templateHoldProblem(chosen, durationInFrames)
  if (problem) throw new Error(problem)
  return chosen ? { start: chosen.start, end: chosen.end } : undefined
}

function buildVariant({ root, subCompositions, controls, hold, version, now, mediaFileName }) {
  const composition = {
    ...storedComposition(root),
    // Published controls are authored on layer compositions; keep them editable.
    editorKind: 'composite-2d',
    compositionControls: controls.length > 0 ? { version: 1, controls } : undefined,
  }
  if (!composition.compositionControls) delete composition.compositionControls
  const aspect = aspectKey(root.width, root.height)
  return {
    aspect,
    version,
    updatedAt: now,
    width: root.width,
    height: root.height,
    fps: root.fps,
    durationInFrames: root.durationInFrames,
    ...(hold ? { hold } : {}),
    composition,
    subCompositions: subCompositions.map(storedComposition),
    controls,
    media: collectTemplateMediaIds([root, ...subCompositions]).map((mediaId) => ({
      mediaId,
      fileName: mediaFileName(mediaId),
    })),
    thumbnail: variantThumbnailFile(aspect),
  }
}

/**
 * Build a template from a project composition and the compositions it nests: the
 * variant for the composition's aspect ratio. `previous` is the library's current
 * template (same id): its other variants are kept and its version is bumped.
 * `controls` (optional) replaces the composition's published controls; `hold`
 * (undefined keeps the variant's current one, null clears it) is the frame or
 * range a longer instance freezes on.
 */
export function buildMotionTemplate({
  rootCompositionId,
  compositions,
  name,
  category = 'other',
  role,
  controls,
  hold,
  previous,
  mediaFileName = (id) => id,
  now = Date.now(),
  newId = () => crypto.randomUUID(),
}) {
  assertTemplateMeta({ name, category, role })
  const [root, ...subCompositions] = compositionClosure(rootCompositionId, compositions)
  const resolvedControls = resolveTemplateControls(
    root,
    controls ?? root.compositionControls?.controls ?? [],
    newId,
  )
  const aspect = aspectKey(root.width, root.height)
  const others = { ...previous?.variants }
  const version = (previous?.version ?? 0) + 1
  const variant = buildVariant({
    root,
    subCompositions,
    controls: resolvedControls,
    hold: resolveHold(hold, others[aspect], root.durationInFrames),
    version,
    now,
    mediaFileName,
  })
  assertSharedControls(aspect, resolvedControls, others)
  return familyOf(
    {
      id: previous?.id ?? newId(),
      name: normalizedName(name),
      category,
      ...(role ? { role } : {}),
      version,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    },
    { ...others, [aspect]: variant },
  )
}

/** Add (or replace) one variant of a template, bumping the template's version. */
export function withTemplateVariant(template, variant, now = Date.now()) {
  const version = template.version + 1
  assertSharedControls(variant.aspect, variant.controls, template.variants)
  const { formatVersion: _f, variants, controls: _c, media: _m, ...meta } = template
  return familyOf(
    { ...meta, version, updatedAt: now },
    { ...variants, [variant.aspect]: { ...variant, version, updatedAt: now } },
  )
}

// ---------------------------------------------------------------------------
// Reading template.json (format 2, and format 1 as a one-variant family)
// ---------------------------------------------------------------------------

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isPositive = (value) => Number.isFinite(value) && value > 0

function compositionProblem(composition, label) {
  if (!isObject(composition)) return `${label} is missing`
  if (typeof composition.id !== 'string' || !composition.id) return `${label} has no id`
  if (!Array.isArray(composition.items) || !Array.isArray(composition.tracks))
    return `${label} has no items or tracks`
  return null
}

// Each check names what is wrong with a template's identity, or returns null.
const META_CHECKS = [
  (value) =>
    typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id)
      ? null
      : 'invalid id',
  (value) => (normalizedName(value.name) ? null : 'missing name'),
  (value) => (Number.isInteger(value.version) && value.version >= 1 ? null : 'invalid version'),
]

// ...and with one composition-bearing body (a variant, or a format 1 file).
const BODY_CHECKS = [
  (value) =>
    [value.width, value.height, value.fps, value.durationInFrames].every(isPositive)
      ? null
      : 'invalid canvas or duration',
  (value) => compositionProblem(value.composition, 'composition'),
  (value) =>
    (Array.isArray(value.subCompositions) ? value.subCompositions : [])
      .map((sub, index) => compositionProblem(sub, `subCompositions[${index}]`))
      .find(Boolean) ?? null,
  (value) => templateHoldProblem(value.hold, value.durationInFrames),
]

const firstProblem = (checks, value) => checks.reduce((found, check) => found ?? check(value), null)

function variantProblem(variant, aspect) {
  if (!isObject(variant)) return `variant ${aspect} is not an object`
  const problem = firstProblem(BODY_CHECKS, variant)
  return problem ? `variant ${aspect}: ${problem}` : null
}

function familyProblem(value) {
  if (!isObject(value.variants) || Object.keys(value.variants).length === 0) return 'no variants'
  return (
    Object.entries(value.variants)
      .map(([aspect, variant]) => variantProblem(variant, aspect))
      .find(Boolean) ?? null
  )
}

function templateProblem(value) {
  if (!isObject(value)) return 'not a JSON object'
  if (value.formatVersion !== 1 && value.formatVersion !== MOTION_TEMPLATE_FORMAT_VERSION)
    return `unsupported formatVersion ${value.formatVersion}`
  return (
    firstProblem(META_CHECKS, value) ??
    (value.formatVersion === 1 ? firstProblem(BODY_CHECKS, value) : familyProblem(value))
  )
}

function readMedia(media) {
  return Array.isArray(media)
    ? media.filter((entry) => isObject(entry) && typeof entry.mediaId === 'string')
    : []
}

/** A variant with defaults filled; its key is its aspect. */
function readVariant(variant, aspect, fallbackVersion) {
  return {
    ...variant,
    aspect,
    version: Number.isInteger(variant.version) ? variant.version : fallbackVersion,
    subCompositions: Array.isArray(variant.subCompositions) ? variant.subCompositions : [],
    controls: variant.composition.compositionControls?.controls ?? [],
    media: readMedia(variant.media),
  }
}

/** A format 1 file as a family with its one variant. */
function variantsOfFormat1(value) {
  const aspect = aspectKey(value.width, value.height)
  const { width, height, fps, durationInFrames, composition, subCompositions, media } = value
  return {
    [aspect]: {
      version: value.version,
      updatedAt: value.updatedAt,
      width,
      height,
      fps,
      durationInFrames,
      composition,
      subCompositions,
      media,
      thumbnail: MOTION_TEMPLATE_THUMBNAIL,
    },
  }
}

/** Check a template.json body; returns the template family with defaults filled, or throws. */
export function parseMotionTemplate(value) {
  const problem = templateProblem(value)
  if (problem) throw new Error(`Invalid template: ${problem}`)
  const raw = value.formatVersion === 1 ? variantsOfFormat1(value) : value.variants
  const variants = Object.fromEntries(
    Object.entries(raw).map(([aspect, variant]) => [
      aspect,
      readVariant(variant, aspect, value.version),
    ]),
  )
  return familyOf(
    {
      id: value.id,
      name: normalizedName(value.name),
      category: MOTION_TEMPLATE_CATEGORIES.includes(value.category) ? value.category : 'other',
      ...(FORMAT_ROLES.includes(value.role) ? { role: value.role } : {}),
      version: value.version,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    },
    variants,
  )
}

// ---------------------------------------------------------------------------
// Variants: which one a canvas uses
// ---------------------------------------------------------------------------

/** The template's aspect ratios, named ones first. */
export const templateAspects = (template) => sortAspects(Object.keys(template.variants ?? {}))

/**
 * One variant seen as an insertable template: the family's identity with the
 * variant's canvas, compositions, controls, hold and version. Null when the
 * template has no variant for that aspect.
 */
export function templateVariant(template, aspect) {
  const variant = template.variants?.[aspect]
  if (!variant) return null
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    ...(template.role ? { role: template.role } : {}),
    templateVersion: template.version,
    ...variant,
    aspect,
  }
}

/** Why a template cannot go into a canvas of this aspect, with the way to fix it. */
function missingVariantMessage(template, aspect) {
  const have = templateAspects(template).join(', ')
  return (
    `"${template.name}" has no ${aspect} version (it has ${have}). ` +
    `Make one with: shred templates clone "${template.name}" --aspect ${aspect}`
  )
}

/** The variant whose aspect matches the canvas exactly; throws (naming the fix) when there is none. */
export function chooseTemplateVariant(template, canvas) {
  const aspect = aspectKey(canvas.width, canvas.height)
  const view = templateVariant(template, aspect)
  if (!view) throw new Error(missingVariantMessage(template, aspect))
  return view
}

/** Look a template up by id, else by name (case-insensitive). Throws when a name is ambiguous. */
export function findMotionTemplate(templates, ref) {
  const byId = templates.find((template) => template.id === ref)
  if (byId) return byId
  const named = [
    ...new Map(
      templates
        .filter((template) => nameKey(template.name) === nameKey(ref))
        .map((template) => [template.id, template]),
    ).values(),
  ]
  if (named.length > 1)
    throw new Error(
      `${named.length} templates are named "${ref}" (${named.map((t) => t.id).join(', ')}); use the id`,
    )
  return named[0] ?? null
}
