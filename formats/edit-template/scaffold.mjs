// A first plan (agent/plan.json, schema v3) from an edit template: the
// template guides the plan, it never builds on its own. `shred plan <id>
// --template <name>` writes it, `shred plan` validates it, `shred build` builds
// it like any plan.
//
// Story formats (Vlog, 10 Shot): one beat per shot slot at the slot's frames,
// on the slot's track, with a candidate clip from the project's media where
// the category makes it obvious, the template's texts on the beats they fall
// in. Speaker formats (Graphic Yap, Greenscreen): the plan is still the
// speaker's performance (formats/plan/performance/scaffold.mjs, from the new
// footage's transcript); the template places its cutaways, graphics and texts
// onto the kept lines at the same share of the runtime, so the new cut follows
// its own speech and borrows the reference's structure. Pure.
import { scaffoldPerformance } from '../plan/performance/scaffold.mjs'
import { slotCategories, slotTrackRole } from './roles.mjs'

const round3 = (value) => Math.round(value * 1000) / 1000
const pad = (n) => String(n).padStart(2, '0')
const MIN_VISUAL_SEC = 0.2

/** The `template` record a plan carries (and `shred check` reads). */
const planTemplate = (template, hash) => ({
  name: template.name,
  ...(hash ? { hash } : {}),
  source:
    template.source.type === 'vdb'
      ? { type: 'vdb', videoId: template.source.videoId, url: template.source.url }
      : { type: 'project', projectId: template.source.projectId },
})

/** The reference's arc from its outline, else its shape (the agent rewrites it for this video). */
function arcFrom(template) {
  if (template.outline?.beats?.length)
    return `Follow the reference's arc: ${template.outline.beats.join(' → ')}.`
  if (template.outline?.framework) return template.outline.framework
  const shots = template.slots.filter((slot) => slot.kind === 'shot').length
  const title = template.pacing.title ? ', opening on its title hook' : ''
  return `Follow the reference's structure (${template.title || template.name}): ${shots} shots over ${Math.round(template.durationSec)} s${title}.`
}

// ---------------------------------------------------------------------------
// Candidate media: the project's media whose category fills each slot role
// ---------------------------------------------------------------------------

const kindsFor = (role) =>
  ({ speaker: ['video'], images: ['image', 'video'], screen: ['image', 'video'] })[role] ?? [
    'video',
    'image',
  ]

/** Media that fill a slot of `role`, best first: by category, else uncategorized of the right kind. */
function candidatesFor(role, media) {
  const kinds = kindsFor(role)
  const fits = media.filter((m) => kinds.includes(m.kind))
  const byCategory = slotCategories(role).flatMap((category) =>
    fits.filter((m) => m.category === category),
  )
  if (byCategory.length || role === 'speaker') return byCategory
  return fits
    .filter((m) => !m.category)
    .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind))
}

/**
 * Picks candidates round-robin per role, walking through a video so repeated
 * use takes a fresh in-point: `pick(role, seconds)` -> `{ mediaId, inSec }` or null.
 */
function mediaPicker(media) {
  const turn = new Map()
  const used = new Map()
  return (role, seconds) => {
    const list = candidatesFor(role, media)
    if (!list.length) return null
    const start = turn.get(role) ?? 0
    for (let i = 0; i < list.length; i += 1) {
      const candidate = list[(start + i) % list.length]
      if (candidate.kind === 'image') {
        turn.set(role, start + i + 1)
        return { mediaId: candidate.mediaId }
      }
      if (candidate.duration + 0.01 < seconds) continue
      const at = used.get(candidate.mediaId) ?? 0
      const inSec = at + seconds <= candidate.duration ? at : 0
      used.set(candidate.mediaId, inSec + seconds)
      turn.set(role, start + i + 1)
      return { mediaId: candidate.mediaId, inSec: round3(inSec) }
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Story plans
// ---------------------------------------------------------------------------

const frames = (sec, fps) => Math.round(sec * fps)

function storyRole(i, count, format) {
  const has = (role) => format.structure.some((part) => part.role === role)
  if (i === 0) return 'hook'
  if (i === count - 1 && count > 2 && has('close')) return 'close'
  return 'body'
}

/** The outline beat a moment falls in (beats spread evenly over the runtime). */
const outlineAt = (template, sec) => {
  const beats = template.outline?.beats ?? []
  if (!beats.length) return ''
  const share = Math.min(0.999, Math.max(0, sec / (template.durationSec || 1)))
  return beats[Math.floor(share * beats.length)]
}

const styleFor = (slot, styles) =>
  slot.style && styles.has(slot.style) ? { style: slot.style } : {}

function storyText(slot, fps, styles) {
  return {
    text: slot.pattern || slot.reference,
    role: slot.role,
    edit: [frames(slot.start, fps), Math.max(frames(slot.start, fps) + 1, frames(slot.end, fps))],
    ...styleFor(slot, styles),
  }
}

function storyBeats(template, { format, fps, pick }) {
  const shots = template.slots.filter((slot) => slot.kind === 'shot')
  return shots.map((slot, i) => {
    const start = frames(slot.start, fps)
    const end = Math.max(start + 1, frames(slot.end, fps))
    const source = pick(slot.role, (end - start) / fps)
    return {
      id: `b${pad(i + 1)}`,
      role: storyRole(i, shots.length, format),
      edit: [start, end],
      source: source
        ? {
            mediaId: source.mediaId,
            ...(source.inSec !== undefined ? { in: source.inSec, unit: 's' } : {}),
          }
        : {},
      track: slotTrackRole(slot.role, format),
      slot: slot.id,
      targetSeconds: slot.targetSec,
      takeaway: outlineAt(template, slot.start),
      why: `Template ${template.name} ${slot.id}: ${slot.role}, ${slot.targetSec} s${slot.boundary ? `, ${slot.boundary.replace('_', ' ')}` : ''}${slot.description ? `: ${slot.description}` : ''}`,
    }
  })
}

/** Each text slot on the first beat (from the one it starts in) that has no text yet. */
function attachTexts(beats, template, fps, styles) {
  const skipped = []
  for (const slot of template.slots.filter((s) => s.kind === 'text')) {
    const at = frames(slot.start, fps)
    const from = Math.max(
      0,
      beats.findIndex((beat) => at >= beat.edit[0] && at < beat.edit[1]),
    )
    const beat = beats.slice(from).find((b) => !b.text)
    if (beat) beat.text = storyText(slot, fps, styles)
    else skipped.push(slot.id)
  }
  return skipped
}

function storyPlan(template, options) {
  const { fps, request, hash, styles } = options
  const pick = mediaPicker(options.media)
  const beats = storyBeats(template, { ...options, pick })
  const skipped = attachTexts(beats, template, fps, styles)
  const plan = {
    schemaVersion: 3,
    mode: 'story',
    fps,
    durationFrames: Math.max(...beats.map((beat) => beat.edit[1])),
    request,
    story: { arc: arcFrom(template), structure: [...new Set(beats.map((beat) => beat.role))] },
    template: planTemplate(template, hash),
    beats,
  }
  const empty = beats.filter((beat) => !beat.source.mediaId).map((beat) => beat.slot)
  return { plan, toFill: empty, skippedTexts: skipped }
}

// ---------------------------------------------------------------------------
// Performance plans
// ---------------------------------------------------------------------------

/** Kept lines with where each starts in the cut (seconds) and how long it plays. */
function cutLines(plan) {
  const pad = (plan.performance.padFrames ?? 0) / plan.fps
  let at = 0
  return plan.performance.lines
    .filter((line) => line.keep)
    .map((line) => {
      const length = line.source.out - line.source.in
      const entry = { line, start: at, length }
      at += length + 2 * pad
      return entry
    })
}

const lineAt = (cut, sec) =>
  Math.max(
    0,
    cut.findIndex((entry) => sec >= entry.start && sec < entry.start + entry.length),
  )

/**
 * A free stretch of `seconds` on `track` from cut time `sec`: the line it
 * falls in (or a later one) and seconds after that line's in. null past the end.
 */
function placeOn(cut, busy, track, sec, seconds) {
  for (let i = lineAt(cut, sec); i < cut.length; i += 1) {
    const entry = cut[i]
    const key = `${entry.line.id}:${track}`
    const from = Math.max(i === lineAt(cut, sec) ? sec - entry.start : 0, busy.get(key) ?? 0, 0)
    if (entry.length - from < MIN_VISUAL_SEC) continue
    const until = Math.min(entry.length, from + Math.max(seconds, MIN_VISUAL_SEC))
    busy.set(key, until)
    return { entry, at: round3(from), until: round3(until) }
  }
  return null
}

const isCutaway = (slot) =>
  (slot.kind === 'shot' && slot.role !== 'speaker') || slot.kind === 'graphic'

function placeVisuals(cut, template, { format, ratio, pick }) {
  const busy = new Map()
  const missed = []
  for (const slot of template.slots.filter(isCutaway)) {
    const track = slotTrackRole(slot.role, format)
    const spot = placeOn(cut, busy, track, slot.start * ratio, slot.targetSec)
    if (!spot) {
      missed.push(slot.id)
      continue
    }
    const asset = pick(slot.role, slot.targetSec)
    const visuals = spot.entry.line.visuals
    visuals.push({
      track,
      ...(asset ? { asset: asset.mediaId, ...(asset.inSec ? { in: asset.inSec } : {}) } : {}),
      toSource: slot.description || `${slot.role} for ${slot.id}`,
      at: spot.at,
      until: spot.until,
      note: `template ${slot.id}: ${slot.kind === 'graphic' ? `${slot.graphicKind} graphic` : `${slot.role} cutaway`}, ${slot.targetSec} s${slot.position ? `, ${slot.position}` : ''}${asset ? '; a candidate by category, check it' : ''}`,
    })
  }
  return missed
}

/** The kept line whose end is nearest the title's reference hold (a line it barely enters is left out). */
function titleEndLine(cut, sec) {
  const at = lineAt(cut, sec)
  const entry = cut[at]
  return at > 0 && sec - entry.start < entry.length / 2 ? at - 1 : at
}

function titleOnScreen(cut, slot, styles) {
  const end = titleEndLine(cut, slot.end)
  const first = cut[0]
  const until = end === 0 ? round3(Math.min(first.length, slot.end)) : { line: cut[end].line.id }
  return { text: slot.pattern || slot.reference, role: 'title', until, ...styleFor(slot, styles) }
}

function placeTexts(cut, template, { ratio, styles }) {
  const missed = []
  for (const slot of template.slots.filter((s) => s.kind === 'text')) {
    if (slot.role === 'title' && slot.start <= 0.1) {
      cut[0].line.onScreen = titleOnScreen(cut, slot, styles)
      continue
    }
    const sec = slot.start * ratio
    const entry = cut.slice(lineAt(cut, sec)).find((e) => !e.line.onScreen)
    if (!entry) {
      missed.push(slot.id)
      continue
    }
    const at = round3(Math.max(0, Math.min(entry.length - MIN_VISUAL_SEC, sec - entry.start)))
    entry.line.onScreen = {
      text: slot.pattern || slot.reference,
      role: slot.role,
      at,
      until: round3(Math.min(entry.length, at + slot.targetSec)),
      ...styleFor(slot, styles),
    }
  }
  return missed
}

function performancePlan(template, options) {
  const { format, fps, speakers, request, hash, styles } = options
  if (!speakers?.length)
    throw new Error(
      `${format.name} plans the speaker's performance: import the speaker footage (--category speaker), wait for its transcript, then run this again (or name the speaker media ids)`,
    )
  const { plan, counts } = scaffoldPerformance(speakers, {
    format,
    fps,
    padFrames: options.padFrames,
    pauseSec: options.pauseSec,
  })
  const cut = cutLines(plan)
  if (!cut.length) throw new Error("the speakers' transcripts have no lines to keep")
  const last = cut.at(-1)
  const cutSec = last.start + last.length
  const ratio = cutSec / (template.durationSec || cutSec)
  const pick = mediaPicker(
    options.media.filter((m) => !speakers.some((s) => s.mediaId === m.mediaId)),
  )
  const missedVisuals = placeVisuals(cut, template, { format, ratio, pick })
  const missedTexts = placeTexts(cut, template, { ratio, styles })
  plan.request = request
  plan.story.arc = arcFrom(template)
  plan.template = planTemplate(template, hash)
  return {
    plan,
    counts,
    ratio: round3(ratio),
    cutSec: round3(cutSec),
    skippedVisuals: missedVisuals,
    skippedTexts: missedTexts,
  }
}

/**
 * A plan from a template for a project in `format`. Options: `fps`, `media`
 * (the project's media: `{ mediaId, fileName, kind, duration, category }`),
 * `request` (the user's ask), `hash` (the template's), `styles` (text style
 * ids/names the project can use), and for speaker formats `speakers`
 * (`{ mediaId, duration, words }`), `pauseSec`, `padFrames`.
 */
export function scaffoldFromTemplate(template, options) {
  const settings = { media: [], styles: new Set(), ...options }
  return settings.format.planMode === 'performance'
    ? { mode: 'performance', ...performancePlan(template, settings) }
    : { mode: 'story', ...storyPlan(template, settings) }
}
