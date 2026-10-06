// What a kit rule is about, on a project's timeline: the items that are the
// kit's titles, captions, overlays, images, plates and objects, their boxes
// as the renderer lays them out (dumpLayout), and the named regions (safe
// zones, the plate's key content) in project pixels.
import { resolveItemRoles } from '../scorecard.mjs'
import { kitCanvas } from './kit.mjs'

/** Which element a `kit:*` text style makes; null = none the rules are about. */
const STYLE_ELEMENT = {
  'kit:title': 'titles',
  'kit:caption': 'captions',
  'kit:caption-low': 'captions',
  'kit:overlay': 'overlays',
  'kit:listicle-headline': 'overlays',
}

const ROLE_ELEMENT = {
  title: 'titles',
  captions: 'captions',
  labels: 'overlays',
  images: 'images',
  plates: 'plates',
  speaker: 'speaker',
}

const PICTURES = new Set(['video', 'image', 'composition', 'lottie'])

function textElement(item, role) {
  const styleId = item.textStyleId
  if (typeof styleId === 'string' && styleId.startsWith('kit:')) {
    return STYLE_ELEMENT[styleId] ?? STYLE_ELEMENT[styleId.replace(/-\d+$/, '')] ?? null
  }
  if (item.type === 'subtitle') return 'captions'
  return ['titles', 'captions', 'overlays'].includes(ROLE_ELEMENT[role]) ? ROLE_ELEMENT[role] : null
}

function pictureElement(item, role, mediaById) {
  const category = mediaById?.[item.mediaId]?.category
  if (category === 'overlay') return 'objects'
  const element = ROLE_ELEMENT[role]
  return ['images', 'plates', 'speaker'].includes(element) ? element : null
}

function elementOf(item, role, mediaById) {
  if (item.type === 'text' || item.type === 'subtitle') return textElement(item, role)
  if (PICTURES.has(item.type)) return pictureElement(item, role, mediaById)
  return null
}

/**
 * The project's items by kit element ({ titles, captions, overlays, images,
 * plates, speaker, objects }), sorted by start. Items on hidden tracks don't
 * count. A text item's `kit:*` style says what it is; otherwise its format
 * role does (title, captions, labels = overlays).
 */
export function kitElements(project, { mediaById = {} } = {}) {
  const timeline = project?.timeline ?? { tracks: [], items: [] }
  const hidden = new Set(timeline.tracks.filter((t) => t.visible === false).map((t) => t.id))
  const roles = project?.format ? resolveItemRoles(project, { mediaById }) : new Map()
  const elements = {
    titles: [],
    captions: [],
    overlays: [],
    images: [],
    plates: [],
    speaker: [],
    objects: [],
  }
  for (const item of timeline.items) {
    if (hidden.has(item.trackId)) continue
    const element = elementOf(item, roles.get(item.id)?.role, mediaById)
    if (element) elements[element].push(item)
  }
  for (const list of Object.values(elements)) list.sort((a, b) => a.from - b.from)
  return elements
}

/** Bounding rect of rects ({ x, y, width, height }). */
function union(rects) {
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.width))
  const bottom = Math.max(...rects.map((r) => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function textBox(text, item) {
  const backgrounds = text.lineBackgrounds ?? (text.background ? [text.background] : [])
  if (backgrounds.length) return union(backgrounds)
  const lines = (text.lines ?? []).filter((line) => line.text.trim() !== '')
  if (!lines.length) return null
  const box = union(lines)
  // The kit's box includes the outline, drawn outward from the glyphs.
  const stroke = item.stroke?.width ?? 0
  return {
    x: box.x - stroke,
    y: box.y - stroke,
    width: box.width + stroke * 2,
    height: box.height + stroke * 2,
  }
}

/**
 * The box the kit means for an item, from its dumpLayout entry: for text, the
 * background boxes (one per line in 'lines' mode), else the lines plus the
 * outline; for pictures, the drawn box. Null without a layout.
 */
export function itemBox(item, layout) {
  if (!layout) return null
  if (layout.textLayout) return textBox(layout.textLayout, item)
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height }
}

/** Rendered line count of a text item (dumpLayout), or null without a layout. */
export function lineCount(layout) {
  return layout?.textLayout ? layout.textLayout.lines.length : null
}

/**
 * Kit pixels -> project pixels, when the project's canvas has the kit's
 * aspect (a uniform scale); null when it doesn't (the kit's positions are for
 * its own canvas).
 */
export function kitScale(kit, project) {
  const width = project?.metadata?.width
  const height = project?.metadata?.height
  if (!width || !height) return 1
  const canvas = kitCanvas(kit)
  const same = Math.abs(width / height - canvas.width / canvas.height) < 0.01
  return same ? width / canvas.width : null
}

const rectOf = (r, scale) => ({
  x: r.x * scale,
  y: r.y * scale,
  width: r.w * scale,
  height: r.h * scale,
})

/** Named fixed regions in project pixels: the safe zones and the plate's key content. */
export function kitRegions(kit, scale) {
  const regions = {}
  for (const [name, r] of Object.entries(kit.safeZones ?? {})) regions[name] = rectOf(r, scale)
  if (kit.greenscreen?.plateKeyContent)
    regions.plateKeyContent = rectOf(kit.greenscreen.plateKeyContent, scale)
  return regions
}

/** Overlap area of two rects (0 when they only touch). */
export function overlapArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0.5 && h > 0.5 ? w * h : 0
}

/** Intersection-over-union of two rects. */
export function iou(a, b) {
  const overlap = overlapArea(a, b)
  const total = a.width * a.height + b.width * b.height - overlap
  return total > 0 ? overlap / total : 0
}
