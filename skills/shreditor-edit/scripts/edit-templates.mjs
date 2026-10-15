// `shred template ...`, `shred plan <id> --template`, `shred new --from-template`
// and the Template section of `shred check`: edit templates, the timed
// structure of a proven reference video (VideoDatabase Video DNA, or a finished
// Shreditor project) as slots to fill with new footage. The library is
// <workspace>/app/edit-templates/<name>.json, next to the text style and motion
// template libraries. A template guides the plan (agent/plan.json); it never
// builds on its own: `shred build` builds the plan as always. The model lives
// in formats/edit-template/.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { resolveFormat } from '../../../formats/registry.mjs'
import { transcriptWords } from '../../../formats/scorecard.mjs'
import { readVdb, templateFromVdb } from '../../../formats/edit-template/vdb.mjs'
import { templateFromProject } from '../../../formats/edit-template/project.mjs'
import { scaffoldFromTemplate } from '../../../formats/edit-template/scaffold.mjs'
import { scoreTemplate } from '../../../formats/edit-template/score.mjs'
import { slotTrackRole } from '../../../formats/edit-template/roles.mjs'
import { templateProblems, templateSlug } from '../../../formats/edit-template/template.mjs'
import { readStoredTranscript } from '../../../server/transcription.mjs'
import { checkPlan, planCommands } from './plan.mjs'
import { kitTightCuts, scaffoldTiming } from './performance.mjs'

const LIBRARY = ['app', 'edit-templates']
const RECORD = 'template.json'
const TAG = { close: 'close', differs: 'differs', info: 'info', na: 'n/a' }

const hashOf = (text) => `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}
const clock = (sec) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, '0')}`
const pct = (share) => `${Math.round(share * 100)}%`

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const libraryDir = (ws) => path.join(ws, ...LIBRARY)
const templatePath = (ws, name) => path.join(libraryDir(ws), `${templateSlug(name)}.json`)

/** All templates in the library: `[{ name, file, template }]` (unreadable files left out). */
function listLibrary(ws) {
  const dir = libraryDir(ws)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: path.join(dir, f), template: readJson(path.join(dir, f)) }))
    .filter((entry) => entry.template && !templateProblems(entry.template).length)
}

/** A template by name (or a path to a template file): `{ template, file, hash }`. */
export function loadTemplate(ws, ref) {
  if (!ref) throw new Error('Name a template (shred template list)')
  const asFile = ref.endsWith('.json') && fs.existsSync(ref) ? path.resolve(ref) : null
  const file = asFile ?? templatePath(ws, ref)
  if (!fs.existsSync(file)) {
    const names = listLibrary(ws).map((e) => e.template.name)
    throw new Error(
      `No edit template "${ref}" in ${libraryDir(ws)}. ${names.length ? `Templates: ${names.join(', ')}` : 'The library is empty'} (shred template from-vdb | from-project)`,
    )
  }
  const text = fs.readFileSync(file, 'utf8')
  const template = JSON.parse(text)
  const problems = templateProblems(template)
  if (problems.length) throw new Error(`${file} is not an edit template: ${problems.join('; ')}`)
  return { template, file, hash: hashOf(text) }
}

function saveTemplate(ws, template) {
  const file = templatePath(ws, template.name)
  const existed = fs.existsSync(file)
  writeJson(file, template)
  return { file, existed, hash: hashOf(fs.readFileSync(file, 'utf8')) }
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

function sourceLine(source) {
  if (source.type === 'project')
    return `Shreditor project ${source.projectId} (${source.projectName})`
  return `VideoDatabase ${source.videoId ?? '?'}${source.url ? `  ${source.url}` : ''}  (${source.input === 'md' ? 'Video DNA .md' : 'get_video_dna json'})`
}

function pacingLine(p) {
  const parts = [
    `${p.shotCount} shots`,
    `${p.cutsPerMin} cuts/min`,
    p.medianShotSec !== null ? `median shot ${p.medianShotSec} s` : null,
    p.firstCutSec !== null ? `first cut ${p.firstCutSec} s` : null,
    p.longestShotSec !== null ? `longest ${p.longestShotSec} s` : null,
    p.wordsPerMin ? `${p.wordsPerMin} wpm` : null,
    `${p.textCount} text (${p.labelCount} labels)`,
  ]
  return parts.filter(Boolean).join(', ')
}

function header(say, template, format) {
  const variant = template.format.variant ? ` ${template.format.variant}` : ''
  say(`Template  ${template.name}  (v${template.version}) ${template.title ?? ''}`)
  say(`Source    ${sourceLine(template.source)}`)
  if (template.source.note) say(`          ${template.source.note}`)
  say(
    `Format    ${format.name}${variant}  (${template.format.id}${variant}: ${template.format.reason})`,
  )
  const c = template.canvas
  say(
    `Canvas    ${c.width}x${c.height} @${c.fps} (${c.aspect}${c.assumed ? ', assumed: VideoDatabase is 9:16 short form' : ''})   ${template.durationSec.toFixed(2)} s`,
  )
  say(`Pacing    ${pacingLine(template.pacing)}`)
  const mix = Object.entries(template.pacing.shotMix ?? {})
  if (mix.length) say(`Mix       ${mix.map(([role, share]) => `${role} ${pct(share)}`).join(', ')}`)
  const title = template.pacing.title
  if (title) say(`Title     from ${title.atSec} s, held ${title.holdSec} s`)
  const cap = template.captions
  say(
    `Captions  ${cap.mode}${cap.mode === 'off' ? '' : ` (${cap.start}-${cap.end} s${cap.position ? `, ${cap.position}` : ''}${cap.style ? `, style ${cap.style}` : ''})`}`,
  )
  const outline = template.outline
  if (outline?.beats?.length) say(`Outline   ${outline.beats.join(' → ')}`)
  if (outline?.hook?.template) say(`Hook      template "${outline.hook.template}"`)
  if (outline?.hook?.verbal) say(`          verbal "${outline.hook.verbal}"`)
}

const cell = (value, width) => String(value ?? '-').padEnd(width)

function slotRow(slot, format) {
  const span = `${clock(slot.start)}-${clock(slot.end)}`
  const track =
    slot.kind === 'shot' || slot.kind === 'graphic'
      ? slotTrackRole(slot.role, format)
      : slot.kind === 'text'
        ? slot.role
        : slot.role
  const how =
    slot.kind === 'shot'
      ? `${cell(slot.boundary?.replace('_', ' '), 11)} ${cell(slot.framing, 8)} ${cell(slot.speech?.replace('_', ' '), 10)}`
      : slot.kind === 'text'
        ? `${cell(slot.textKind?.replace('_', ' '), 11)} ${cell(slot.position, 8)} ${cell(slot.style, 10)}`
        : `${cell(slot.graphicKind ?? '', 11)} ${cell(slot.position, 8)} ${cell('', 10)}`
  const what =
    slot.kind === 'text'
      ? `"${slot.pattern}"${slot.pattern !== slot.reference ? `  (ref "${slot.reference}")` : ''}`
      : (slot.description ?? '')
  const media = slot.project?.fileName ? `  [${slot.project.fileName}]` : ''
  return `  ${cell(slot.id, 5)}${cell(slot.kind, 8)}${cell(slot.role, 8)} ${span}  ${slot.targetSec.toFixed(2).padStart(5)}  ${cell(track, 8)} ${how} ${what}${media}`
}

export function printTemplate(say, template) {
  const format = resolveFormat(template.format.id, template.format.variant)
  header(say, template, format)
  say(
    `\nSlots (${template.slots.length}; times on the reference, lengths are targets, not timings to copy)`,
  )
  say(
    `  ${cell('id', 5)}${cell('kind', 8)}${cell('role', 8)} ${cell('start-end', 15)}  ${'len'.padStart(5)}  ${cell('track', 8)} ${cell('cut/kind', 11)} ${cell('framing', 8)} ${cell('speech', 10)} what`,
  )
  for (const slot of template.slots) say(slotRow(slot, format))
}

// ---------------------------------------------------------------------------
// The project's record (agent/template.json) and media
// ---------------------------------------------------------------------------

const agentDir = (ws, id) => path.join(ws, 'projects', id, 'agent')
const recordFile = (ws, id) => path.join(agentDir(ws, id), RECORD)

function writeRecord(ws, id, loaded, extra = {}) {
  const previous = readJson(recordFile(ws, id)) ?? {}
  writeJson(recordFile(ws, id), {
    ...previous,
    name: loaded.template.name,
    file: loaded.file,
    hash: loaded.hash,
    recordedAt: new Date().toISOString(),
    ...extra,
    template: loaded.template,
  })
}

const mediaMeta = (ws, mediaId) => readJson(path.join(ws, 'media', mediaId, 'metadata.json'))
const kindOf = (mime = '') =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'video'

/** The project's media (media-links.json) with what the scaffold needs. */
function projectMedia(ws, id) {
  const links = readJson(path.join(ws, 'projects', id, 'media-links.json'))
  const ids = (links?.mediaIds ?? []).map((entry) =>
    typeof entry === 'string' ? entry : entry?.id,
  )
  return ids
    .filter(Boolean)
    .map((mediaId) => [mediaId, mediaMeta(ws, mediaId)])
    .filter(([, meta]) => meta)
    .map(([mediaId, meta]) => ({
      mediaId,
      fileName: meta.fileName ?? mediaId,
      kind: kindOf(meta.mimeType),
      duration: Number(meta.duration ?? 0),
      category: meta.category ?? null,
    }))
}

function wordsOf(ws, mediaId) {
  try {
    const stored = readStoredTranscript(ws, mediaId)
    return stored ? transcriptWords(stored) : []
  } catch {
    return []
  }
}

/** Speakers for a performance plan: the media ids given, else the project's speaker media with words. */
function speakersFor(ws, media, ids) {
  const chosen = ids.length
    ? ids.map(
        (mediaId) =>
          media.find((m) => m.mediaId === mediaId) ?? { mediaId, ...metaOf(ws, mediaId) },
      )
    : media.filter((m) => m.category === 'speaker')
  return chosen
    .map((m) => ({
      mediaId: m.mediaId,
      fileName: m.fileName,
      duration: m.duration,
      words: wordsOf(ws, m.mediaId),
    }))
    .filter((speaker) => {
      if (!speaker.words.length && ids.includes(speaker.mediaId))
        throw new Error(
          `${speaker.fileName ?? speaker.mediaId} has no transcript words: wait for it (shred transcript ${speaker.mediaId}) or run shred transcribe ${speaker.mediaId}`,
        )
      return speaker.words.length > 0
    })
}

function metaOf(ws, mediaId) {
  const meta = mediaMeta(ws, mediaId)
  if (!meta)
    throw new Error(`media ${mediaId} is not in the workspace (shred media --project <id>)`)
  return {
    fileName: meta.fileName,
    duration: Number(meta.duration ?? 0),
    kind: kindOf(meta.mimeType),
  }
}

/** Style names and ids a plan's text can name in this project. */
function usableStyles(project) {
  const styles = new Set()
  for (const style of project.timeline?.textStyles ?? []) {
    styles.add(style.id)
    styles.add(style.name)
  }
  if (project.kit)
    for (const id of [
      'kit:title',
      'kit:overlay',
      'kit:listicle-headline',
      'kit:emphasis',
      'kit:caption',
    ])
      styles.add(id)
  return styles
}

// ---------------------------------------------------------------------------
// shred plan <id> --template <name>
// ---------------------------------------------------------------------------

const DEFAULT_REQUEST = (template) =>
  `Cut the new footage in the structure of the reference (${template.title || template.name})`

function printScaffoldNotes(say, result, template, request) {
  if (result.mode === 'performance')
    say(
      `Performance from the speakers' transcripts: ${result.counts.lines} lines, ${result.counts.kept} kept (${result.cutSec} s cut vs ${template.durationSec} s reference: the template's slots land at ${result.ratio}x their reference times).`,
    )
  const missed = [...(result.skippedVisuals ?? []), ...(result.skippedTexts ?? [])]
  if (missed.length) say(`Slots with no room on the new cut (left out): ${missed.join(', ')}`)
  if (result.toFill?.length)
    say(
      `Beats with no candidate media (fill source.mediaId): ${result.toFill.join(', ')}. Import footage of the right category (shred import --category ...), then fill them.`,
    )
  if (request === DEFAULT_REQUEST(template))
    say(`request  "${request}" (the default; --request puts the user's own words in the plan)`)
}

async function planFromTemplate(deps, [id, ...speakerIds]) {
  const { say, opt, workspace, getProject, readDrafts } = deps
  if (!id) throw new Error('Usage: shred plan <projectId> --template <name> [speaker mediaId...]')
  const ws = workspace()
  const target = readDrafts()[id]?.targetId ?? id
  const { project } = await getProject(id)
  const loaded = loadTemplate(ws, opt.template)
  const { template } = loaded
  if (!project.format?.id)
    throw new Error(
      `${target} has no format. The template suggests ${template.format.id}${template.format.variant ? ` --variant ${template.format.variant}` : ''}: shred format set ${target} ${template.format.id}${template.format.variant ? ` --variant ${template.format.variant}` : ''}`,
    )
  const format = resolveFormat(project.format.id, project.format.variant)
  const fps = project.metadata?.fps ?? format.canvas.fps
  const media = projectMedia(ws, target)
  const request = opt.request ?? DEFAULT_REQUEST(template)
  const timing = scaffoldTiming(format, fps, kitTightCuts(ws, target, project))
  const result = scaffoldFromTemplate(template, {
    format,
    fps,
    media,
    request,
    hash: loaded.hash,
    styles: usableStyles(project),
    speakers: format.planMode === 'performance' ? speakersFor(ws, media, speakerIds) : [],
    pauseSec: timing.pauseSec,
    padFrames: timing.padFrames,
  })
  const dir = agentDir(ws, target)
  const main = path.join(dir, 'plan.json')
  const file = fs.existsSync(main) ? path.join(dir, 'plan.scaffold.json') : main
  writeJson(file, result.plan)
  writeRecord(ws, target, loaded, { via: 'plan' })
  say(
    `Template  ${template.name} → ${file}${file === main ? '' : '  (plan.json exists: not overwritten)'}`,
  )
  if (project.format.id !== template.format.id)
    say(
      `Note: the project is ${format.name}; the template suggests ${template.format.id} (${template.format.reason}). Its slots are mapped onto ${format.name}'s tracks.`,
    )
  say(`Recorded on the project: ${recordFile(ws, target)} (shred check scores against it)`)
  printScaffoldNotes(say, result, template, request)
  say(
    'THIS IS A STARTING POINT, NOT AN EDIT. The reference gives structure and targets, not timings to copy: the new cut follows its own footage and speech. Review every beat or line, replace [PLACEHOLDERS] in the texts, and check every candidate clip.\n',
  )
  if (file === main) {
    await planCommands(deps).plan([id])
    return
  }
  const checked = checkPlan(ws, target, project, file)
  say(
    `${checked.errors.length} error(s), ${checked.warnings.length} warning(s) in ${path.basename(file)}:`,
  )
  for (const issue of [...checked.errors, ...checked.warnings].slice(0, 12))
    say(`  ${issue.where.padEnd(8)} ${issue.message}`)
  say(`Next: merge ${path.basename(file)} into plan.json, then shred plan ${id}.`)
}

// ---------------------------------------------------------------------------
// shred template from-vdb | from-project | list | show | fill
// ---------------------------------------------------------------------------

function fromVdb({ say, opt, workspace }, [file]) {
  if (!file)
    throw new Error(
      'Usage: shred template from-vdb <dna.json|dna.md> [--name slug]  (save get_video_dna format "json" under <project>/agent/reference/ first)',
    )
  const abs = path.resolve(file)
  const dna = readVdb(fs.readFileSync(abs, 'utf8'))
  const template = templateFromVdb(dna, { name: opt.name, file: abs })
  const saved = saveTemplate(workspace(), template)
  say(`${saved.existed ? 'Updated' : 'Saved'} ${saved.file}\n`)
  printTemplate(say, template)
  say(
    `\nNext: shred new --name "..." --format ${template.format.id}${template.format.variant ? ` --variant ${template.format.variant}` : ''} (or --from-template ${template.name}), import the footage, then shred plan <id> --template ${template.name}.`,
  )
}

function planOutline(ws, id) {
  const plan = readJson(path.join(agentDir(ws, id), 'plan.json'))
  if (!plan?.story?.arc) return null
  const beats = (plan.beats ?? []).map((beat) => beat.takeaway).filter(Boolean)
  return { beats, hook: { title: null, verbal: null, template: null }, framework: plan.story.arc }
}

async function fromProject({ say, opt, workspace, getProject }, [id]) {
  if (!id) throw new Error('Usage: shred template from-project <projectId> [--name slug]')
  const ws = workspace()
  const { project } = await getProject(id)
  const mediaById = {}
  for (const item of project.timeline?.items ?? [])
    if (item.mediaId && !mediaById[item.mediaId])
      mediaById[item.mediaId] = mediaMeta(ws, item.mediaId) ?? undefined
  const template = templateFromProject(
    { ...project, id: project.id ?? id },
    { mediaById, name: opt.name, outline: planOutline(ws, id) },
  )
  const saved = saveTemplate(ws, template)
  say(`${saved.existed ? 'Updated' : 'Saved'} ${saved.file}\n`)
  printTemplate(say, template)
  say(
    `\nNext: shred new --from-template ${template.name} --name "..." rebuilds this structure with every clip a slot, then shred template fill <newId> --slot <slot>=<mediaId> ...`,
  )
}

function list({ say, opt, workspace }) {
  const entries = listLibrary(workspace())
  if (opt.json)
    return say(
      JSON.stringify(
        entries.map((e) => e.template),
        null,
        2,
      ),
    )
  if (!entries.length)
    return say(
      `No edit templates in ${libraryDir(workspace())} (shred template from-vdb | from-project)`,
    )
  for (const { template, file } of entries) {
    const shots = template.slots.filter((s) => s.kind === 'shot').length
    say(
      `${template.name.padEnd(28)} ${`${template.format.id}${template.format.variant ? ` ${template.format.variant}` : ''}`.padEnd(20)} ${`${template.durationSec.toFixed(1)} s`.padEnd(8)} ${String(shots).padStart(3)} shots  ${template.source.type === 'vdb' ? `vdb ${template.source.videoId}` : `project ${template.source.projectId}`}  ${template.title ?? ''}`,
    )
    say(`${''.padEnd(28)} ${file}`)
  }
}

function show({ say, opt, workspace }, [name]) {
  const { template, file } = loadTemplate(workspace(), name)
  if (opt.json) return say(JSON.stringify(template, null, 2))
  say(`File      ${file}`)
  printTemplate(say, template)
}

// ---------------------------------------------------------------------------
// shred new --from-template: a project with the template's structure
// ---------------------------------------------------------------------------

const STYLE_FIELDS = [
  'id',
  'name',
  'role',
  'description',
  'defaultDurationFrames',
  'version',
  'updatedAt',
  'variants',
]
const pickFields = (value, keys) =>
  Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]))

/** addTrack ops for the template's tracks the new project lacks; template track id -> id or $ref. */
function trackOps(template, project) {
  const have = project.timeline?.tracks ?? []
  const ops = []
  const ids = new Map()
  for (const track of template.project.tracks) {
    const same = have.find(
      (t) => t.name === track.name && (t.kind ?? 'video') === (track.kind ?? 'video'),
    )
    if (same) {
      ids.set(track.id, same.id)
      continue
    }
    const callerId = `track-${ops.length}`
    ops.push({
      callerId,
      op: 'addTrack',
      kind: track.kind ?? 'video',
      name: track.name,
      ...(track.formatRole ? { formatRole: track.formatRole } : {}),
    })
    ids.set(track.id, { $ref: `${callerId}#/detail/trackId` })
  }
  return { ops, ids }
}

function clipOps(slot, trackIds, ws, fps) {
  const clip = slot.project
  const meta = mediaMeta(ws, clip.mediaId)
  if (!meta)
    throw new Error(
      `${slot.id}: its media ${clip.mediaId} (${clip.fileName}) is not in this workspace`,
    )
  const ref = { $ref: `${slot.id}#/detail/created/0/id` }
  const sourceFps = meta.fps > 0 ? meta.fps : fps
  const speed = clip.speed ?? 1
  const sourceStart = Math.round((clip.sourceStartSec ?? 0) * sourceFps)
  const updates = {
    label: `${slot.id} · ${clip.fileName}`,
    ...(clip.type !== 'image'
      ? {
          sourceStart,
          sourceEnd: sourceStart + Math.round((clip.durationInFrames / fps) * speed * sourceFps),
          ...(speed !== 1 ? { speed } : {}),
        }
      : {}),
    ...pickFields(clip, ['transform', 'volume', 'formatRole']),
  }
  const ops = [
    {
      callerId: slot.id,
      op: 'addClip',
      mediaId: clip.mediaId,
      trackId: trackIds.get(clip.trackId),
      from: clip.from,
      durationInFrames: clip.durationInFrames,
    },
    { op: 'updateItem', id: ref, updates },
  ]
  if (clip.type === 'video' && clip.audio === 'none' && meta.audioCodec)
    ops.push({
      op: 'removeItems',
      ids: [{ $ref: `${slot.id}#/detail/created/1/id` }],
      linked: false,
    })
  return ops
}

function textOps(slot, trackIds) {
  const text = slot.project
  const updates = {
    ...(text.look ?? {}),
    ...pickFields(text, ['transform', 'textMotion', 'formatRole']),
    label: `${slot.id} · text`,
  }
  return [
    {
      callerId: slot.id,
      op: 'addText',
      text: slot.reference || slot.pattern || 'Text',
      from: text.from,
      durationInFrames: text.durationInFrames,
      trackId: trackIds.get(text.trackId),
      ...(text.styleId ? { styleId: text.styleId } : {}),
    },
    { op: 'updateItem', id: { $ref: `${slot.id}#/detail/id` }, updates },
  ]
}

function rebuildOps(template, project, ws) {
  const fps = project.metadata?.fps ?? template.canvas.fps
  const tracks = trackOps(template, project)
  const styles = template.project.textStyles.map((style) => ({
    op: 'upsertTextStyle',
    style: pickFields(style, STYLE_FIELDS),
  }))
  const slots = template.slots.filter((slot) => slot.project)
  const items = slots.flatMap((slot) =>
    slot.kind === 'text' ? textOps(slot, tracks.ids) : clipOps(slot, tracks.ids, ws, fps),
  )
  return [...tracks.ops, ...styles, ...items]
}

/** Slot id -> the item ids the batch created for it (main item first). */
function slotItems(template, res) {
  const byCaller = new Map((res?.results ?? []).map((r) => [r.callerId, r.detail]))
  return Object.fromEntries(
    template.slots
      .filter((slot) => slot.project)
      .map((slot) => {
        const detail = byCaller.get(slot.id)
        const ids = detail?.created ? detail.created.map((c) => c.id) : [detail?.id].filter(Boolean)
        return [
          slot.id,
          {
            kind: slot.kind,
            role: slot.role,
            itemIds: ids,
            placeholder: slot.project.mediaId ?? null,
            targetSec: slot.targetSec,
            filled: slot.kind === 'text' ? null : false,
          },
        ]
      }),
  )
}

async function createProject({ call, key, opt }, template) {
  const format = resolveFormat(template.format.id, template.format.variant)
  const body = {
    name: opt.name,
    width: template.canvas.width,
    height: template.canvas.height,
    fps: template.canvas.fps,
    format: { id: format.id, ...(format.variant ? { variant: format.variant.id } : {}) },
  }
  return {
    created: await call('POST', '/v1/projects', body, { 'Idempotency-Key': key('new-template') }),
    format,
  }
}

export async function newFromTemplate(deps) {
  const { say, opt, workspace, getProject, applyBatch, editorUrl } = deps
  if (!opt.name) throw new Error('--name is required')
  const ws = workspace()
  const loaded = loadTemplate(ws, opt['from-template'])
  const { template } = loaded
  const { created, format } = await createProject(deps, template)
  fs.mkdirSync(path.join(agentDir(ws, created.id), 'passes'), { recursive: true })
  say(created.id)
  say(`${editorUrl}/editor/${created.id}`)
  say(
    `${format.name}${format.variant ? ` ${format.variant.id}` : ''}  ${template.canvas.width}x${template.canvas.height} @${template.canvas.fps}, from template ${template.name}`,
  )
  if (!template.project) {
    writeRecord(ws, created.id, loaded, { via: 'new' })
    say(
      `A VideoDatabase template has no clips to rebuild: import the footage, then shred plan ${created.id} --template ${template.name}. The template is recorded on the project (shred check scores against it).`,
    )
    return
  }
  const { project, revision } = await getProject(created.id)
  const res = await applyBatch(created.id, rebuildOps(template, project, ws), revision)
  const slots = slotItems(template, res)
  writeRecord(ws, created.id, loaded, { via: 'new', slots })
  say(
    `\nRebuilt ${Object.keys(slots).length} slots; every clip still plays its original media as a placeholder:`,
  )
  for (const slot of template.slots.filter((s) => s.project))
    say(
      `  ${slot.id.padEnd(5)} ${slot.kind.padEnd(6)} ${slot.role.padEnd(8)} ${clock(slot.start)}  ${slot.targetSec.toFixed(2).padStart(5)} s  ${slots[slot.id].itemIds[0] ?? '?'}  ${slot.kind === 'text' ? `"${slot.reference}"` : slot.project.fileName}`,
    )
  if (template.captions.mode !== 'off')
    say(
      `Captions are not copied (they come from the speech): after filling the speaker slots, addCaptions on them${template.captions.style ? ` with styleId ${template.captions.style}` : ''}.`,
    )
  say(
    `Next: import the new footage, then shred template fill ${created.id} --slot <slot>=<mediaId>[@inSec] ...; rewrite the text items for the new video.`,
  )
}

// ---------------------------------------------------------------------------
// shred template fill
// ---------------------------------------------------------------------------

/** `--slot s03=<mediaId>[@1.5]` values as `{ slot, mediaId, inSec }`. */
function slotPairs(values) {
  return (values ?? []).map((value) => {
    const match = /^([^=]+)=([^@]+)(?:@([\d.]+))?$/.exec(value)
    if (!match) throw new Error(`--slot is <slotId>=<mediaId>[@inSeconds], got ${value}`)
    return {
      slot: match[1].trim(),
      mediaId: match[2].trim(),
      inSec: match[3] ? Number(match[3]) : null,
    }
  })
}

function fillOp(pair, { record, items, ws, fps }) {
  const entry = record.slots?.[pair.slot]
  const itemId = entry?.itemIds?.[0] ?? (items.has(pair.slot) ? pair.slot : null)
  if (!itemId)
    throw new Error(
      `${pair.slot} is not a slot of this project (slots: ${Object.keys(record.slots ?? {}).join(', ')})`,
    )
  const item = items.get(itemId)
  if (!item) throw new Error(`${pair.slot}: its item ${itemId} is no longer on the timeline`)
  const meta = mediaMeta(ws, pair.mediaId)
  if (!meta)
    throw new Error(`media ${pair.mediaId} is not in the workspace (shred import it first)`)
  const sourceFps = meta.fps > 0 ? meta.fps : fps
  const needSec = (item.durationInFrames / fps) * (item.speed ?? 1)
  const fromSec = pair.inSec ?? 0
  if (item.type !== 'image' && fromSec + needSec > Number(meta.duration ?? 0) + 0.5 / sourceFps)
    throw new Error(
      `${pair.slot}: ${meta.fileName} is ${Number(meta.duration ?? 0).toFixed(2)} s; the slot needs ${needSec.toFixed(2)} s from ${fromSec.toFixed(2)} s. Pick a longer clip or an earlier in-point`,
    )
  return {
    op: 'replaceMedia',
    id: itemId,
    mediaId: pair.mediaId,
    ...(item.type !== 'image' && pair.inSec !== null
      ? { sourceStart: Math.round(fromSec * sourceFps) }
      : {}),
    label: `${pair.slot} · ${meta.fileName}`,
  }
}

async function fill({ say, opt, workspace, getProject, applyBatch, readDrafts }, [id]) {
  const pairs = slotPairs(opt.slot)
  if (!id || !pairs.length)
    throw new Error(
      'Usage: shred template fill <projectId> --slot <slotId>=<mediaId>[@inSeconds] ...',
    )
  const ws = workspace()
  const target = readDrafts()[id]?.targetId ?? id
  const record = readJson(recordFile(ws, target))
  if (!record?.slots)
    throw new Error(
      `${target} was not made from a project template (shred new --from-template <name>): it has no slots to fill`,
    )
  const { project, revision } = await getProject(id)
  const fps = project.metadata?.fps ?? 30
  const items = new Map((project.timeline?.items ?? []).map((item) => [item.id, item]))
  const ops = pairs.map((pair) => fillOp(pair, { record, items, ws, fps }))
  await applyBatch(id, ops, revision)
  for (const pair of pairs)
    if (record.slots[pair.slot]) record.slots[pair.slot].filled = pair.mediaId
  writeJson(recordFile(ws, target), record)
  for (const [i, pair] of pairs.entries())
    say(`  ${pair.slot.padEnd(5)} ${ops[i].id}  -> ${ops[i].label}`)
  const open = Object.entries(record.slots)
    .filter(([, s]) => s.filled === false)
    .map(([slot]) => slot)
  say(
    open.length
      ? `Still placeholders (${open.length}): ${open.join(', ')}`
      : 'Every clip slot is filled. Rewrite the texts, then shred check.',
  )
}

/** `shred template <sub> ...` */
export async function templateCommand(deps, [sub, ...rest]) {
  const run = { 'from-vdb': fromVdb, 'from-project': fromProject, list, show, fill }[sub]
  if (!run)
    throw new Error('Usage: shred template from-vdb|from-project|list|show|fill (see shred help)')
  await run(deps, rest)
}

export async function templatePlan(deps, rest) {
  await planFromTemplate(deps, rest)
}

// ---------------------------------------------------------------------------
// shred check: the Template section
// ---------------------------------------------------------------------------

/** The Template section of `shred check` for `id` (a draft reads its project's record); null without one. */
export function templateCheck({ workspace, readDrafts }, id, project, mediaById) {
  if (!project.format?.id) return null
  const target = readDrafts()[id]?.targetId ?? id
  const record = readJson(recordFile(workspace(), target))
  if (!record?.template || templateProblems(record.template).length) return null
  return {
    file: recordFile(workspace(), target),
    ...scoreTemplate(project, record.template, { mediaById }),
  }
}

export function printTemplateCheck(say, report, fps) {
  if (!report) return
  const s = report.summary
  say(
    `\nTemplate  ${report.template}  (${report.source.type === 'vdb' ? `VideoDatabase ${report.source.videoId}` : `project ${report.source.projectId}`})  ${s.close} close, ${s.differs} differ  (for reference, not rules)`,
  )
  const sec = (frame) => (frame / fps).toFixed(2)
  for (const c of report.checks) {
    const value = typeof c.value === 'boolean' ? (c.value ? 'yes' : 'no') : String(c.value ?? '-')
    say(
      `  ${TAG[c.status].padEnd(7)}  ${c.label.padEnd(42)} ${value.padStart(6)}  reference ${c.target}${c.detail ? `  (${c.detail})` : ''}`,
    )
    if (c.ranges.length)
      say(
        `        frames ${c.ranges.map((r) => `${r.startFrame}-${r.endFrame} [${sec(r.startFrame)}-${sec(r.endFrame)} s]`).join(', ')}`,
      )
  }
  say(
    "  The reference's timings are guidance (AI-labeled, not frame-accurate), not rules: a difference is not a problem to fix. The new cut follows its own speech.",
  )
}
