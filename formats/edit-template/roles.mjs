// What a reference video's shots and texts are, in Shreditor's terms: a slot's
// role (speaker, images, screen, broll, shots), the media category that fills
// it, the format track it goes on, the text style a text slot uses, and the
// format a template suggests. Pure.
import { getFormat, resolveFormat } from '../registry.mjs'
import { shotMix } from './template.mjs'

// VideoDatabase shot_type values (and ones a Video DNA export spells out) to a slot role.
const SHOT_TYPE_ROLES = {
  talking_head: 'speaker',
  speaker: 'speaker',
  interview: 'speaker',
  photo_or_still: 'images',
  photo: 'images',
  still: 'images',
  graphic: 'images',
  graphics: 'images',
  text_card: 'images',
  screen_recording: 'screen',
  screenshot: 'screen',
  screen: 'screen',
  b_roll: 'broll',
  broll: 'broll',
  footage: 'broll',
  product: 'broll',
  product_shot: 'broll',
  cutaway: 'broll',
}

const squash = (text) =>
  String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

// A Video DNA Markdown export has no shot_type column: the description says it
// ("Photo: ...", "Screen recording: ..."), else framing and speech do.
const DESCRIPTION_TYPES = [
  [/^(photo|still|image|picture)\b/i, 'photo_or_still'],
  [/^(screen ?recording|screenshot|screen ?capture)\b/i, 'screen_recording'],
  [/^(graphic|text card|title card)\b/i, 'photo_or_still'],
  [/^(b-?roll|footage|cutaway)\b/i, 'b_roll'],
  [/^(speaker|host|creator|presenter|talking)\b/i, 'talking_head'],
]

/** A shot's VDB shot_type, inferred when the source doesn't give one. */
export function inferShotType(shot) {
  if (shot.shot_type) return squash(shot.shot_type)
  const description = String(shot.description ?? '').trim()
  const hit = DESCRIPTION_TYPES.find(([pattern]) => pattern.test(description))
  if (hit) return hit[1]
  if (squash(shot.framing) === 'screen') return 'screen_recording'
  if (squash(shot.speech) === 'to_camera') return 'talking_head'
  return 'b_roll'
}

/**
 * A shot's slot role from its type and speech: a talking head is the speaker,
 * a photo or still images, a screen recording screen, anything else b-roll
 * (a video with nobody talking reads as shots, the 10 Shot's word for it).
 */
export function shotRole(shot) {
  const role = SHOT_TYPE_ROLES[inferShotType(shot)] ?? 'broll'
  return role === 'broll' && squash(shot.speech) === 'none' ? 'shots' : role
}

// The media category that fills each slot role (formats/registry.mjs categoryRoles).
const ROLE_CATEGORIES = {
  speaker: ['speaker'],
  images: ['graphics', 'overlay', 'b-roll'],
  screen: ['graphics', 'b-roll'],
  broll: ['b-roll', 'graphics'],
  shots: ['b-roll'],
}

/** Media categories that fill a slot of this role, best first. */
export const slotCategories = (role) => ROLE_CATEGORIES[role] ?? ['b-roll']

/**
 * The format track role a slot goes on: its first category's role in the
 * format, when the format has that track (a photo in a 10 Shot is a shot).
 */
export function slotTrackRole(role, format) {
  if (role === 'speaker') return 'speaker'
  const wanted = format.categoryRoles[slotCategories(role)[0]]
  const hasTrack = format.tracks.some((track) => track.role === wanted && track.kind === 'video')
  return hasTrack ? wanted : format.defaultRoles.video
}

// VDB text kinds to a format text role and the kit style that draws it (kit:* styles,
// formats/kit/mapping.mjs). The project's own styles of that role stand in without a kit.
const TEXT_KINDS = {
  title_hook: { role: 'title', style: 'kit:title' },
  title: { role: 'title', style: 'kit:title' },
  hook: { role: 'title', style: 'kit:title' },
  list_item: { role: 'labels', style: 'kit:listicle-headline' },
  listicle: { role: 'labels', style: 'kit:listicle-headline' },
  chapter: { role: 'labels', style: 'kit:listicle-headline' },
  emphasis: { role: 'labels', style: 'kit:emphasis' },
  punch_line: { role: 'labels', style: 'kit:emphasis' },
  keyword: { role: 'labels', style: 'kit:emphasis' },
}

/** A text slot's role and style from its VDB kind (label, callout, cta...: an overlay). */
export function textRole(kind) {
  return TEXT_KINDS[squash(kind)] ?? { role: 'labels', style: 'kit:overlay' }
}

/**
 * A text slot's pattern: the hook template for the title hook when the source
 * has one; a numbered list item keeps its number ("1. [POINT]"); else the
 * reference text, to rewrite in the same shape.
 */
export function textPattern(kind, reference, hookTemplate) {
  const role = textRole(kind).role
  if (role === 'title' && hookTemplate) return hookTemplate
  const numbered = /^\s*(\d+)\s*[.):-]\s*\S/.exec(reference)
  if (squash(kind) === 'list_item' && numbered) return `${numbered[1]}. [POINT]`
  return reference
}

// ---------------------------------------------------------------------------
// The format a template suggests (formats/choosing.md, from a timeline's numbers)
// ---------------------------------------------------------------------------

const pickVariant = {
  'graphic-yap': ({ picturesPerMin }) =>
    picturesPerMin >= 27
      ? ['intense', `${picturesPerMin} images per minute (27 or more)`]
      : ['standard', `${picturesPerMin} images per minute`],
  vlog: ({ cutsPerMin }) =>
    cutsPerMin >= 33
      ? ['fast', `${cutsPerMin} cuts per minute`]
      : ['slow', `${cutsPerMin} cuts per minute`],
  'ten-shot': ({ openerRatio, spread }) => {
    if (openerRatio >= 1.5) return ['shaped', `opener ${openerRatio}x the median shot`]
    if (spread <= 0.35) return ['even', 'shots about the same length']
    return ['beat', 'shot lengths alternate']
  },
  greenscreen: () => [null, ''],
}

const round2 = (value) => Math.round(value * 100) / 100

function variantSignals(slots, pacing) {
  const shots = slots.filter((slot) => slot.kind === 'shot')
  const pictures =
    shots.filter((s) => s.role !== 'speaker').length +
    slots.filter((s) => s.kind === 'graphic').length
  const minutes = (pacing.durationSec || 1) / 60
  const lengths = shots.map((s) => s.targetSec).sort((a, b) => a - b)
  const median = pacing.medianShotSec || 1
  const mean = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1)
  const variance = lengths.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (lengths.length || 1)
  return {
    picturesPerMin: round2(pictures / minutes),
    cutsPerMin: pacing.cutsPerMin,
    openerRatio: round2((shots[0]?.targetSec ?? 0) / median),
    spread: round2(Math.sqrt(variance) / (mean || 1)),
  }
}

/** The Shreditor format the reference's own format name is, if it is one of the four. */
const namedFormat = (name) => (name ? (getFormat(name)?.id ?? null) : null)

function formatByMix(mix, { speechless, keyed }) {
  if (speechless) return ['ten-shot', 'nobody talks: clips cut to music']
  const speaker = mix.speaker ?? 0
  if (speaker >= 0.3)
    return keyed
      ? ['greenscreen', `the speaker is on screen ${Math.round(speaker * 100)}% of the time, keyed`]
      : [
          'graphic-yap',
          `the speaker talks to camera ${Math.round(speaker * 100)}% of the time in a real setting, with pictures cut in`,
        ]
  return ['vlog', `voice over pictures (the speaker on screen only ${Math.round(speaker * 100)}%)`]
}

/**
 * The format and variant a template suggests, with the reason: the reference's
 * own format when it is one of the four, else from the shot mix (who is on
 * screen, whether anyone talks, a keyed background).
 */
export function suggestTemplateFormat({ referenceFormat, slots, pacing, keyed = false }) {
  const mix = shotMix(slots)
  const shots = slots.filter((slot) => slot.kind === 'shot')
  const speechless = shots.length > 0 && shots.every((slot) => slot.speech === 'none')
  const named = namedFormat(referenceFormat)
  const [id, why] = named
    ? [named, `the reference is a ${getFormat(named).name}`]
    : formatByMix(mix, { speechless, keyed })
  const [variant, variantWhy] = pickVariant[id](variantSignals(slots, pacing))
  const from = referenceFormat && !named ? `${referenceFormat} (not a Shreditor format): ` : ''
  const name = resolveFormat(id, variant).name
  return {
    id,
    ...(variant ? { variant } : {}),
    reason: `${from}${why}${variantWhy ? `; ${variantWhy}` : ''} → ${name}${variant ? ` ${variant}` : ''}`,
  }
}
