// Motion graphics templates: the file format and the pure logic both sides share.
//
// A template is a composition (a compound clip) saved to the workspace library at
// `<workspace>/app/templates/<id>/template.json` (plus `thumbnail.jpg`). The editor
// (TypeScript, through template-core.d.mts) and the agent tools (Node: shred and the
// edit service) build, read and look templates up with these functions, so both
// write exactly the same file.
import { FORMAT_ROLES } from '../../../formats/registry.mjs'

const MOTION_TEMPLATE_FORMAT_VERSION = 1
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
export const MOTION_TEMPLATE_THUMBNAIL = 'thumbnail.jpg'

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

/**
 * Build a template from a project composition and the compositions it nests.
 * `controls` (optional) replaces the composition's published controls; `previous`
 * is the library's current file for this template, whose version is bumped.
 */
export function buildMotionTemplate({
  rootCompositionId,
  compositions,
  name,
  category = 'other',
  role,
  controls,
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
  const composition = {
    ...storedComposition(root),
    // Published controls are authored on layer compositions; keep them editable.
    editorKind: 'composite-2d',
    compositionControls:
      resolvedControls.length > 0 ? { version: 1, controls: resolvedControls } : undefined,
  }
  if (!composition.compositionControls) delete composition.compositionControls
  const all = [root, ...subCompositions]
  return {
    formatVersion: MOTION_TEMPLATE_FORMAT_VERSION,
    id: previous?.id ?? newId(),
    name: normalizedName(name),
    category,
    ...(role ? { role } : {}),
    version: (previous?.version ?? 0) + 1,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    width: root.width,
    height: root.height,
    fps: root.fps,
    durationInFrames: root.durationInFrames,
    composition,
    subCompositions: subCompositions.map(storedComposition),
    controls: resolvedControls,
    media: collectTemplateMediaIds(all).map((mediaId) => ({
      mediaId,
      fileName: mediaFileName(mediaId),
    })),
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isPositive = (value) => Number.isFinite(value) && value > 0

function compositionProblem(composition, label) {
  if (!isObject(composition)) return `${label} is missing`
  if (typeof composition.id !== 'string' || !composition.id) return `${label} has no id`
  if (!Array.isArray(composition.items) || !Array.isArray(composition.tracks))
    return `${label} has no items or tracks`
  return null
}

// Each check names what is wrong with a template.json body, or returns null.
const TEMPLATE_CHECKS = [
  (value) => (isObject(value) ? null : 'not a JSON object'),
  (value) =>
    value.formatVersion === MOTION_TEMPLATE_FORMAT_VERSION
      ? null
      : `unsupported formatVersion ${value.formatVersion}`,
  (value) =>
    typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id)
      ? null
      : 'invalid id',
  (value) => (normalizedName(value.name) ? null : 'missing name'),
  (value) => (Number.isInteger(value.version) && value.version >= 1 ? null : 'invalid version'),
  (value) =>
    [value.width, value.height, value.fps, value.durationInFrames].every(isPositive)
      ? null
      : 'invalid canvas or duration',
  (value) => compositionProblem(value.composition, 'composition'),
  (value) =>
    (Array.isArray(value.subCompositions) ? value.subCompositions : [])
      .map((sub, index) => compositionProblem(sub, `subCompositions[${index}]`))
      .find(Boolean) ?? null,
]

function templateProblem(value) {
  for (const check of TEMPLATE_CHECKS) {
    const problem = check(value)
    if (problem) return problem
  }
  return null
}

/** Check a template.json body; returns the template with defaults filled, or throws. */
export function parseMotionTemplate(value) {
  const problem = templateProblem(value)
  if (problem) throw new Error(`Invalid template: ${problem}`)
  return {
    ...value,
    name: normalizedName(value.name),
    category: MOTION_TEMPLATE_CATEGORIES.includes(value.category) ? value.category : 'other',
    subCompositions: Array.isArray(value.subCompositions) ? value.subCompositions : [],
    controls: value.composition.compositionControls?.controls ?? [],
    media: Array.isArray(value.media)
      ? value.media.filter((entry) => isObject(entry) && typeof entry.mediaId === 'string')
      : [],
  }
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
