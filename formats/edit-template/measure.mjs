// A Shreditor timeline measured the way a VideoDatabase edit timeline is:
// the visual shots the viewer sees (the top picture between every picture
// edge, a cut hidden under an image is no cut), their roles, the texts with
// their roles, and the pacing numbers a template keeps. Shared by
// templates made from a project (./project.mjs) and the template section of
// `shred check` (./score.mjs). Pure.
import { resolveFormat } from '../registry.mjs'
import { resolveItemRoles } from '../scorecard.mjs'
import { median, shotMixOf } from './template.mjs'

const PICTURE_TYPES = new Set(['video', 'image', 'composition', 'lottie'])
const TEXT_TYPES = new Set(['text', 'subtitle'])
/** Format picture roles as template slot roles: plates are images; broll and shots stay. */
const SLOT_ROLE = {
  speaker: 'speaker',
  images: 'images',
  plates: 'images',
  broll: 'broll',
  shots: 'shots',
}

const round3 = (value) => Math.round(value * 1000) / 1000
const round2 = (value) => Math.round(value * 100) / 100

function topItem(covering, tracks) {
  const order = (item) => tracks.get(item.trackId)?.order ?? 0
  return [...covering].sort((a, b) => order(a) - order(b) || b.from - a.from)[0]
}

/** Every frame where a picture starts or ends, from 0 to `end`, in order. */
function pictureEdges(pictures, end) {
  const edges = new Set([0, end])
  for (const item of pictures) {
    edges.add(item.from)
    edges.add(item.from + item.durationInFrames)
  }
  return [...edges].filter((f) => f >= 0 && f <= end).sort((a, b) => a - b)
}

/** The picture the viewer sees over [start, stop), or null. */
function seenOver(pictures, tracks, start, stop) {
  const covering = pictures.filter(
    (it) => it.from <= start && it.from + it.durationInFrames >= stop,
  )
  return covering.length ? topItem(covering, tracks) : null
}

/** Visual shots: `[{ startFrame, endFrame, role, itemId }]`, adjacent parts of one top item merged. */
function visualShots(pictures, tracks, end) {
  const points = pictureEdges(pictures, end)
  const shots = []
  for (const [i, start] of points.slice(0, -1).entries()) {
    const stop = points[i + 1]
    const top = seenOver(pictures, tracks, start, stop)
    const itemId = top?.id ?? null
    const last = shots.at(-1)
    if (last && last.itemId === itemId) last.endFrame = stop
    else shots.push({ startFrame: start, endFrame: stop, role: top?.slotRole ?? 'gap', itemId })
  }
  return shots
}

const textRoleOf = (role) => (role === 'captions' || role === 'title' ? role : 'labels')

/**
 * The project's timeline measured: `{ fps, endFrame, durationSec, shots,
 * texts, captions, pacing }`. `shots` are the visual shots (gaps left out of
 * the pacing), `texts` every text item with its role (title, labels, captions).
 */
export function measureTimeline(project, { mediaById = {} } = {}) {
  const format = resolveFormat(project.format.id, project.format.variant)
  const timeline = project.timeline ?? { tracks: [], items: [] }
  const fps = project.metadata?.fps || format.canvas.fps
  const tracks = new Map(timeline.tracks.map((track) => [track.id, track]))
  const roles = resolveItemRoles(project, { mediaById, format })
  const visible = timeline.items.filter((item) => tracks.get(item.trackId)?.visible !== false)
  const roleOf = (item) => roles.get(item.id)?.role ?? null
  const pictures = visible
    .filter((item) => PICTURE_TYPES.has(item.type) && SLOT_ROLE[roleOf(item)])
    .map((item) => ({ ...item, slotRole: SLOT_ROLE[roleOf(item)] }))
  const end = Math.max(0, ...visible.map((item) => item.from + item.durationInFrames))
  const shots = visualShots(pictures, tracks, end).filter((shot) => shot.role !== 'gap')
  const texts = visible
    .filter(
      (item) => TEXT_TYPES.has(item.type) || ['title', 'labels', 'captions'].includes(roleOf(item)),
    )
    .filter((item) => !PICTURE_TYPES.has(item.type) || roleOf(item) === 'title')
    .map((item) => ({
      itemId: item.id,
      role: textRoleOf(roleOf(item)),
      startFrame: item.from,
      endFrame: item.from + item.durationInFrames,
      text: String(item.text ?? item.label ?? '').trim(),
    }))
    .sort((a, b) => a.startFrame - b.startFrame)
  return {
    fps,
    endFrame: end,
    durationSec: end / fps,
    shots,
    texts,
    pacing: pacingOf(shots, texts, end, fps),
  }
}

function pacingOf(shots, texts, end, fps) {
  const lengths = shots.map((shot) => (shot.endFrame - shot.startFrame) / fps)
  const minutes = end / fps / 60 || 1
  const title = texts.find((text) => text.role === 'title')
  return {
    durationSec: round3(end / fps),
    shotCount: shots.length,
    cutsPerMin: round2(Math.max(0, shots.length - 1) / minutes),
    medianShotSec: lengths.length ? round3(median(lengths)) : null,
    firstCutSec: shots.length > 1 ? round3(shots[0].endFrame / fps) : null,
    longestShotSec: lengths.length ? round3(Math.max(...lengths)) : null,
    textCount: texts.filter((text) => text.role !== 'captions').length,
    labelCount: texts.filter((text) => text.role === 'labels').length,
    title: title
      ? {
          atSec: round3(title.startFrame / fps),
          holdSec: round3((title.endFrame - title.startFrame) / fps),
        }
      : null,
    shotMix: shotMixOf(
      shots.map((shot) => ({ role: shot.role, sec: (shot.endFrame - shot.startFrame) / fps })),
    ),
  }
}
