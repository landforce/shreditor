// Edit templates from VideoDatabase (videodatabase.io): the Video DNA of an
// analyzed short-form video, as the VideoDatabase MCP tool `get_video_dna`
// returns it with format "json", or the "Video DNA" Markdown export users
// download from the site. Both read into one shape (`readVdbJson`,
// `readVdbMarkdown`), then into the same template (`templateFromVdb`).
//
// VideoDatabase timings are AI-labeled and not frame-accurate, and its own
// guidance is not to treat reference timing as mandatory for new clips: the
// template keeps them as structure and targets. Pure.
import {
  inferShotType,
  shotRole,
  slotCategories,
  suggestTemplateFormat,
  textPattern,
  textRole,
} from './roles.mjs'
import {
  TEMPLATE_KIND,
  TEMPLATE_VERSION,
  anchorFor,
  captionsFrom,
  pacingFromSlots,
  sortSlots,
  templateSlug,
  timed,
} from './template.mjs'

/** VideoDatabase analyzes 9:16 short form; the DNA doesn't carry the canvas. */
const SHORT_FORM = Object.freeze({ width: 1080, height: 1920, fps: 30, aspect: '9:16' })

const squash = (text) =>
  String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
const oneLine = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
const number = (value) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// JSON (get_video_dna, format json)
// ---------------------------------------------------------------------------

/** A DNA field's value: `{ label, value }` or the value itself. */
const fieldValue = (fields, key) => {
  const field = fields?.[key]
  return field && typeof field === 'object' && 'value' in field ? field.value : field
}

/** A list from an array, a JSON-encoded array, or one item per line. */
function listOf(value) {
  if (Array.isArray(value)) return value.map(oneLine).filter(Boolean)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(oneLine).filter(Boolean)
  } catch {}
  return value
    .split('\n')
    .map((line) => oneLine(line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')))
    .filter(Boolean)
}

const templateText = (value) =>
  typeof value === 'string' ? oneLine(value) : oneLine(value?.template ?? '')

const entries = (list) =>
  Array.isArray(list) ? list.filter((e) => e && typeof e === 'object') : []

/** The DNA's `data` (the MCP response wraps it in `{ success, format, data }`). */
const dnaData = (raw) => (raw?.data && typeof raw.data === 'object' ? raw.data : raw)

const textOrNull = (value) => oneLine(value) || null
const valueOrNull = (value) => value ?? null

/** Who and where: the video id, creator, description and links. */
const jsonIdentity = (data) => ({
  videoId: valueOrNull(data.video_id),
  creator: valueOrNull(data.creator),
  description: valueOrNull(data.description),
  vdbUrl: valueOrNull(data.vdb_url),
  sourceUrl: valueOrNull(data.source_url),
})

/** The analysis fields a template uses: format, hook, outline, framework. */
function jsonFields(fields, metrics) {
  const field = (key) => fieldValue(fields, key)
  return {
    referenceFormat: textOrNull(field('video_format') ?? metrics.db_format),
    hook: {
      title: textOrNull(field('hook_title_content')),
      verbal: textOrNull(field('hook_verbal_content')),
      template: textOrNull(templateText(field('hook_template'))),
    },
    outline: listOf(field('simple_outline')),
    framework: textOrNull(field('narrative_framework') ?? field('story_framework')),
  }
}

function jsonTimeline(data) {
  const timeline = data.timeline ?? {}
  if (timeline.available === false || !Array.isArray(timeline.shots))
    throw new Error(
      'this Video DNA has no edit timeline (data.timeline is unavailable): the video has no timed editing analysis yet, so there is nothing to template',
    )
  const metrics = timeline.metrics ?? {}
  return {
    durationSec: number(metrics.duration_s) ?? number(timeline.duration),
    metrics,
    shots: entries(timeline.shots),
    graphics: entries(timeline.graphics),
    texts: entries(timeline.texts),
    captions: entries(timeline.captions),
  }
}

/** A `get_video_dna` JSON response (or its `data`), read into the shared DNA shape. */
function readVdbJson(raw) {
  const data = dnaData(raw)
  if (!data || typeof data !== 'object') throw new Error('not a Video DNA response (no data)')
  const timeline = jsonTimeline(data)
  return {
    input: 'json',
    ...jsonIdentity(data),
    ...jsonFields(data.fields ?? {}, timeline.metrics),
    ...timeline,
  }
}

// ---------------------------------------------------------------------------
// Markdown (the Video DNA download)
// ---------------------------------------------------------------------------

/** `mm:ss.mmm`, `h:mm:ss.mmm` or `12.5s` to seconds; null when it is neither. */
function clockSeconds(text) {
  const value = String(text ?? '').trim()
  const seconds = /^(-?[\d.]+)\s*s$/.exec(value)
  if (seconds) return number(seconds[1])
  const parts = value.split(':')
  if (parts.length < 2 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return number(value)
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}

/** `## Heading` sections (or `###` with level 3): heading lower case -> body text. */
function sections(text, level) {
  const marker = '#'.repeat(level)
  const out = new Map()
  let current = null
  for (const line of text.split('\n')) {
    const heading = new RegExp(`^${marker} (?!#)(.+)$`).exec(line)
    if (heading) {
      current = heading[1].trim().toLowerCase()
      out.set(current, [])
    } else if (line.startsWith('#'.repeat(level - 1) + ' ') && level > 2) current = null
    else if (current) out.get(current).push(line)
  }
  return new Map([...out].map(([key, lines]) => [key, lines.join('\n').trim()]))
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())

/** A Markdown table as rows keyed by lower-case header. */
function table(body) {
  const lines = (body ?? '').split('\n').filter((line) => line.trim().startsWith('|'))
  if (lines.length < 2) return []
  const header = cells(lines[0]).map((cell) => cell.toLowerCase())
  return lines
    .slice(2)
    .map(cells)
    .map((row) => Object.fromEntries(header.map((key, i) => [key, row[i] ?? ''])))
}

const pick = (row, ...keys) => keys.map((key) => row[key]).find((value) => value) ?? ''

const timedRow = (row) => ({
  id: pick(row, 'id'),
  start: clockSeconds(pick(row, 'start')),
  end: clockSeconds(pick(row, 'end')),
})

const shotRow = (row) => ({
  ...timedRow(row),
  boundary: squash(pick(row, 'boundary')),
  description: pick(row, 'on screen', 'description', 'content'),
  framing: pick(row, 'framing') || null,
  camera: pick(row, 'camera') || null,
  speech: squash(pick(row, 'speech')) || null,
  ...(pick(row, 'shot type', 'type') ? { shot_type: squash(pick(row, 'shot type', 'type')) } : {}),
})

const overlayRow = (row) => ({
  ...timedRow(row),
  kind: squash(pick(row, 'kind', 'type')),
  position: pick(row, 'position') || null,
  description: pick(row, 'content', 'on screen', 'description'),
})

// Pacing bullet labels to the JSON metric keys.
const PACING_KEYS = {
  duration: 'duration_s',
  'camera shots': 'camera_shot_count',
  'visual segments': 'segment_count',
  'cuts per minute': 'cuts_per_minute',
  'median shot length': 'median_shot_s',
  'first cut': 'first_cut_s',
  graphics: 'graphics_count',
  'graphics per minute': 'graphics_per_minute',
  'text overlays': 'text_overlay_count',
  'words per minute': 'words_per_minute',
  'continuous take': 'continuous_take',
}

function pacing(body) {
  const metrics = {}
  for (const line of (body ?? '').split('\n')) {
    const bullet = /^\s*[-*]\s*([^:]+):\s*(.+)$/.exec(line)
    const key = bullet && PACING_KEYS[bullet[1].trim().toLowerCase()]
    if (!key) continue
    const value = bullet[2].trim()
    metrics[key] = /^(yes|no|true|false)$/i.test(value)
      ? /^(yes|true)$/i.test(value)
      : clockSeconds(value)
  }
  return metrics
}

const firstLine = (body) => oneLine((body ?? '').split('\n').find((line) => line.trim()) ?? '')
const link = (text, label) =>
  new RegExp(`\\[${label}\\]\\((https?://[^)\\s]+)\\)`, 'i').exec(text)?.[1] ?? null

/** Who and where, from the `# Video DNA: @creator - description` title and the links line. */
function mdIdentity(text) {
  const title = (/^# Video DNA:\s*(.+)$/m.exec(text)?.[1] ?? '').trim()
  const [, creator = null, description = null] = /^(@\S+)\s+[-–]\s+(.+)$/.exec(title) ?? []
  const vdbUrl = link(text, 'VDB')
  return {
    videoId: number(/\/video\/(\d+)/.exec(vdbUrl ?? '')?.[1]),
    creator,
    description: description ?? textOrNull(title),
    vdbUrl,
    sourceUrl: link(text, 'IG') ?? link(text, 'TT') ?? link(text, 'YT'),
  }
}

/** The analysis sections a template uses (an export may leave any of them out). */
function mdFields(top) {
  const line = (key) => textOrNull(firstLine(top.get(key)))
  return {
    referenceFormat: line('format'),
    hook: {
      title: line('hook title'),
      verbal: line('hook verbal'),
      template: line('hook template'),
    },
    outline: listOf(top.get('simple outline') ?? top.get('outline') ?? ''),
    framework: line('narrative framework'),
  }
}

function mdTimeline(timeline) {
  const metrics = pacing(timeline.get('pacing'))
  return {
    durationSec: valueOrNull(metrics.duration_s),
    metrics,
    shots: table(timeline.get('shots')).map(shotRow),
    graphics: table(timeline.get('graphics')).map(overlayRow),
    texts: table(timeline.get('on-screen text') ?? timeline.get('text')).map(overlayRow),
    captions: table(timeline.get('captions')).map(overlayRow),
  }
}

/** A Video DNA Markdown export, read into the shared DNA shape. */
function readVdbMarkdown(text) {
  const top = sections(text, 2)
  const timeline = sections(top.get('edit timeline') ?? '', 3)
  if (!timeline.has('shots'))
    throw new Error(
      'this Video DNA has no "## Edit Timeline" with a Shots table: the video has no timed editing analysis to template',
    )
  return { input: 'md', ...mdIdentity(text), ...mdFields(top), ...mdTimeline(timeline) }
}

// ---------------------------------------------------------------------------
// DNA -> template
// ---------------------------------------------------------------------------

const valid = (entry) => entry.start !== null && entry.end !== null && entry.end > entry.start
const slotId = (entry, prefix, index) =>
  String(entry.id ?? '').trim() || `${prefix}${String(index + 1).padStart(2, '0')}`

function shotSlot(shot, index) {
  const role = shotRole(shot)
  return {
    id: slotId(shot, 'S', index),
    kind: 'shot',
    role,
    ...timed(shot.start, shot.end),
    boundary: squash(shot.boundary) || (index === 0 ? 'start' : 'cut'),
    framing: shot.framing ?? null,
    camera: shot.camera ?? null,
    shotType: inferShotType(shot),
    speech: squash(shot.speech) || null,
    description: oneLine(shot.description),
    category: slotCategories(role)[0],
  }
}

function textSlot(text, index, hook, shots) {
  const reference = oneLine(text.description)
  const { role, style } = textRole(text.kind)
  return {
    id: slotId(text, 'T', index),
    kind: 'text',
    role,
    textKind: squash(text.kind) || 'text',
    ...timed(text.start, text.end),
    position: text.position ?? null,
    style,
    pattern: textPattern(text.kind, reference, hook.template),
    reference,
    anchor: anchorFor(shots, text.start),
  }
}

function graphicSlot(graphic, index, shots) {
  const kind = squash(graphic.kind) || 'graphic'
  return {
    id: slotId(graphic, 'G', index),
    kind: 'graphic',
    role: /screen/.test(kind) ? 'screen' : 'images',
    graphicKind: kind,
    ...timed(graphic.start, graphic.end),
    position: graphic.position ?? null,
    description: oneLine(graphic.description),
    anchor: anchorFor(shots, graphic.start),
  }
}

/** The shots' end (the reported duration is rounded in a Markdown export), unless it runs on past them. */
function durationOf(dna, shots) {
  const end = Math.max(...[...shots, ...dna.captions.filter(valid)].map((entry) => entry.end))
  return (dna.durationSec ?? 0) > end + 0.1 ? dna.durationSec : end
}

function sourceOf(dna, file) {
  return {
    type: 'vdb',
    videoId: dna.videoId,
    url: dna.vdbUrl,
    platformUrl: dna.sourceUrl,
    creator: dna.creator,
    description: dna.description,
    referenceFormat: dna.referenceFormat,
    input: dna.input,
    ...(file ? { file } : {}),
    note: 'VideoDatabase timings are AI-labeled, not frame-accurate: structure and targets, not timings to copy',
  }
}

const outlineOf = (dna) =>
  dna.outline.length || dna.hook.title || dna.hook.template || dna.framework
    ? {
        beats: dna.outline,
        hook: dna.hook,
        ...(dna.framework ? { framework: dna.framework } : {}),
      }
    : null

const defaultName = (dna) =>
  templateSlug(
    [String(dna.creator ?? '').replace(/^@/, ''), dna.videoId].filter(Boolean).join('-') ||
      dna.description,
  )

/**
 * A template from Video DNA (`readVdbJson` / `readVdbMarkdown`): its shots as
 * slots with roles, its texts and graphics anchored to the shot they start in,
 * captions on, off or a span, the outline and hook when the source has them,
 * the pacing measured from the shots, and the format it suggests.
 */
export function templateFromVdb(dna, { name, file, createdAt = new Date().toISOString() } = {}) {
  const rawShots = dna.shots.filter(valid).sort((a, b) => a.start - b.start)
  if (!rawShots.length) throw new Error('the Video DNA has no timed shots')
  const shots = rawShots.map(shotSlot)
  const durationSec = durationOf(dna, rawShots)
  const slots = sortSlots([
    ...shots,
    ...dna.graphics.filter(valid).map((g, i) => graphicSlot(g, i, shots)),
    ...dna.texts.filter(valid).map((t, i) => textSlot(t, i, dna.hook, shots)),
  ])
  const words = number(dna.metrics.words_per_minute)
  const pacing = pacingFromSlots(slots, durationSec, {
    wordsPerMin: words,
    reported: dna.metrics,
  })
  const captions = dna.captions.filter(valid)
  return {
    kind: TEMPLATE_KIND,
    version: TEMPLATE_VERSION,
    name: templateSlug(name ?? defaultName(dna)),
    title: [dna.description, dna.creator ? `(${dna.creator})` : null].filter(Boolean).join(' '),
    createdAt,
    source: sourceOf(dna, file),
    format: suggestTemplateFormat({
      referenceFormat: dna.referenceFormat,
      slots,
      pacing,
      keyed: /green ?screen/i.test(`${dna.referenceFormat} ${shots.map((s) => s.description)}`),
    }),
    canvas: { ...SHORT_FORM, assumed: true },
    durationSec: pacing.durationSec,
    pacing,
    slots,
    captions: captionsFrom(captions, durationSec, {
      position: captions[0]?.position ?? null,
    }),
    outline: outlineOf(dna),
  }
}

/** Read Video DNA from a file's text: JSON (get_video_dna) or the Markdown download. */
export function readVdb(text) {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{')) return readVdbJson(JSON.parse(trimmed))
  return readVdbMarkdown(text)
}
