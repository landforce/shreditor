// An edit template: the timed structure of a reference video (a VideoDatabase
// analysis, or a finished Shreditor project) as slots to fill with new footage,
// plus the pacing targets the new cut is scored against. Structure and
// targets, never mandatory timings: the new cut follows its own speech, and
// `shred check` reports how close it lands (formats/edit-template/score.mjs).
//
//   {
//     kind: 'shreditor-edit-template', version: 1, name, title, createdAt,
//     source: { type: 'vdb', videoId, url, platformUrl, creator, description, referenceFormat, input }
//           | { type: 'project', projectId, projectName, revision },
//     format: { id, variant?, reason },          // the suggested Shreditor format
//     canvas: { width, height, fps, aspect },
//     durationSec,
//     pacing: { durationSec, shotCount, cutsPerMin, medianShotSec, firstCutSec, longestShotSec,
//               wordsPerMin, textCount, labelCount, graphicsPerMin, title: { atSec, holdSec } | null,
//               shotMix: { speaker: 0.9, images: 0.06, ... }, reported? },
//     slots: [                                   // in time order
//       { id, kind: 'shot', role, start, end, targetSec, boundary, framing, camera, shotType,
//         speech, description, category, project? },
//       { id, kind: 'text', role: 'title' | 'labels', textKind, start, end, targetSec, position,
//         style, pattern, reference, anchor: { slot, offsetSec }, project? },
//       { id, kind: 'graphic', role, graphicKind, start, end, targetSec, position, description, anchor },
//       { id, kind: 'audio', role: 'music' | 'voice' | 'sfx', start, end, targetSec, project },
//     ],
//     captions: { mode: 'on' | 'off' | 'span', start?, end?, position?, style? },
//     outline: { beats: [...], hook: { title, verbal, template }, framework? } | null,
//     project?: { tracks, textStyles }           // a project-derived template: what `new --from-template` rebuilds
//   }
//
// Times are seconds on the reference's timeline. Pure.

/** Roles a shot slot plays in a template. `screen` is a screen recording or screenshot. */
const SLOT_ROLES = Object.freeze(['speaker', 'images', 'screen', 'broll', 'shots'])

export const TEMPLATE_KIND = 'shreditor-edit-template'
export const TEMPLATE_VERSION = 1

const round3 = (value) => Math.round(value * 1000) / 1000
const round2 = (value) => Math.round(value * 100) / 100

export const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** A slug for a template file name: lower case, dashes, no more than 60 characters. */
export function templateSlug(text) {
  const slug = String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'template'
}

/** Seconds, rounded to the millisecond, with the slot length. */
export const timed = (start, end) => ({
  start: round3(start),
  end: round3(end),
  targetSec: round3(end - start),
})

/** Labeled timings are rounded: a moment this close before a shot starts belongs to that shot. */
const SNAP_SEC = 0.05

/** The shot slot a moment falls in, and how far into it: a text or graphic's anchor. */
export function anchorFor(slots, at) {
  const shots = slots.filter((slot) => slot.kind === 'shot')
  const hit =
    shots.find((slot) => at + SNAP_SEC >= slot.start && at < slot.end - SNAP_SEC) ??
    shots.find((slot) => at >= slot.start && at < slot.end) ??
    (at >= (shots.at(-1)?.end ?? 0) ? shots.at(-1) : shots[0])
  return hit ? { slot: hit.id, offsetSec: round3(Math.max(0, at - hit.start)) } : null
}

/** Runtime share of each role over `[{ role, sec }]`, rounded to 0.01 (roles with none left out). */
export function shotMixOf(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.sec, 0) || 1
  const share = (role) => entries.filter((e) => e.role === role).reduce((sum, e) => sum + e.sec, 0)
  return Object.fromEntries(
    SLOT_ROLES.map((role) => [role, round2(share(role) / total)]).filter(([, value]) => value > 0),
  )
}

/** The shot slots' runtime share per role. */
export const shotMix = (slots) =>
  shotMixOf(
    slots
      .filter((slot) => slot.kind === 'shot')
      .map((slot) => ({ role: slot.role, sec: slot.targetSec })),
  )

function titleOf(slots) {
  const title = slots.find((slot) => slot.kind === 'text' && slot.role === 'title')
  return title ? { atSec: title.start, holdSec: title.targetSec } : null
}

/**
 * The pacing targets measured from the slots: cuts per minute (shot changes
 * over the runtime), median, first and longest shot, text counts, the title's
 * start and hold, the shot mix. `reported` keeps the source's own metrics.
 */
export function pacingFromSlots(slots, durationSec, { wordsPerMin = null, reported } = {}) {
  const shots = slots.filter((slot) => slot.kind === 'shot')
  const lengths = shots.map((slot) => slot.targetSec)
  const minutes = durationSec / 60 || 1
  const texts = slots.filter((slot) => slot.kind === 'text')
  return {
    durationSec: round3(durationSec),
    shotCount: shots.length,
    cutsPerMin: round2(Math.max(0, shots.length - 1) / minutes),
    medianShotSec: lengths.length ? round3(median(lengths)) : null,
    firstCutSec: shots.length > 1 ? shots[0].end : null,
    longestShotSec: lengths.length ? round3(Math.max(...lengths)) : null,
    wordsPerMin,
    textCount: texts.length,
    labelCount: texts.filter((slot) => slot.role === 'labels').length,
    graphicsPerMin: round2(slots.filter((slot) => slot.kind === 'graphic').length / minutes),
    title: titleOf(slots),
    shotMix: shotMix(slots),
    ...(reported ? { reported } : {}),
  }
}

/** Captions from caption spans: on for (nearly) the whole video, a span, or off. */
export function captionsFrom(spans, durationSec, extra = {}) {
  if (!spans.length) return { mode: 'off' }
  const start = Math.min(...spans.map((s) => s.start))
  const end = Math.max(...spans.map((s) => s.end))
  const covered = spans.reduce((sum, s) => sum + (s.end - s.start), 0)
  const mode = covered >= durationSec * 0.9 ? 'on' : 'span'
  return { mode, start: round3(start), end: round3(end), ...extra }
}

/** Slots in time order (shots first at a tie), each kind keeping its own ids. */
export const sortSlots = (slots) => {
  const rank = { shot: 0, graphic: 1, text: 2, audio: 3 }
  return [...slots].sort((a, b) => a.start - b.start || rank[a.kind] - rank[b.kind])
}

const isText = (value) => typeof value === 'string' && value.trim().length > 0

const slotsOf = (raw) => (Array.isArray(raw.slots) ? raw.slots : [])
const badSlot = (slot) => !isText(slot?.id) || !(slot.end > slot.start)

/** The template-wide rules: `[[broken, message], ...]`. */
const TEMPLATE_RULES = [
  [(raw) => raw.kind !== TEMPLATE_KIND, () => `kind is not "${TEMPLATE_KIND}"`],
  [
    (raw) => raw.version !== TEMPLATE_VERSION,
    (raw) => `version ${raw.version} is not ${TEMPLATE_VERSION}`,
  ],
  [(raw) => !isText(raw.name), () => 'no name'],
  [(raw) => !slotsOf(raw).some((slot) => slot?.kind === 'shot'), () => 'no shot slots'],
  [(raw) => !raw.format?.id, () => 'no suggested format'],
]

/** Problems that make a parsed JSON not a usable template (an empty list when it is one). */
export function templateProblems(raw) {
  if (!raw || typeof raw !== 'object') return ['a template is a JSON object']
  return [
    ...TEMPLATE_RULES.filter(([broken]) => broken(raw)).map(([, message]) => message(raw)),
    ...slotsOf(raw)
      .filter(badSlot)
      .map((slot) => `slot ${slot?.id ?? '?'} needs an id and start < end`),
  ]
}
