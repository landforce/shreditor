// An edit template from a finished Shreditor project ("recut last week's 10
// Shot with this new footage"): every picture and audio clip becomes a slot
// that still points at the original media as a placeholder, every text item a
// text slot with its style, plus the tracks and text styles a new project
// needs to rebuild the same structure (`shred new --from-template`). Pure.
import { resolveItemRoles } from '../scorecard.mjs'
import { measureTimeline } from './measure.mjs'
import { slotCategories } from './roles.mjs'
import {
  TEMPLATE_KIND,
  TEMPLATE_VERSION,
  anchorFor,
  captionsFrom,
  sortSlots,
  templateSlug,
  timed,
} from './template.mjs'

const SLOT_ROLE = {
  speaker: 'speaker',
  images: 'images',
  plates: 'images',
  broll: 'broll',
  shots: 'shots',
}
const AUDIO_ROLES = new Set(['music', 'voice', 'sfx', 'speaker'])
/** Text look fields a rebuilt text item takes when it has no style. */
const LOOK_FIELDS = [
  'color',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'verticalAlign',
  'stroke',
  'textShadow',
  'letterSpacing',
  'lineHeight',
  'backgroundColor',
  'backgroundMode',
  'backgroundRadius',
  'textPadding',
  'textPaddingX',
  'textPaddingY',
]

const gcd = (a, b) => (b ? gcd(b, a % b) : a)
const aspectOf = (w, h) => (w && h ? `${w / gcd(w, h)}:${h / gcd(w, h)}` : null)
const pad = (n) => String(n).padStart(2, '0')
const pick = (item, keys) =>
  Object.fromEntries(keys.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]))

function companionOf(item, items) {
  if (item.type !== 'video' || !item.linkedGroupId) return null
  return (
    items.find(
      (other) =>
        other.id !== item.id &&
        other.type === 'audio' &&
        other.linkedGroupId === item.linkedGroupId,
    ) ?? null
  )
}

/** What a placeholder clip is, so `new --from-template` rebuilds it and `template fill` swaps it. */
function clipRecord(item, { fps, media, companion }) {
  const sourceFps = item.sourceFps || fps
  return {
    itemId: item.id,
    trackId: item.trackId,
    type: item.type,
    mediaId: item.mediaId,
    fileName: media?.fileName ?? item.label ?? item.mediaId,
    from: item.from,
    durationInFrames: item.durationInFrames,
    ...(item.sourceStart !== undefined ? { sourceStartSec: item.sourceStart / sourceFps } : {}),
    ...pick(item, ['speed', 'volume', 'transform', 'formatRole', 'label', 'embeddedAudioMuted']),
    ...(item.type === 'video'
      ? {
          audio: companion ? 'linked' : 'none',
          ...(companion ? { audioTrackId: companion.trackId } : {}),
        }
      : {}),
  }
}

const boundaryOf = (item, previous) => {
  if (!previous) return 'start'
  const touching =
    previous.project.trackId === item.trackId &&
    previous.project.from + previous.project.durationInFrames === item.from
  return touching && previous.project.mediaId === item.mediaId ? 'jump_cut' : 'hard_cut'
}

const shotTypeOf = (role, item) =>
  role === 'speaker' ? 'talking_head' : item.type === 'image' ? 'photo_or_still' : 'b_roll'

function shotSlots(pictures, scope) {
  const slots = []
  for (const [i, item] of pictures.entries()) {
    const role = SLOT_ROLE[scope.roleOf(item)]
    const media = scope.mediaById[item.mediaId]
    slots.push({
      id: `s${pad(i + 1)}`,
      kind: 'shot',
      role,
      ...timed(item.from / scope.fps, (item.from + item.durationInFrames) / scope.fps),
      boundary: boundaryOf(
        item,
        slots.findLast((s) => s.project.trackId === item.trackId),
      ),
      framing: null,
      camera: null,
      shotType: shotTypeOf(role, item),
      speech: role === 'speaker' ? 'to_camera' : null,
      description: item.label || media?.fileName || item.mediaId,
      category: media?.category ?? slotCategories(role)[0],
      project: clipRecord(item, { ...scope, media, companion: companionOf(item, scope.items) }),
    })
  }
  return slots
}

function audioSlots(audios, scope) {
  return audios.map((item, i) => ({
    id: `a${pad(i + 1)}`,
    kind: 'audio',
    role: scope.roleOf(item),
    ...timed(item.from / scope.fps, (item.from + item.durationInFrames) / scope.fps),
    description: item.label || scope.mediaById[item.mediaId]?.fileName || item.mediaId,
    category: scope.mediaById[item.mediaId]?.category ?? null,
    project: clipRecord(item, { ...scope, media: scope.mediaById[item.mediaId] }),
  }))
}

function textSlots(texts, scope, shots) {
  return texts.map((item, i) => {
    const role = scope.roleOf(item) === 'title' ? 'title' : 'labels'
    const start = item.from / scope.fps
    return {
      id: `t${pad(i + 1)}`,
      kind: 'text',
      role,
      textKind: role === 'title' ? 'title_hook' : 'label',
      ...timed(start, (item.from + item.durationInFrames) / scope.fps),
      position: null,
      style: item.textStyleId ?? null,
      pattern: String(item.text ?? ''),
      reference: String(item.text ?? ''),
      anchor: anchorFor(shots, start),
      project: {
        itemId: item.id,
        trackId: item.trackId,
        from: item.from,
        durationInFrames: item.durationInFrames,
        ...(item.textStyleId ? { styleId: item.textStyleId } : { look: pick(item, LOOK_FIELDS) }),
        ...pick(item, ['transform', 'textMotion', 'formatRole', 'label']),
      },
    }
  })
}

function captionsOf(captions, scope, durationSec) {
  const spans = captions.map((item) => ({
    start: item.from / scope.fps,
    end: (item.from + item.durationInFrames) / scope.fps,
  }))
  const style = captions.find((item) => item.textStyleId)?.textStyleId
  return captionsFrom(spans, durationSec, style ? { style } : {})
}

/** Classify the top-level items: pictures, free audio (not a video's own), texts and captions. */
function classify(timeline, roleOf) {
  const items = timeline.items
  const linkedAudio = new Set(
    items
      .filter((i) => i.type === 'video')
      .map((v) => companionOf(v, items)?.id)
      .filter(Boolean),
  )
  const order = new Map(timeline.tracks.map((t) => [t.id, t.order ?? 0]))
  const byTime = (a, b) =>
    a.from - b.from || (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0)
  const isCaption = (item) => roleOf(item) === 'captions'
  return {
    pictures: items
      .filter((i) => ['video', 'image'].includes(i.type) && SLOT_ROLE[roleOf(i)])
      .sort(byTime),
    audios: items
      .filter((i) => i.type === 'audio' && !linkedAudio.has(i.id) && AUDIO_ROLES.has(roleOf(i)))
      .sort(byTime),
    texts: items.filter((i) => i.type === 'text' && !isCaption(i)).sort(byTime),
    captions: items.filter((i) => ['text', 'subtitle'].includes(i.type) && isCaption(i)),
  }
}

function styleIdsOf(slots, captions) {
  return new Set([...slots.map((s) => s.project?.styleId), captions.style].filter(Boolean))
}

/**
 * A template from a project (with its format): slots for every clip and text,
 * the tracks and the text styles it uses, the pacing measured as a VDB
 * timeline would be (formats/edit-template/measure.mjs).
 */
export function templateFromProject(project, options = {}) {
  const { mediaById = {}, name, outline = null, createdAt = new Date().toISOString() } = options
  if (!project?.format?.id) throw new Error('the project has no format (shred format set)')
  const timeline = project.timeline ?? { tracks: [], items: [] }
  const roles = resolveItemRoles(project, { mediaById })
  const roleOf = (item) => roles.get(item.id)?.role ?? null
  const measured = measureTimeline(project, { mediaById })
  const scope = { fps: measured.fps, mediaById, roleOf, items: timeline.items }
  const groups = classify(timeline, roleOf)
  const shots = shotSlots(groups.pictures, scope)
  if (!shots.length) throw new Error('the project has no picture clips to make slots from')
  const slots = sortSlots([
    ...shots,
    ...audioSlots(groups.audios, scope),
    ...textSlots(groups.texts, scope, shots),
  ])
  const captions = captionsOf(groups.captions, scope, measured.durationSec)
  const styles = styleIdsOf(slots, captions)
  const { width, height, fps } = project.metadata ?? {}
  return {
    kind: TEMPLATE_KIND,
    version: TEMPLATE_VERSION,
    name: templateSlug(name ?? project.name),
    title: project.name,
    createdAt,
    source: { type: 'project', projectId: project.id, projectName: project.name },
    format: {
      id: project.format.id,
      ...(project.format.variant ? { variant: project.format.variant } : {}),
      reason: "the project's own format",
    },
    canvas: { width, height, fps, aspect: aspectOf(width, height) },
    durationSec: measured.pacing.durationSec,
    pacing: { ...measured.pacing, wordsPerMin: null },
    slots,
    captions,
    outline,
    project: {
      tracks: [...timeline.tracks]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((t) => pick(t, ['id', 'name', 'kind', 'formatRole', 'order'])),
      textStyles: (timeline.textStyles ?? []).filter((style) => styles.has(style.id)),
    },
  }
}
