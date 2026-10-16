// Cuts: several versions of one edit ("Main", "Hook B", "16:9"), each its own
// project linked to its siblings by `project.cut = { group, label, order }`
// (docs/cuts.md). Shared by the editor and the agent tools, so both group,
// order, name and re-fit cuts the same way.
import { adaptCompositionToCanvas } from '../motion-templates/template-variants.mjs'
import { aspectKey, canvasForAspect } from './aspect.mjs'
import {
  textStyleVariantFor,
  toTextStyleFamily,
} from '../typography/text-styles/text-style-family.mjs'

/** The label of a group's main cut until it is renamed. */
const MAIN_CUT_LABEL = 'Main'
const CUT_LABEL_MAX = 60
/** The aspect presets the editor offers for a new cut (besides "same"). */
export const CUT_ASPECT_PRESETS = Object.freeze(['9:16', '16:9', '1:1', '4:5'])

/** A project's group id: `cut.group`, else its own id (a lone project is its own Main). */
export const cutGroupOf = (project) => project?.cut?.group ?? project?.id

/**
 * True for the group's main cut: `cut.main` when it is set (after "Make
 * main"), else the project whose id is the group id (docs/cuts.md).
 */
export const isMainCut = (project) =>
  typeof project?.cut?.main === 'boolean' ? project.cut.main : cutGroupOf(project) === project?.id

export const cutLabelOf = (project) => project?.cut?.label ?? MAIN_CUT_LABEL

const cutOrderOf = (project) =>
  isMainCut(project) ? 0 : Number.isFinite(project?.cut?.order) ? project.cut.order : 1e9

/**
 * A cut record to write: `main` is stored only when it differs from the
 * default (the project whose id is the group id is Main), so groups that
 * never had "Make main" keep their old records.
 */
export function cutRecord({ id, group, label, order, main }) {
  return {
    group,
    label,
    ...(Number.isFinite(order) ? { order } : {}),
    ...(main !== (id === group) ? { main } : {}),
  }
}

/** A member's cut as the switcher, the Manage dialog and `shred cut` see it. */
export const cutSummaryOf = (project) => ({
  id: project.id,
  label: cutLabelOf(project),
  main: isMainCut(project),
  order: isMainCut(project) ? 0 : (project.cut?.order ?? 0),
})

/**
 * The writes that make `cutId` its group's Main (docs/cuts.md, Making another
 * cut Main): the group id stays; the cut becomes Main (order 0, the group's
 * name) and the old Main takes its place in the order and a "<group> · <label>"
 * name. Promotion first, so a failed second write never leaves a group with
 * no Main. Only these two projects change. `members` are the group's cut
 * summaries (`cutSummaryOf`).
 */
export function makeMainUpdates(members, cutId, group, groupName) {
  const next = members.find((member) => member.id === cutId)
  if (!next) throw new Error(`${cutId} is not a cut of group ${group}`)
  if (next.main) return []
  const writes = [
    {
      id: next.id,
      updates: {
        cut: cutRecord({ id: next.id, group, label: next.label, order: 0, main: true }),
        name: groupName,
      },
    },
  ]
  for (const old of members.filter((member) => member.main))
    writes.push({
      id: old.id,
      updates: {
        cut: cutRecord({ id: old.id, group, label: old.label, order: next.order || 1, main: false }),
        name: cutProjectName(groupName, old.label),
      },
    })
  return writes
}

/** Why a label can't be used, or null. */
export function cutLabelError(label) {
  const text = typeof label === 'string' ? label.trim() : ''
  if (!text) return 'A cut needs a label'
  if (text.length > CUT_LABEL_MAX) return `A cut label is at most ${CUT_LABEL_MAX} characters`
  return null
}

/**
 * The projects in a group, in cut order: Main first, then by `cut.order`,
 * then by creation. `projects` need `id`, `cut` and optionally `createdAt`.
 */
export function cutsInGroup(projects, groupId) {
  return projects
    .filter((project) => cutGroupOf(project) === groupId)
    .sort(
      (a, b) =>
        cutOrderOf(a) - cutOrderOf(b) ||
        (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    )
}

/** The order a new cut takes: after every cut in the group. */
export function nextCutOrder(cuts) {
  return Math.max(0, ...cuts.map((cut) => (isMainCut(cut) ? 0 : (cut.cut?.order ?? 0)))) + 1
}

/** A cut's project name: "<group name> · <label>" (fits the 100-character project name). */
export function cutProjectName(groupName, label) {
  const suffix = ` · ${label.trim()}`
  return `${String(groupName).slice(0, Math.max(1, 100 - suffix.length))}${suffix}`
}

/**
 * The file name of one cut's export among all cuts: "<project> - <cut label>"
 * (slashes and dots, which a file name would split on, become dashes).
 */
export const cutExportFileName = (groupName, label) =>
  `${groupName} - ${label}`.replace(/[/\\.]+/g, '-')

/** The group's name from its main project (else a cut's name without its " · label"). */
export function cutGroupName(main, source) {
  if (main?.name) return main.name
  const name = String(source?.name ?? 'Untitled')
  const label = source?.cut?.label
  return label && name.endsWith(` · ${label}`) ? name.slice(0, -(label.length + 3)) : name
}

/** The canvas for a preset aspect that keeps the source's short side. */
export function cutCanvasForAspect(aspect, source) {
  return canvasForAspect(aspect, Math.min(source.width, source.height))
}

/** Parse "1920x1080". */
export function parseCanvasSize(text) {
  const match = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(String(text ?? ''))
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  if (!match || width < 320 || height < 240 || width > 7680 || height > 4320)
    throw new Error(`--size "${text}" must be WxH, from 320x240 to 7680x4320 (e.g. 1920x1080)`)
  return { width, height }
}

const VISUAL_MEDIA = new Set(['video', 'image'])
const COVER_TOLERANCE = 2

/** The drawn size of an item with no transform: its media contained in the canvas. */
function containedSize(media, canvas) {
  if (!(media?.width > 0) || !(media?.height > 0)) return null
  const scale = Math.min(canvas.width / media.width, canvas.height / media.height)
  return { width: media.width * scale, height: media.height * scale }
}

/**
 * Whether a video or image covered the whole canvas, and its drawn box: by an
 * explicit transform that reaches every edge (unrotated), or with none when
 * the media has the canvas's aspect (contain = cover).
 */
function fullBleedBox(item, canvas, media) {
  const t = item.transform
  const box =
    t && typeof t.width === 'number' && typeof t.height === 'number'
      ? { x: t.x ?? 0, y: t.y ?? 0, width: t.width, height: t.height }
      : t && (t.width !== undefined || t.height !== undefined)
        ? null
        : (() => {
            const size = containedSize(media, canvas)
            return size ? { x: t?.x ?? 0, y: t?.y ?? 0, ...size } : null
          })()
  if (!box || Math.abs(t?.rotation ?? 0) > 0.01) return null
  const covers = (offset, size, frame) =>
    offset - size / 2 <= -frame / 2 + COVER_TOLERANCE &&
    offset + size / 2 >= frame / 2 - COVER_TOLERANCE
  return covers(box.x, box.width, canvas.width) && covers(box.y, box.height, canvas.height)
    ? box
    : null
}

/** A box of aspect `ratio` that covers `canvas`. */
function coverSize(ratio, canvas) {
  return ratio >= canvas.width / canvas.height
    ? { width: canvas.height * ratio, height: canvas.height }
    : { width: canvas.width, height: canvas.width / ratio }
}

const round2 = (value) => Math.round(value * 100) / 100
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value))

/**
 * The transform that makes a full-bleed box (on `from`) cover `to`: the same
 * zoom past cover (a punch-in stays a punch-in) and the same offset scaled
 * with the picture, clamped so no edge shows.
 */
export function coverTransform(box, from, to) {
  const ratio = box.width / box.height
  const zoom = box.width / coverSize(ratio, from).width
  const target = coverSize(ratio, to)
  const width = target.width * Math.max(1, zoom)
  const height = width / ratio
  const scale = width / box.width
  return {
    x: round2(clamp(box.x * scale, (width - to.width) / 2)),
    y: round2(clamp(box.y * scale, (height - to.height) / 2)),
    width: round2(width),
    height: round2(height),
  }
}

const itemName = (item) =>
  item.type === 'text'
    ? JSON.stringify(String(item.text ?? '').slice(0, 30))
    : (item.label ?? item.type)

/**
 * The timeline re-fitted for another canvas (docs/cuts.md, Creating a cut):
 * full-bleed video and images cover the new canvas; everything else keeps its
 * nearest frame edge or the centre and scales by the short side (as
 * `shred motion clone` does). `mediaSize(mediaId)` gives a media's
 * `{ width, height }` (for items with no transform). Returns the timeline,
 * the ids made to cover and what needs a look, by reason.
 */
export function refitTimeline(timeline, from, to, { mediaSize = () => null } = {}) {
  const adapted = adaptCompositionToCanvas(
    {
      width: from.width,
      height: from.height,
      items: timeline.items ?? [],
      keyframes: timeline.keyframes ?? [],
    },
    to,
  )
  const keyframed = new Set(
    (timeline.keyframes ?? [])
      .filter((entry) =>
        [...(entry.properties ?? []), ...(entry.vectorProperties ?? [])].some(
          (lane) => lane.keyframes?.length,
        ),
      )
      .map((entry) => entry.itemId),
  )
  const compositions = new Map((timeline.compositions ?? []).map((c) => [c.id, c]))
  const covered = []
  const review = []
  const flag = (item, reason) => review.push({ id: item.id, name: itemName(item), reason })
  const items = adapted.items.map((next, index) => {
    const item = timeline.items[index]
    if (VISUAL_MEDIA.has(item.type)) {
      const box = fullBleedBox(item, from, item.mediaId ? mediaSize(item.mediaId) : null)
      if (box) {
        covered.push(item.id)
        const cover = coverTransform(box, from, to)
        if (keyframed.has(item.id)) flag(item, 'keyframed')
        else if (Math.min(to.width / cover.width, to.height / cover.height) < 0.75)
          flag(item, 'framing')
        return { ...next, transform: { ...item.transform, ...cover } }
      }
      if (item.transform) flag(item, keyframed.has(item.id) ? 'keyframed' : 'reanchored')
      return next
    }
    if (item.type === 'composition') {
      const comp = compositions.get(item.compositionId)
      flag(item, comp?.templateId ? 'template' : 'compound')
      return next
    }
    if (item.type === 'text' && item.textStyleId) return next
    if (item.transform || keyframed.has(item.id))
      flag(item, keyframed.has(item.id) ? 'keyframed' : 'reanchored')
    return next
  })
  return {
    timeline: { ...timeline, items, keyframes: adapted.keyframes },
    covered,
    review,
  }
}

/**
 * Text styles the timeline's text uses, and whether each has a look for
 * `toAspect`: `[{ styleId, name, itemIds, ready }]`. A style the project has
 * no copy of is not ready.
 */
export function textStylesForAspect(timeline, toAspect, fromAspect) {
  const styles = new Map(
    (timeline.textStyles ?? []).map((style) => {
      const family = toTextStyleFamily(style, fromAspect)
      return [family.id, family]
    }),
  )
  const byStyle = new Map()
  for (const item of timeline.items ?? []) {
    if (item.type !== 'text' || !item.textStyleId) continue
    byStyle.set(item.textStyleId, [...(byStyle.get(item.textStyleId) ?? []), item.id])
  }
  return [...byStyle].map(([styleId, itemIds]) => {
    const style = styles.get(styleId)
    return {
      styleId,
      name: style?.name ?? styleId,
      itemIds,
      ready: Boolean(style && textStyleVariantFor(style, toAspect)),
    }
  })
}

/** An item's style overrides that still mean something on another canvas (not position). */
export const portableTextOverrides = (item) =>
  (item.textStyleOverrides ?? []).filter((key) => !key.startsWith('transform.'))

/**
 * The first pass record of a new cut (`agent/passes/001.json`): what
 * `shred changes` diffs the user's edits against, and why the next draft is
 * not a first pass.
 */
export function cutCreatedPassRecord({
  label,
  fromLabel,
  fromId,
  revision,
  timeline,
  by = 'agent',
  scorecard = null,
  now = new Date(),
}) {
  return {
    id: '001',
    label: `New cut "${label}" from ${fromLabel}`,
    summary: `Started as a copy of ${fromLabel} (${fromId}).`,
    by,
    status: 'review',
    kind: 'cut',
    createdAt: now.toISOString(),
    from: fromId,
    baseRevision: null,
    resultRevision: revision,
    changes: [],
    ...(scorecard ? { scorecard } : {}),
    timeline,
    baseTimeline: timeline,
  }
}

/** The aspect key of a project's canvas. */
export const projectAspect = (project) =>
  aspectKey(project.metadata?.width || 1080, project.metadata?.height || 1920)
