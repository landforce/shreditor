// Kit checks: every `must` rule of a Video Style Kit, measured on a project's
// timeline and its rendered layout (dumpLayout boxes and line counts), next to
// the format scorecard in `shred check`.
//
//   scoreKit(project, kit, { layouts, mediaById })
//     -> { creator, kitVersion, checks: [{ id, section, text, type, status,
//          detail, ranges: [{ startFrame, endFrame }] }], summary }
//
// status: 'pass' | 'fail' | 'warn' | 'look' (a visual judgment: look at the
// frames in `ranges`) | 'listen' (an audio judgment) | 'na' (nothing to check,
// or not checkable here: the reason is in `detail`). A judgment check is never
// 'pass'. `layouts` maps item id -> its dumpLayout entry at a frame where it
// is on screen; geometric checks of an item without one are 'na'.
import { kitRules } from './kit.mjs'
import {
  iou,
  itemBox,
  kitElements,
  kitRegions,
  kitScale,
  lineCount,
  overlapArea,
} from './elements.mjs'

const MAX_RANGES = 20

/** Which elements a section's rules are about. */
const SECTION_ELEMENT = {
  titles: 'titles',
  captions: 'captions',
  overlays: 'overlays',
  images: 'images',
  greenscreen: 'plates',
  objects: 'objects',
}

const NOUN = {
  titles: 'title',
  captions: 'caption',
  overlays: 'overlay',
  images: 'image',
  plates: 'plate',
  objects: 'object',
  speaker: 'speaker',
}

const range = (startFrame, endFrame) => ({ startFrame, endFrame })
const itemRange = (item) => range(item.from, item.from + item.durationInFrames)
const seconds = (frames, ctx) => (frames / ctx.fps).toFixed(2)
const label = (item) =>
  JSON.stringify(
    String(item.text ?? item.label ?? item.id)
      .replace(/\s+/g, ' ')
      .slice(0, 40),
  )

function mergeRanges(ranges) {
  const merged = []
  for (const r of [...ranges].sort((a, b) => a.startFrame - b.startFrame)) {
    const last = merged.at(-1)
    if (last && r.startFrame <= last.endFrame) last.endFrame = Math.max(last.endFrame, r.endFrame)
    else merged.push({ ...r })
  }
  return merged.slice(0, MAX_RANGES)
}

const none = (ctx, element) => ({ status: 'na', detail: `no ${NOUN[element]}s on the timeline` })
const fail = (detail, items) => ({
  status: 'fail',
  detail,
  ranges: mergeRanges(items.map(itemRange)),
})
const judged = (status, detail, items) => ({
  status,
  detail,
  ranges: mergeRanges(items.map(itemRange)),
})

/** Items with their measured box; items without a layout are counted apart. */
function measured(items, ctx) {
  const boxes = []
  const missing = []
  for (const item of items) {
    const box = itemBox(item, ctx.layouts.get(item.id))
    if (box) boxes.push({ item, box })
    else missing.push(item)
  }
  return { boxes, missing }
}

/**
 * Geometric rule over each item's box: `offends(box)` says why one breaks it
 * (a string) or null. Positions are kit pixels, so a project of another
 * aspect is 'na'.
 */
function perBox(ctx, items, element, offends) {
  if (!items.length) return none(ctx, element)
  if (ctx.scale === null)
    return {
      status: 'na',
      detail: "the project's canvas isn't the kit's aspect; the kit's positions don't apply",
    }
  const { boxes, missing } = measured(items, ctx)
  if (!boxes.length) return { status: 'na', detail: 'no rendered layout for these items' }
  const bad = boxes
    .map((entry) => ({ ...entry, why: offends(entry.box, entry.item) }))
    .filter((e) => e.why)
  const unmeasured = missing.length ? `; ${missing.length} without a layout` : ''
  if (!bad.length)
    return {
      status: 'pass',
      detail: `${boxes.length} ${NOUN[element]}(s), ${extent(boxes)}${unmeasured}`,
    }
  return fail(
    `${bad
      .slice(0, 3)
      .map((e) => `${label(e.item)} ${e.why}`)
      .join('; ')}${bad.length > 3 ? `; ${bad.length - 3} more` : ''}`,
    bad.map((e) => e.item),
  )
}

const px = (value) => Math.round(value)
const extent = (boxes) =>
  `boxes x ${px(Math.min(...boxes.map((e) => e.box.x)))}-${px(Math.max(...boxes.map((e) => e.box.x + e.box.width)))}, y ${px(Math.min(...boxes.map((e) => e.box.y)))}-${px(Math.max(...boxes.map((e) => e.box.y + e.box.height)))}`
const span = (box) => `y ${px(box.y)}-${px(box.y + box.height)}`

// ---------------------------------------------------------------------------
// Measured checks: (ctx, items, rule, element) -> { status, detail, ranges? }
// ---------------------------------------------------------------------------

function onScreenFrom(ctx, items, rule, element) {
  const start = Math.round(rule.check.frame ?? 0)
  const need = Math.round((rule.check.minSeconds ?? 0) * ctx.fps)
  const runs = mergeRanges(items.map(itemRange))
  const run = runs.find((r) => r.startFrame <= start && r.endFrame > start)
  const held = run ? run.endFrame - start : 0
  const reachesEnd = run && run.endFrame >= ctx.end
  if (held >= need || reachesEnd)
    return { status: 'pass', detail: `on screen from frame ${start} for ${seconds(held, ctx)} s` }
  const detail = run
    ? `on screen ${seconds(held, ctx)} s from frame ${start}; needs ${rule.check.minSeconds} s`
    : `no ${NOUN[element]} on screen at frame ${start}`
  return { status: 'fail', detail, ranges: [range(start, start + need)] }
}

function inZone(ctx, items, rule, element) {
  const [min, max] = rule.check.y.map((y) => y * (ctx.scale ?? 1))
  return perBox(ctx, items, element, (box) =>
    box.y < min - 0.5 || box.y + box.height > max + 0.5
      ? `box ${span(box)}, outside ${px(min)}-${px(max)}`
      : null,
  )
}

function bottomAbove(ctx, items, rule, element) {
  const limit = rule.check.y * (ctx.scale ?? 1)
  return perBox(ctx, items, element, (box) =>
    box.y + box.height > limit + 0.5
      ? `bottom at y ${px(box.y + box.height)}, below ${px(limit)}`
      : null,
  )
}

function maxLines(ctx, items, rule, element) {
  if (!items.length) return none(ctx, element)
  const counted = items.map((item) => ({ item, lines: lineCount(ctx.layouts.get(item.id)) }))
  const known = counted.filter((entry) => entry.lines !== null)
  if (!known.length) return { status: 'na', detail: 'no rendered layout for these items' }
  const bad = known.filter((entry) => entry.lines > rule.check.value)
  if (!bad.length)
    return { status: 'pass', detail: `at most ${Math.max(...known.map((e) => e.lines))} line(s)` }
  const hint = smallSizeHint(ctx, element)
  return fail(
    `${bad.map((e) => `${label(e.item)} wraps to ${e.lines} lines`).join('; ')}${hint}`,
    bad.map((e) => e.item),
  )
}

function smallSizeHint(ctx, element) {
  const style = element === 'titles' ? ctx.kit.titles?.style : undefined
  return style?.sizeSmall ? ` (the kit: use ${style.sizeSmall}px before adding a line)` : ''
}

/** Items in a row with the same text, back to back, are one element (a title split by a cut). */
function distinct(items) {
  const groups = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last && last.text === item.text && item.from <= last.end)
      last.end = Math.max(last.end, item.from + item.durationInFrames)
    else groups.push({ text: item.text, end: item.from + item.durationInFrames, item })
  }
  return groups
}

function count(ctx, items, rule, element) {
  const groups = distinct(items)
  const detail = `${groups.length} ${NOUN[element]}(s)`
  if (groups.length <= rule.check.max) return { status: 'pass', detail }
  return fail(
    `${detail}, at most ${rule.check.max}`,
    groups.slice(rule.check.max).map((g) => g.item),
  )
}

function nearY(ctx, items, rule, element) {
  if (!items.length) return none(ctx, element)
  const target = rule.check.y * (ctx.scale ?? 1)
  const { boxes } = measured(items, ctx)
  if (!boxes.length || ctx.scale === null)
    return judged('look', `look: placed near y=${rule.check.y}`, items)
  const offsets = boxes.map((e) => Math.abs(e.box.y + e.box.height / 2 - target))
  const detail = `centres up to ${px(Math.max(...offsets))} px from y=${px(target)} (median ${px(median(offsets))})`
  if (rule.check.judgment) return judged(rule.check.judgment, detail, items)
  return { status: Math.max(...offsets) <= ctx.height * 0.05 ? 'pass' : 'warn', detail, ranges: [] }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

// ---------------------------------------------------------------------------
// clearOf: fixed regions (safe zones, the plate's key content while a plate
// is up) and timed ones (titles, images), overlapping only in frames where
// both are on screen. speaker/face can't be measured: they make it a look.
// ---------------------------------------------------------------------------

const TIMED_REGIONS = { title: 'titles', titles: 'titles', images: 'images', image: 'images' }
const LOOK_REGIONS = new Set(['speaker', 'face'])

function overlapFrames(a, b) {
  const start = Math.max(a.from, b.from)
  const end = Math.min(a.from + a.durationInFrames, b.from + b.durationInFrames)
  return end > start ? range(start, end) : null
}

function fixedRegion(ctx, name) {
  const rect = ctx.regions[name]
  if (!rect) return undefined
  // The plate's key content is there only while a plate is up.
  const during = name === 'plateKeyContent' ? ctx.elements.plates : null
  return { name, rect, during }
}

function fixedHits(entry, region) {
  if (!overlapArea(entry.box, region.rect)) return []
  if (!region.during) return [{ region: region.name, range: itemRange(entry.item) }]
  return region.during
    .map((plate) => overlapFrames(entry.item, plate))
    .filter(Boolean)
    .map((frames) => ({ region: region.name, range: frames }))
}

function timedHits(entry, others, regionName, ctx) {
  return others
    .filter((other) => other.id !== entry.item.id)
    .flatMap((other) => {
      const frames = overlapFrames(entry.item, other)
      const box = frames ? itemBox(other, ctx.layouts.get(other.id)) : null
      return box && overlapArea(entry.box, box)
        ? [{ region: `${regionName} ${label(other)}`, range: frames }]
        : []
    })
}

function hitsFor(entry, regions, ctx) {
  return regions.flatMap((name) => {
    if (TIMED_REGIONS[name]) return timedHits(entry, ctx.elements[TIMED_REGIONS[name]], name, ctx)
    const region = fixedRegion(ctx, name)
    return region ? fixedHits(entry, region) : []
  })
}

/** Why a clearOf rule can't be measured here (a result), or null when it can. */
function clearOfShortcut(ctx, { subject, subjects, regions, element }) {
  if (!subjects.length) return none(ctx, subject ? 'speaker' : element)
  const onlyPlate = regions.every((name) => name === 'plateKeyContent')
  if (subject && onlyPlate && !ctx.elements.plates.length)
    return { status: 'na', detail: 'no plates on the timeline (the key content is on a plate)' }
  if (LOOK_REGIONS.has(subject)) {
    const what = `look: the ${subject}'s outline isn't measurable; keep it clear of ${regions.join(', ')}`
    return judged('look', what, subjects)
  }
  if (ctx.scale === null) return OTHER_ASPECT
  return null
}

const OTHER_ASPECT = {
  status: 'na',
  detail: "the project's canvas isn't the kit's aspect; the kit's regions don't apply",
}

function clearOf(ctx, items, rule, element) {
  const regions = rule.check.regions ?? []
  const subject = rule.check.subject
  const subjects = subject ? (ctx.elements[subject] ?? []) : items
  const shortcut = clearOfShortcut(ctx, { subject, subjects, regions, element })
  if (shortcut) return shortcut
  const looks = regions.filter((name) => LOOK_REGIONS.has(name))
  const known = (name) => LOOK_REGIONS.has(name) || TIMED_REGIONS[name] || name in ctx.regions
  const unknown = regions.filter((name) => !known(name))
  const { boxes } = measured(subjects, ctx)
  const hits = boxes.flatMap((entry) =>
    hitsFor(entry, regions, ctx).map((hit) => ({ ...hit, item: entry.item })),
  )
  return clearOfResult(hits, { boxes, looks, unknown, subjects, regions, element })
}

function clearOfResult(hits, { boxes, looks, unknown, subjects, regions, element }) {
  const notes = unknown.length ? `; unknown region(s): ${unknown.join(', ')}` : ''
  if (hits.length) {
    const lines = hits
      .slice(0, 3)
      .map(
        (h) =>
          `${label(h.item)} overlaps ${h.region} at frames ${h.range.startFrame}-${h.range.endFrame}`,
      )
    return {
      status: 'fail',
      detail: `${lines.join('; ')}${hits.length > 3 ? `; ${hits.length - 3} more` : ''}${notes}`,
      ranges: mergeRanges(hits.map((h) => h.range)),
    }
  }
  if (!boxes.length) return { status: 'na', detail: 'no rendered layout for these items' }
  const measuredRegions = regions.filter((name) => !looks.includes(name) && !unknown.includes(name))
  if (looks.length)
    return judged(
      'look',
      `clear of ${measuredRegions.join(', ') || 'nothing measurable'}; look: clear of the ${looks.join(' and ')}${notes}`,
      subjects,
    )
  return {
    status: 'pass',
    detail: `${boxes.length} ${NOUN[element]}(s) clear of ${measuredRegions.join(', ')}${notes}`,
  }
}

// ---------------------------------------------------------------------------
// Images, plates and objects
// ---------------------------------------------------------------------------

/** The kit image placement an image's box is closest to (by overlap), or 'custom'. */
function placementOf(box, ctx) {
  const scale = ctx.scale ?? 1
  let best = { name: 'custom', score: 0.5 }
  for (const [name, option] of Object.entries(ctx.kit.images?.options ?? {})) {
    const r = option.rect
    if (!r) continue
    const score = iou(box, {
      x: r.x * scale,
      y: r.y * scale,
      width: r.w * scale,
      height: r.h * scale,
    })
    if (score > best.score) best = { name, score }
  }
  return best.name
}

function groupBy(list, keyOf) {
  const groups = new Map()
  for (const entry of list) groups.set(keyOf(entry), [...(groups.get(keyOf(entry)) ?? []), entry])
  return groups
}

function onePlacementPerVideo(ctx, items, rule, element) {
  if (!items.length) return none(ctx, element)
  const { boxes } = measured(items, ctx)
  if (!boxes.length) return { status: 'na', detail: 'no rendered layout for these items' }
  const named = boxes.map((entry) => ({ ...entry, placement: placementOf(entry.box, ctx) }))
  const counts = [...groupBy(named, (e) => e.placement)].sort((a, b) => b[1].length - a[1].length)
  const chosen = ctx.kit.images?.placement
  const note = chosen && counts[0][0] !== chosen ? ` (the kit's placement is "${chosen}")` : ''
  if (counts.length === 1)
    return { status: 'pass', detail: `all ${named.length} image(s) "${counts[0][0]}"${note}` }
  const others = counts.slice(1).flatMap(([, entries]) => entries)
  return fail(
    `${counts.map(([name, e]) => `${e.length} "${name}"`).join(', ')}: one placement for the whole video${note}`,
    others.map((e) => e.item),
  )
}

function fillsCanvas(ctx, items, rule, element) {
  return perBox(ctx, items, element, (box, item) => {
    const layout = ctx.layouts.get(item.id)
    const covers =
      box.x <= 0.5 &&
      box.y <= 0.5 &&
      box.x + box.width >= ctx.width - 0.5 &&
      box.y + box.height >= ctx.height - 0.5
    if (!covers)
      return `drawn at ${px(box.x)},${px(box.y)} ${px(box.width)}x${px(box.height)}, not the full ${ctx.width}x${ctx.height}`
    return layout?.rotation ? `rotated ${layout.rotation} deg` : null
  })
}

function hardCutsOnly(ctx, items, rule, element) {
  if (!items.length) return none(ctx, element)
  const ids = new Set(items.map((item) => item.id))
  const bad = ctx.transitions.filter((t) => ids.has(t.leftClipId) || ids.has(t.rightClipId))
  if (!bad.length)
    return { status: 'pass', detail: `${items.length} ${NOUN[element]}(s), hard cuts` }
  const at = (t) => items.find((item) => item.id === t.rightClipId)?.from ?? 0
  return {
    status: 'fail',
    detail: `${bad.length} transition(s) between ${NOUN[element]}s`,
    ranges: mergeRanges(
      bad.map((t) => range(Math.max(0, at(t) - t.durationInFrames), at(t) + t.durationInFrames)),
    ),
  }
}

function transparentPng(ctx, items, rule, element) {
  if (!items.length) return none(ctx, element)
  const bad = items.filter((item) => ctx.mediaById[item.mediaId]?.mimeType !== 'image/png')
  if (bad.length)
    return fail(`${bad.length} not PNG: ${bad.slice(0, 3).map(label).join(', ')}`, bad)
  return judged('look', 'all PNG; look: transparent background, no text in the image', items)
}

function notOverFace(ctx, items, rule, element) {
  if (!items.length) return none(ctx, element)
  const except = new Set(rule.check.except ?? [])
  if (element !== 'images' || !except.size)
    return judged('look', `look: never over the face (${items.length} ${NOUN[element]}(s))`, items)
  const { boxes } = measured(items, ctx)
  const placed = boxes.map((entry) => ({ ...entry, placement: placementOf(entry.box, ctx) }))
  const exempt = placed.filter((e) => except.has(e.placement))
  const checked = items.filter((item) => !exempt.some((e) => e.item.id === item.id))
  if (!checked.length)
    return {
      status: 'na',
      detail: `every image is a "${[...except].join('"/"')}" placement, which may cover the face`,
    }
  const note = exempt.length ? `; ${exempt.length} "${[...except].join('"/"')}" image(s) n/a` : ''
  return judged('look', `look: ${checked.length} image(s) not over the face${note}`, checked)
}

function matchesTranscript(ctx, items, rule, element) {
  if (!items.length) return none(ctx, element)
  const made = items.filter((item) => item.captionSource?.type === 'transcript').length
  return judged(
    'listen',
    `listen: ${made} of ${items.length} made from the transcript by addCaptions; check the words against the audio`,
    items,
  )
}

const judgment = (what) => (ctx, items, rule, element) =>
  items.length
    ? judged(rule.check.judgment ?? 'look', `${rule.check.judgment ?? 'look'}: ${what}`, items)
    : none(ctx, element)

const notHere = (why) => () => ({ status: 'na', detail: why })

const CHECKS = {
  onScreenFrom,
  inZone,
  maxLines,
  count,
  bottomAbove,
  clearOf,
  nearY,
  notOverFace,
  matchesTranscript,
  onePlacementPerVideo,
  fillsCanvas,
  hardCutsOnly,
  transparentPng,
  readsWithoutSound: judgment('the point lands with the sound off'),
  realSubjectIsPhoto: judgment('real people, products and places are real photos'),
  cleanCutout: judgment('no baked edge, shadow or tilt'),
  lockedPrompt: notHere(
    "objects are generated outside Shreditor; their prompt isn't recorded on the media",
  ),
}

function runRule(ctx, rule) {
  const element = SECTION_ELEMENT[rule.section]
  const check = CHECKS[rule.check.type]
  const base = { id: rule.id, section: rule.section, text: rule.text ?? '', type: rule.check.type }
  if (!check)
    return { ...base, status: 'na', detail: `unknown check type "${rule.check.type}"`, ranges: [] }
  const result = check(ctx, ctx.elements[element] ?? [], rule, element)
  return { ...base, ranges: [], ...result }
}

const lookup = (value) => (value instanceof Map ? value : new Map(Object.entries(value ?? {})))

/** Score a project against a kit's rules (see the header). */
export function scoreKit(project, kit, { layouts = new Map(), mediaById = {} } = {}) {
  const items = project?.timeline?.items ?? []
  const scale = kitScale(kit, project)
  const ctx = {
    kit,
    fps: project?.metadata?.fps || 30,
    width: project?.metadata?.width || kit.canvas[0],
    height: project?.metadata?.height || kit.canvas[1],
    end: Math.max(0, ...items.map((item) => item.from + item.durationInFrames)),
    scale,
    regions: kitRegions(kit, scale ?? 1),
    layouts: lookup(layouts),
    mediaById: mediaById instanceof Map ? Object.fromEntries(mediaById) : mediaById,
    transitions: project?.timeline?.transitions ?? [],
    elements: kitElements(project, { mediaById }),
  }
  const checks = kitRules(kit).map((rule) => runRule(ctx, rule))
  const summary = { pass: 0, fail: 0, warn: 0, look: 0, listen: 0, na: 0 }
  for (const check of checks) summary[check.status] += 1
  return { creator: kit.creator ?? null, kitVersion: kit.kitVersion, checks, summary }
}

/** Ids of the items whose layout the kit checks need (text and pictures the rules are about). */
export function kitLayoutItems(project, { mediaById = {} } = {}) {
  const elements = kitElements(project, { mediaById })
  return Object.values(elements).flat()
}
