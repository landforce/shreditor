// The first assembly from a validated plan, as ONE op batch (`shred build`):
// each beat's clip at its frames with its source in-point, on the format track
// for its role (made when the project lacks it), the format's sync sound rule
// applied to camera audio, planned text in the project's styles, and one marker
// per beat at its start, labelled `<role>: <takeaway>`. Markers-only builds just
// the markers, so the user can see the story's shape before any clip lands.
import { trackRole } from '../scorecard.mjs'

/** Plan beat markers have ids `plan-<beat id>`, so a rebuild can find and replace them. */
const PLAN_MARKER_PREFIX = 'plan-'
const MARKER_LABEL_MAX = 90

/** The marker id for a beat or line id: `plan-<id>`. */
export const markerId = (id) => `${PLAN_MARKER_PREFIX}${id.replace(/[^A-Za-z0-9_-]+/g, '-')}`
/** A marker label, cut to fit. */
export const markerText = (label) =>
  label.length > MARKER_LABEL_MAX ? `${label.slice(0, MARKER_LABEL_MAX - 1)}…` : label
const markerLabel = (beat) => markerText(`${beat.role ?? 'beat'}: ${beat.takeaway || beat.id}`)
const capital = (role) => role.charAt(0).toUpperCase() + role.slice(1)

/** Where a missing format track goes: next to the format tracks around it, in the format's order. */
function orderFor(spec, format, tracks) {
  const at = format.tracks.findIndex((t) => t.role === spec.role)
  const existing = (role) => tracks.find((t) => trackRole(t, format) === role)
  const below = format.tracks
    .slice(at + 1)
    .map((t) => existing(t.role))
    .find(Boolean)
  if (below) return below.order - 0.5
  const above = format.tracks
    .slice(0, Math.max(0, at))
    .map((t) => existing(t.role))
    .findLast(Boolean)
  return above ? above.order + 0.5 : undefined
}

/** Finds the project's track for a role, or plans an addTrack for it (once per role). */
export function trackFinder(project, format, ops) {
  const tracks = [...(project.timeline?.tracks ?? [])].sort((a, b) => a.order - b.order)
  const made = new Map()
  return (role, kind) => {
    const found = tracks.find((t) => !t.isGroup && trackRole(t, format) === role)
    if (found) return { id: found.id, name: found.name }
    if (!made.has(role)) {
      const spec = format.tracks.find((t) => t.role === role) ?? { name: capital(role), kind, role }
      const callerId = `track-${role}`
      const order = orderFor(spec, format, tracks)
      ops.push({
        callerId,
        op: 'addTrack',
        kind: spec.kind,
        name: spec.name,
        formatRole: role,
        ...(order === undefined ? {} : { order }),
      })
      made.set(role, { id: { $ref: `${callerId}#/detail/trackId` }, name: spec.name, added: true })
    }
    return made.get(role)
  }
}

/** The text style for planned text: the beat's own, the kit's, else a project style of that role. */
export function styleFinder(project) {
  const styles = project.timeline?.textStyles ?? []
  const has = (id) => styles.some((style) => style.id === id || style.name === id)
  const kit = { title: 'kit:title', labels: 'kit:overlay' }
  const styleRole = { title: 'title', labels: 'label' }
  return (text) =>
    text.style ??
    (has(kit[text.role]) ? kit[text.role] : styles.find((s) => s.role === styleRole[text.role])?.id)
}

/**
 * addClip for a beat's media at its frames, its source window, and the sync
 * sound rule: `{ ops, syncSound: 'kept' | 'removed' | null }`. `callerId` names
 * the addClip (the other ops derive theirs from it).
 */
export function clipOps(beat, callerId, track, { fps, dropSyncSound }) {
  const { media } = beat
  const length = beat.end - beat.start
  const ops = [
    {
      callerId,
      op: 'addClip',
      mediaId: media.mediaId,
      trackId: track.id,
      from: beat.start,
      durationInFrames: length,
    },
  ]
  if (media.kind === 'image') return { ops, syncSound: null }
  const sourceFps = media.sourceFps || fps
  const sourceStart = Math.round(beat.source.inSec * sourceFps)
  const sourceEnd = sourceStart + Math.round((length / fps) * sourceFps)
  ops.push({
    callerId: `${callerId}-in`,
    op: 'updateItem',
    id: { $ref: `${callerId}#/detail/created/0/id` },
    updates: { sourceStart, sourceEnd },
  })
  if (media.kind !== 'video' || !media.audioCodec) return { ops, syncSound: null }
  if (!dropSyncSound) return { ops, syncSound: 'kept' }
  ops.push({
    callerId: `${callerId}-mute`,
    op: 'removeItems',
    ids: [{ $ref: `${callerId}#/detail/created/1/id` }],
    linked: false,
  })
  return { ops, syncSound: 'removed' }
}

/** addText for planned text (`{ text, role, start, end, style? }`) on its role's track, in its style. */
export function textOps(text, callerId, findTrack, styleFor) {
  const track = findTrack(text.role, 'video')
  const style = styleFor(text)
  const op = {
    callerId,
    op: 'addText',
    text: text.text,
    from: text.start,
    durationInFrames: text.end - text.start,
    trackId: track.id,
    ...(style
      ? { styleId: style }
      : { fontSize: text.role === 'title' ? 96 : 64, fontWeight: 'bold' }),
  }
  return {
    ops: [op],
    placed: {
      role: text.role,
      text: text.text,
      start: text.start,
      end: text.end,
      track: track.name,
      style: style ?? null,
    },
  }
}

/** A first assembly goes on an empty draft; markers-only and --replace may meet items. */
function assertEmpty(items, { replace, markersOnly }) {
  if (!items.length || replace || markersOnly) return
  throw new Error(
    `the draft already has ${items.length} item(s): build makes the first assembly on an empty draft (--replace clears it first)`,
  )
}

/** Ops that clear what a rebuild replaces: the plan's old markers, and with `replace` every item. */
export function clearingOps(project, options) {
  const items = project.timeline?.items ?? []
  assertEmpty(items, options)
  const ops = []
  if (options.replace && !options.markersOnly && items.length)
    ops.push({ callerId: 'clear-items', op: 'removeItems', ids: items.map((item) => item.id) })
  const markers = project.timeline?.markers ?? []
  const old = markers.filter((m) => m.id.startsWith(PLAN_MARKER_PREFIX)).map((m) => m.id)
  if (old.length) ops.push({ callerId: 'clear-markers', op: 'removeMarkers', ids: old })
  return ops
}

/**
 * The op batch that builds a validated plan's beats (with `media.mediaId` and
 * `trackRole` resolved, ./validate.mjs) on `project`. Returns `{ ops, placed }`,
 * `placed` describing each beat as built. Throws when the project has items and
 * neither `replace` nor `markersOnly` is set.
 */
export function buildPlanOps(
  plan,
  beats,
  { project, format, replace = false, markersOnly = false },
) {
  const ops = clearingOps(project, { replace, markersOnly })
  const findTrack = trackFinder(project, format, ops)
  const styleFor = styleFinder(project)
  const dropSyncSound = format.rules.syncSound === 'none'
  const placed = [...beats]
    .sort((a, b) => a.start - b.start)
    .map((beat, index) => {
      const entry = { beat }
      if (!markersOnly) {
        const track = findTrack(beat.trackRole, beat.media.kind === 'audio' ? 'audio' : 'video')
        const clip = clipOps(beat, `clip${index}`, track, { fps: plan.fps, dropSyncSound })
        ops.push(...clip.ops)
        Object.assign(entry, {
          track: track.name,
          trackAdded: Boolean(track.added),
          syncSound: clip.syncSound,
        })
        if (beat.text) {
          const text = textOps(beat.text, `text${index}`, findTrack, styleFor)
          ops.push(...text.ops)
          entry.text = text.placed
        }
      }
      ops.push({
        callerId: `mark${index}`,
        op: 'addMarker',
        id: markerId(beat.id),
        frame: beat.start,
        label: markerLabel(beat),
      })
      return entry
    })
  return { ops, placed }
}
