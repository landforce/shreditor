// Making a motion template variant for another aspect ratio from an existing one:
// a sensible starting point the user (or agent) then adjusts. Each top-level item
// keeps its place relative to the nearest frame edge or the centre (a bar near the
// bottom stays near the bottom, a centred title stays centred), and sizes scale by
// the canvas's short side. Keyframed positions and sizes move the same way.
import { aspectRatio, closestAspect } from '../projects/aspect.mjs'
import { templateAspects, variantThumbnailFile, withTemplateVariant } from './template-core.mjs'

// Pixel sizes on items that scale with the canvas (transform ones are handled per axis).
const SCALED_ITEM_FIELDS = ['fontSize', 'letterSpacing', 'strokeWidth', 'cornerRadius']
const SCALED_TRANSFORM_FIELDS = ['width', 'height', 'anchorX', 'anchorY', 'cornerRadius']

/**
 * Which part of the frame an item holds on to along one axis: its near edge
 * ('start' / 'end') when that is closer than its centre is to the frame centre.
 * `offset` is the item centre's offset from the frame centre, `size` its extent.
 */
export function axisAnchor(offset, size, frameSize) {
  const half = frameSize / 2
  const toStart = offset - size / 2 + half
  const toEnd = half - (offset + size / 2)
  const toCentre = Math.abs(offset)
  if (toCentre <= Math.min(toStart, toEnd)) return 'centre'
  return toStart < toEnd ? 'start' : 'end'
}

const anchorCoordinate = (anchor, frameSize) =>
  anchor === 'start' ? -frameSize / 2 : anchor === 'end' ? frameSize / 2 : 0

/** v' = A' + (v - A) * s: keeps the distance to the anchor, scaled. */
function anchoredMap(anchor, fromSize, toSize, scale) {
  const from = anchorCoordinate(anchor, fromSize)
  const to = anchorCoordinate(anchor, toSize)
  return (value) => to + (value - from) * scale
}

/** The side of the frame a position puts the whole item beyond, if any. */
function offFrameSide(value, size, frameSize) {
  if (value + size / 2 <= -frameSize / 2) return 'start'
  if (value - size / 2 >= frameSize / 2) return 'end'
  return null
}

/**
 * One axis of an item: its anchor's map, except that a position (a keyframe)
 * with the item wholly off the frame stays off that side (a slide-in still
 * starts out of view).
 */
function axisMap(anchor, size, fromSize, toSize, scale) {
  const maps = {
    start: anchoredMap('start', fromSize, toSize, scale),
    centre: anchoredMap('centre', fromSize, toSize, scale),
    end: anchoredMap('end', fromSize, toSize, scale),
  }
  return (value) => maps[offFrameSide(value, size, fromSize) ?? anchor](value)
}

const scaleBy = (scale) => (value) => value * scale

function itemBox(item, from) {
  const t = item.transform ?? {}
  return {
    x: t.x ?? 0,
    y: t.y ?? 0,
    // No explicit size: the item fills the canvas (it is laid out in it).
    width: t.width ?? from.width,
    height: t.height ?? from.height,
  }
}

/** The per-property maps one item's transform and keyframes go through. */
function itemMaps(item, from, to, scale) {
  const box = itemBox(item, from)
  const xAnchor = axisAnchor(box.x, box.width, from.width)
  const yAnchor = axisAnchor(box.y, box.height, from.height)
  const x = axisMap(xAnchor, box.width, from.width, to.width, scale)
  const y = axisMap(yAnchor, box.height, from.height, to.height, scale)
  const size = scaleBy(scale)
  return { x, y, width: size, height: size, anchorX: size, anchorY: size, cornerRadius: size }
}

function mapTransform(transform, maps) {
  if (!transform) return transform
  const next = { ...transform }
  if (transform.x !== undefined) next.x = maps.x(transform.x)
  if (transform.y !== undefined) next.y = maps.y(transform.y)
  for (const field of SCALED_TRANSFORM_FIELDS)
    if (typeof transform[field] === 'number') next[field] = maps[field](transform[field])
  return next
}

function scaleFields(target, fields, scale) {
  const next = { ...target }
  for (const field of fields)
    if (typeof target[field] === 'number') next[field] = target[field] * scale
  return next
}

function mapItem(item, maps, scale) {
  const next = scaleFields(
    { ...item, transform: mapTransform(item.transform, maps) },
    SCALED_ITEM_FIELDS,
    scale,
  )
  if (!item.transform) delete next.transform
  if (Array.isArray(item.textSpans))
    next.textSpans = item.textSpans.map((span) =>
      scaleFields(span, ['fontSize', 'letterSpacing'], scale),
    )
  return next
}

function scaleSpatial(spatial, scale) {
  if (!spatial || typeof spatial !== 'object') return spatial
  return Object.fromEntries(
    Object.entries(spatial).map(([key, value]) => [
      key,
      typeof value === 'number'
        ? value * scale
        : value && typeof value === 'object'
          ? scaleSpatial(value, scale)
          : value,
    ]),
  )
}

function mapScalarLanes(properties, maps) {
  return (properties ?? []).map((lane) => {
    const map = maps[lane.property]
    if (!map) return lane
    return { ...lane, keyframes: lane.keyframes.map((k) => ({ ...k, value: map(k.value) })) }
  })
}

function mapVectorLanes(vectorProperties, maps, scale) {
  return (vectorProperties ?? []).map((lane) => {
    if (lane.property !== 'position') return lane
    return {
      ...lane,
      keyframes: lane.keyframes.map((k) => ({
        ...k,
        value: { x: maps.x(k.value.x), y: maps.y(k.value.y) },
        ...(k.spatial ? { spatial: scaleSpatial(k.spatial, scale) } : {}),
      })),
    }
  })
}

function mapKeyframes(entry, maps, scale) {
  if (!maps) return entry
  const next = { ...entry, properties: mapScalarLanes(entry.properties, maps) }
  if (entry.vectorProperties)
    next.vectorProperties = mapVectorLanes(entry.vectorProperties, maps, scale)
  return next
}

/**
 * A copy of a composition re-laid for another canvas size: every item keeps its
 * nearest anchor, sizes scale by the short side. Nested compositions keep their
 * own canvas (their wrapper item moves and scales like any other item).
 */
export function adaptCompositionToCanvas(composition, to) {
  const from = { width: composition.width, height: composition.height }
  const scale = Math.min(to.width, to.height) / Math.min(from.width, from.height)
  const mapsById = new Map(
    composition.items.map((item) => [item.id, itemMaps(item, from, to, scale)]),
  )
  return {
    ...structuredClone(composition),
    width: to.width,
    height: to.height,
    items: composition.items.map((item) => mapItem(item, mapsById.get(item.id), scale)),
    keyframes: (composition.keyframes ?? []).map((entry) =>
      mapKeyframes(entry, mapsById.get(entry.itemId), scale),
    ),
  }
}

/** The variant a new aspect starts from: the one asked for, else the closest ratio. */
export function cloneSourceAspect(template, aspect, from) {
  const aspects = templateAspects(template)
  if (from) {
    if (!template.variants[from])
      throw new Error(`"${template.name}" has no ${from} version (it has ${aspects.join(', ')})`)
    return from
  }
  return closestAspect(aspect, aspects)
}

/**
 * Add a variant for `aspect` at `canvas` size, copied from `from` (default: the
 * variant with the closest ratio) and re-laid for the new canvas. The template's
 * version is bumped; the new variant keeps the source's controls (same names,
 * same items), hold and media. Throws when the variant already exists.
 */
export function cloneTemplateVariant(template, { aspect, canvas, from, now = Date.now() }) {
  if (template.variants[aspect])
    throw new Error(`"${template.name}" already has a ${aspect} version`)
  if (Math.abs(aspectRatio(aspect) / (canvas.width / canvas.height) - 1) > 0.01)
    throw new Error(`${canvas.width}x${canvas.height} is not ${aspect}`)
  const sourceAspect = cloneSourceAspect(template, aspect, from)
  const source = template.variants[sourceAspect]
  const composition = adaptCompositionToCanvas(source.composition, canvas)
  const variant = {
    ...structuredClone(source),
    aspect,
    width: canvas.width,
    height: canvas.height,
    composition,
    thumbnail: variantThumbnailFile(aspect),
  }
  return { template: withTemplateVariant(template, variant, now), from: sourceAspect }
}
