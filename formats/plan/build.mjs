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

const markerId = (beat) => `${PLAN_MARKER_PREFIX}${beat.id.replace(/[^A-Za-z0-9_-]+/g, '-')}`
const markerLabel = (beat) => {
  const label = `${beat.role ?? 'beat'}: ${beat.takeaway || beat.id}`
  return label.length > MARKER_LABEL_MAX ? `${label.slice(0, MARKER_LABEL_MAX - 1)}…` : label
}
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
function trackFinder(project, format, ops) {
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
function styleFinder(project) {
  const styles = project.timeline?.textStyles ?? []
  const has = (id) => styles.some((style) => style.id === id || style.name === id)
  const kit = { title: 'kit:title', labels: 'kit:overlay' }
  const styleRole = { title: 'title', labels: 'label' }
  return (text) =>
    text.style ??
    (has(kit[text.role]) ? kit[text.role] : styles.find((s) => s.role === styleRole[text.role])?.id)
}

function clipOps(beat, index, track, { fps, dropSyncSound }) {
  const { media } = beat
  const callerId = `clip${index}`
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

function textOps(beat, index, findTrack, styleFor) {
  const { text } = beat
  const track = findTrack(text.role, 'video')
  const style = styleFor(text)
  const op = {
    callerId: `text${index}`,
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

/** Ops that clear what a rebuild replaces: the plan's old markers, and with `replace` every item. */
function clearingOps(project, { replace, markersOnly }) {
  const timeline = project.timeline ?? {}
  const items = timeline.items ?? []
  if (items.length && !replace && !markersOnly)
    throw new Error(
      `the draft already has ${items.length} item(s): build makes the first assembly on an empty draft (--replace clears it first)`,
    )
  const ops = []
  if (replace && !markersOnly && items.length)
    ops.push({ callerId: 'clear-items', op: 'removeItems', ids: items.map((item) => item.id) })
  const old = (timeline.markers ?? []).filter((m) => m.id.startsWith(PLAN_MARKER_PREFIX))
  if (old.length)
    ops.push({ callerId: 'clear-markers', op: 'removeMarkers', ids: old.map((m) => m.id) })
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
        const clip = clipOps(beat, index, track, { fps: plan.fps, dropSyncSound })
        ops.push(...clip.ops)
        Object.assign(entry, {
          track: track.name,
          trackAdded: Boolean(track.added),
          syncSound: clip.syncSound,
        })
        if (beat.text) {
          const text = textOps(beat, index, findTrack, styleFor)
          ops.push(...text.ops)
          entry.text = text.placed
        }
      }
      ops.push({
        callerId: `mark${index}`,
        op: 'addMarker',
        id: markerId(beat),
        frame: beat.start,
        label: markerLabel(beat),
      })
      return entry
    })
  return { ops, placed }
}
