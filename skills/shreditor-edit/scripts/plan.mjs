// `shred plan` and `shred build`: the first edit of every project comes from a
// plan. The agent writes agent/plan.json (story first: the user's request, the
// arc, then beats with a why; for a speaker format the performance: the lines
// kept or cut with visuals per line, ./performance.mjs), `shred plan` validates
// it and records its hash,
// `shred draft` refuses a project's first pass until that hash validated clean,
// and `shred build` turns the plan into the first assembly in one atomic batch
// (`--markers-only`: just the beat markers, so the user sees the structure
// first). `shred check` compares the edit with the plan. The model lives in
// formats/plan/.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveFormat } from '../../../formats/registry.mjs'
import { readPlan } from '../../../formats/plan/schema.mjs'
import { validatePlan } from '../../../formats/plan/validate.mjs'
import { planEstimates } from '../../../formats/plan/estimate.mjs'
import { buildPlanOps } from '../../../formats/plan/build.mjs'
import { comparePlan } from '../../../formats/plan/compare.mjs'
import { validatePerformance } from '../../../formats/plan/performance/validate.mjs'
import { performanceEstimates } from '../../../formats/plan/performance/estimate.mjs'
import { buildPerformanceOps } from '../../../formats/plan/performance/build.mjs'
import { comparePerformance } from '../../../formats/plan/performance/compare.mjs'
import {
  printPerformancePlaced,
  printPerformanceSheet,
  scaffoldCommand,
  wordsReader,
} from './performance.mjs'
import { readStoredTranscript, transcriptForFile } from '../../../server/transcription.mjs'
import { effectiveActivity, readActivity } from '../../../server/agent-activity.mjs'

const TAG = { pass: 'pass', warn: 'WARN', fail: 'WARN', info: 'info' }
const NEXT_FIRST =
  'Catalog the footage (shred catalog), write the brief, then the plan, story first (references/brief-and-plan.md), then: shred plan'

const hashOf = (text) => `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const clock = (frames, fps) => {
  const s = frames / fps
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`
}
const span = (start, end, fps) => `${clock(start, fps)}-${clock(end, fps)}`

/** A project's agent files: the plan, its validation state, the brief and the passes. */
function agentFiles(ws, projectId) {
  const dir = path.join(ws, 'projects', projectId, 'agent')
  return {
    dir,
    plan: path.join(dir, 'plan.json'),
    state: path.join(dir, 'plan.state.json'),
    brief: path.join(dir, 'brief.yaml'),
    passes: path.join(dir, 'passes'),
  }
}

/** The two brief fields the plan uses (brief.yaml is flat enough to read without a parser). */
function readBrief(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const target = /^duration_target_seconds:\s*([\d.]+)/m.exec(text)?.[1]
  const review = /^review:\s*(?:\{[^}]*\bplan:\s*(true)|\n\s+plan:\s*(true))/m.exec(text)
  return { durationTargetSec: target ? Number(target) : null, reviewPlan: Boolean(review) }
}

const passCount = (files) =>
  fs.existsSync(files.passes)
    ? fs.readdirSync(files.passes).filter((f) => f.endsWith('.json')).length
    : 0

const expand = (file) => path.resolve(file.replace(/^~(?=\/|$)/, os.homedir()))

function catalogEntries(ws) {
  const dir = path.join(ws, 'catalogs')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .flatMap((name) => readJson(path.join(dir, name, 'catalog.json'))?.entries ?? [])
    .filter((entry) => entry.file && !entry.error)
}

/** Media facts from an imported media's metadata.json. */
function importedMedia(ws, mediaId, projectFps) {
  const meta = readJson(path.join(ws, 'media', mediaId, 'metadata.json'))
  if (!meta) return null
  const mime = meta.mimeType ?? ''
  return {
    mediaId,
    fileName: meta.fileName ?? mediaId,
    kind: mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'video',
    duration: Number(meta.duration ?? 0),
    sourceFps: meta.fps > 0 ? meta.fps : projectFps,
    audioCodec: meta.audioCodec ?? null,
    category: meta.category ?? null,
    ...(meta.width > 0 && meta.height > 0 ? { width: meta.width, height: meta.height } : {}),
  }
}

const catalogMedia = (entry, projectFps) => ({
  mediaId: null,
  fileName: path.basename(entry.file),
  kind: entry.kind,
  duration: Number(entry.duration ?? 0),
  sourceFps: entry.fps > 0 ? entry.fps : projectFps,
  audioCodec: entry.audio ?? null,
  category: entry.category ?? null,
})

/** Resolves a beat's source: an imported media id, or an asset imported or in a catalog. */
function mediaResolver(ws, projectFps) {
  let catalog = null
  return (source) => {
    if (source.mediaId)
      return (
        importedMedia(ws, source.mediaId, projectFps) ?? {
          error: `media ${source.mediaId} is not in the workspace (shred media --project <id> lists it)`,
        }
      )
    const file = expand(source.asset)
    const imported = transcriptForFile(ws, file)?.mediaId
    if (imported) return importedMedia(ws, imported, projectFps)
    catalog ??= catalogEntries(ws)
    const byName = catalog.filter((e) => path.basename(e.file) === path.basename(file))
    const entry = catalog.find((e) => e.file === file) ?? (byName.length === 1 ? byName[0] : null)
    if (!entry) return { error: `${source.asset} is not imported or in a catalog (shred catalog)` }
    return entry.mediaId
      ? (importedMedia(ws, entry.mediaId, projectFps) ?? catalogMedia(entry, projectFps))
      : catalogMedia(entry, projectFps)
  }
}

const formatOf = (project) => {
  if (!project.format?.id)
    throw new Error('The project has no format: choose one first (shred format set <id> <format>)')
  return resolveFormat(project.format.id, project.format.variant)
}

/** Validate a read plan of either mode against the format, media and transcripts. */
function validateRead(ws, plan, { format, fps, brief }) {
  if (!plan || (plan.mode === 'performance' && !plan.performance))
    return { errors: [], warnings: [] }
  const options = {
    format,
    resolveMedia: mediaResolver(ws, fps),
    briefTargetSec: brief.durationTargetSec,
  }
  return plan.mode === 'performance'
    ? validatePerformance(plan, { ...options, wordsFor: wordsReader(ws) })
    : validatePlan(plan, options)
}

/**
 * Read and validate a project's plan. `projectId` owns the agent files (a
 * draft's target); `project` gives the format and fps. Returns everything the
 * commands print, or `{ missing }` when there is no plan file.
 */
function checkPlan(ws, projectId, project, file) {
  const files = agentFiles(ws, projectId)
  const planFile = path.resolve(file ?? readJson(files.state)?.file ?? files.plan)
  if (!fs.existsSync(planFile)) return { missing: planFile, files }
  const text = fs.readFileSync(planFile, 'utf8')
  const format = formatOf(project)
  const fps = project.metadata?.fps ?? format.canvas.fps
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return {
      files,
      planFile,
      hash: hashOf(text),
      plan: null,
      beats: [],
      errors: [{ where: 'plan', message: `not JSON: ${error.message}` }],
      warnings: [],
      format,
    }
  }
  const read = readPlan(raw, { projectFps: fps, defaultMode: format.planMode })
  const brief = readBrief(files.brief)
  const checked = validateRead(ws, read.plan, { format, fps, brief })
  return {
    files,
    planFile,
    hash: hashOf(text),
    plan: read.plan,
    beats: checked.beats ?? [],
    lines: checked.lines ?? [],
    layout: checked.layout ?? null,
    errors: [...read.errors, ...checked.errors],
    warnings: [...read.warnings, ...checked.warnings],
    format,
    brief,
  }
}

function transcriptsFor(ws, beats) {
  const ids = new Set(beats.map((beat) => beat.media?.mediaId).filter(Boolean))
  return Object.fromEntries(
    [...ids].map((id) => [id, readStoredTranscript(ws, id)]).filter(([, t]) => t),
  )
}

function printBeat(say, beat, fps) {
  const clip = beat.media
    ? `${beat.media.fileName}${beat.media.kind === 'image' ? '' : ` @ ${beat.source.inSec.toFixed(2)} s`}`
    : (beat.source.mediaId ?? beat.source.asset)
  say(
    `${beat.id.padEnd(5)} ${span(beat.start, beat.end, fps)}  ${`[${beat.start}-${beat.end}]`.padEnd(11)} ${(beat.role ?? '-').padEnd(6)} ${(beat.trackRole ?? '?').padEnd(8)} ${clip}`,
  )
  if (beat.takeaway) say(`      takeaway  ${beat.takeaway}`)
  if (beat.why) say(`      why       ${beat.why}`)
  if (beat.text)
    say(
      `      text      ${beat.text.role} "${beat.text.text}" ${span(beat.text.start, beat.text.end, fps)}`,
    )
}

function printIssues(say, title, list) {
  if (!list.length) return
  say(`\n${title} (${list.length})`)
  for (const issue of list) say(`  ${issue.where.padEnd(8)} ${issue.message}`)
}

function printEstimates(say, checks) {
  if (!checks.length) return
  say("\nEstimated from the plan (the format's guidelines, not quotas)")
  for (const c of checks) {
    const value = typeof c.value === 'boolean' ? (c.value ? 'yes' : 'no') : String(c.value ?? '-')
    say(
      `  ${TAG[c.status].padEnd(4)}  ${c.label.padEnd(42)} ${value.padStart(6)}  target ${c.target}${c.detail ? `  (${c.detail})` : ''}`,
    )
  }
}

function printSheet(say, result, projectFps) {
  const { plan, format } = result
  say(`Plan  ${result.planFile}  (${result.hash.slice(0, 19)}…)`)
  if (!plan) return
  if (plan.mode === 'performance') {
    printPerformanceSheet(say, result)
    return
  }
  const fps = plan.fps || projectFps
  say(
    `v${plan.version}, ${fps} fps, ${plan.durationFrames} frames (${(plan.durationFrames / fps).toFixed(2)} s), ${plan.beats.length} beats, ${format.name}`,
  )
  if (plan.request) say(`Ask    ${plan.request}`)
  if (plan.story.arc) say(`Arc    ${plan.story.arc}`)
  const roles = plan.story.structure.length
    ? plan.story.structure
    : format.structure.map((p) => p.role)
  say(
    `Story  ${roles.join(' → ')}   (${format.name}: ${format.structure.map((p) => `${p.name}${p.required ? '' : '?'}`).join(' → ')})\n`,
  )
  for (const beat of [...result.beats].sort((a, b) => a.start - b.start)) printBeat(say, beat, fps)
}

function estimatesFor(ws, result) {
  const performance = result.plan.mode === 'performance'
  const transcripts = transcriptsFor(ws, performance ? result.lines : result.beats)
  return performance
    ? performanceEstimates(result.plan, result.layout, result.format, { transcripts })
    : planEstimates(result.plan, result.beats, result.format, { transcripts })
}

function writeState(result) {
  const state = {
    file: result.planFile,
    hash: result.hash,
    validatedAt: new Date().toISOString(),
    schemaVersion: result.plan?.version ?? null,
    errors: result.errors.length,
    warnings: result.warnings.length,
  }
  fs.mkdirSync(path.dirname(result.files.state), { recursive: true })
  fs.writeFileSync(result.files.state, `${JSON.stringify(state, null, 2)}\n`)
}

/** Why the project's first draft may (or may not) be taken. Throws a refusal. */
function firstPassGate(ws, id, project, noPlan) {
  if (noPlan) {
    if (!(project.timeline?.items ?? []).length)
      throw new Error(
        `--no-plan is only for a timeline the user built by hand, and ${id}'s is empty. ${NEXT_FIRST} ${id}`,
      )
    return {
      mode: 'no-plan',
      note: 'first pass without a plan (--no-plan): the user built the timeline by hand',
    }
  }
  const files = agentFiles(ws, id)
  const state = readJson(files.state)
  const planFile = state?.file ?? files.plan
  if (!fs.existsSync(planFile))
    throw new Error(
      `The first edit of a project is built from a plan, and ${id} has none yet. ${NEXT_FIRST} ${id}`,
    )
  const hash = hashOf(fs.readFileSync(planFile, 'utf8'))
  if (!state || state.hash !== hash)
    throw new Error(
      `${planFile} changed since it was last validated (or never was). Run: shred plan ${id}`,
    )
  if (state.errors)
    throw new Error(
      `The plan had ${state.errors} error(s) when last validated. Fix them, then: shred plan ${id}`,
    )
  return { mode: 'plan', file: planFile, hash }
}

/**
 * `shred draft`'s plan gate, run before anything is created: a project with no
 * published pass needs a plan that validated clean at its current hash (or
 * `--no-plan` on a timeline the user built by hand). Returns the record the
 * draft (and later its pass) keeps.
 */
export function draftPlanGate({ say, opt, workspace }, id, project) {
  const files = agentFiles(workspace(), id)
  if (passCount(files) > 0) {
    say(
      'Reminder: a restructure (new order, new beats) starts by updating the plan: edit plan.json, shred plan, then build on the draft by hand or with shred build --replace.',
    )
    return { mode: 'later' }
  }
  const gate = firstPassGate(workspace(), id, project, opt['no-plan'])
  if (gate.mode === 'no-plan') say(`Note: ${gate.note}; it is logged with the pass.`)
  return gate
}

function refuseMarkersOnlyMidPass(ws, id) {
  const record = effectiveActivity(readActivity(ws, id))
  if (record.state === 'working')
    throw new Error(
      `A pass is in progress on ${id}: markers-only goes on the project before its first draft (shred done ${id} ends the pass).`,
    )
}

function printPlaced(say, placed, fps) {
  for (const { beat, track, trackAdded, syncSound, text } of placed) {
    const clip = track
      ? `  ${track}${trackAdded ? ' (new track)' : ''}  ${beat.media.fileName}${beat.media.kind === 'image' ? '' : ` from ${beat.source.inSec.toFixed(2)} s`}${syncSound ? `  (sync sound ${syncSound})` : ''}`
      : ''
    say(`  ${beat.id.padEnd(5)} ${span(beat.start, beat.end, fps)}  marker "${beat.role}"${clip}`)
    if (text)
      say(
        `        text ${text.role} "${text.text}" ${span(text.start, text.end, fps)} on ${text.track}${text.style ? ` (style ${text.style})` : ' (no project style: plain)'}`,
      )
  }
}

/** What a plan uses that isn't imported yet, as `<id> <file>`. */
function unimported(result) {
  if (result.plan.mode !== 'performance')
    return result.beats
      .filter((beat) => !beat.media?.mediaId)
      .map((beat) => `${beat.id} ${beat.media?.fileName ?? beat.source.asset}`)
  return result.layout.visuals
    .filter((visual) => visual.media && !visual.media.mediaId)
    .map((visual) => `${visual.id} ${visual.media.fileName}`)
}

/** The build batch for a plan of either mode: `{ ops, starts, print(say) }`. */
function assemble(result, options) {
  const { plan } = result
  if (plan.mode === 'performance') {
    const { ops, placed } = buildPerformanceOps(plan, result.layout, result.lines, options)
    return {
      ops,
      starts: [...result.layout.spans.values()].map((span) => span.start),
      print: (say) => printPerformancePlaced(say, placed, result.layout, plan.fps),
    }
  }
  const { ops, placed } = buildPlanOps(plan, result.beats, options)
  return {
    ops,
    starts: placed.map((p) => p.beat.start),
    print: (say) => printPlaced(say, placed, plan.fps),
  }
}

export function planCommands({
  say,
  opt,
  workspace,
  getProject,
  applyBatch,
  readDrafts,
  writeDrafts,
  warnUnsaved,
}) {
  return {
    async plan([id, ...mediaIds]) {
      if (!id)
        throw new Error(
          'Usage: shred plan <projectId> [--file plan.json] | shred plan <projectId> --scaffold <speaker mediaId...>',
        )
      const target = readDrafts()[id]?.targetId ?? id
      const { project } = await getProject(id)
      if (opt.scaffold) {
        scaffoldCommand(
          { say, workspace },
          {
            id,
            target,
            project,
            format: formatOf(project),
            mediaIds,
            check: (file) => checkPlan(workspace(), target, project, file),
          },
        )
        return
      }
      const result = checkPlan(workspace(), target, project, opt.file)
      if (result.missing)
        throw new Error(
          `No plan at ${result.missing}. Write it first (references/brief-and-plan.md).`,
        )
      const fps = project.metadata?.fps ?? 30
      printSheet(say, result, fps)
      if (result.plan && !result.errors.length)
        printEstimates(say, estimatesFor(workspace(), result))
      printIssues(say, 'Errors', result.errors)
      printIssues(say, 'Warnings', result.warnings)
      writeState(result)
      if (result.errors.length) {
        say(
          `\n${result.errors.length} error(s): fix the plan and run shred plan ${target} again (shred draft refuses until it validates).`,
        )
        process.exitCode = 1
        return
      }
      say(`\nValid. ${result.hash.slice(0, 19)}… recorded in ${result.files.state}.`)
      say(
        result.brief.reviewPlan
          ? `The brief asks to review the plan: shred build ${target} --markers-only, show the user the beats in the editor, and wait for their OK.`
          : `Next: shred draft ${target} --label "...", then shred build <draftId>.`,
      )
    },

    async build([id]) {
      if (!id)
        throw new Error(
          'Usage: shred build <draftId> [--plan file] [--replace] | shred build <projectId> --markers-only',
        )
      const origin = readDrafts()[id]
      const markersOnly = Boolean(opt['markers-only'])
      if (!origin && !markersOnly)
        throw new Error(
          `${id} is not a draft. Build on a draft (shred draft <projectId>), or put only the beat markers on a project with --markers-only.`,
        )
      if (!origin) {
        refuseMarkersOnlyMidPass(workspace(), id)
        const unsaved = await warnUnsaved(id)
        if (unsaved) throw new Error(`Run shred sync ${id} first: the editor holds unsaved edits.`)
      }
      const target = origin?.targetId ?? id
      const { project, revision } = await getProject(id)
      const result = checkPlan(workspace(), target, project, opt.plan)
      if (result.missing) throw new Error(`No plan at ${result.missing}. ${NEXT_FIRST} ${target}`)
      if (result.errors.length) {
        printIssues(say, 'Errors', result.errors)
        throw new Error(`The plan has ${result.errors.length} error(s): shred plan ${target}`)
      }
      const notImported = unimported(result)
      if (notImported.length && !markersOnly)
        throw new Error(
          `Import first (shred import ... --project ${target}): ${notImported.join(', ')}`,
        )
      const built = assemble(result, {
        project,
        format: result.format,
        replace: Boolean(opt.replace),
        markersOnly,
      })
      await applyBatch(id, built.ops, revision)
      say(
        markersOnly
          ? `Plan markers on ${id} (no clips), from ${result.planFile}:`
          : `Built ${id} from ${result.planFile} (${result.hash.slice(0, 19)}…):`,
      )
      built.print(say)
      if (origin) {
        const drafts = readDrafts()
        drafts[id] = {
          ...drafts[id],
          plan: {
            ...(drafts[id].plan ?? {}),
            builtFrom: result.hash,
            builtAt: new Date().toISOString(),
          },
        }
        writeDrafts(drafts)
      }
      say(
        markersOnly
          ? 'The editor shows them on the ruler. Walk the user through the plan and wait for their OK before shred draft.'
          : `Next: shred frames ${id} --at ${built.starts.map((frame) => frame + 1).join(',')} (open it: order matches the plan?), refine, then shred check ${id}.`,
      )
    },
  }
}

/**
 * `shred check`'s Plan section: the timeline of `id` against its project's plan.
 * null when there is no plan. Never fails the check.
 */
export function planCheck({ workspace, readDrafts }, id, project) {
  const target = readDrafts()[id]?.targetId ?? id
  const result = checkPlan(workspace(), target, project)
  if (result.missing || !result.plan) return null
  const state = readJson(result.files.state)
  const performance = result.plan.mode === 'performance'
  if (performance && !result.layout) return null
  const compared = performance
    ? comparePerformance(result.plan, result.lines, result.layout, project.timeline)
    : comparePlan(
        result.plan,
        result.beats.filter((b) => b.media),
        project.timeline,
      )
  return {
    mode: result.plan.mode,
    file: result.planFile,
    hash: result.hash,
    validated: state?.hash === result.hash && !state.errors,
    planErrors: result.errors.length,
    ...compared,
  }
}

export function printPlanCheck(say, report) {
  if (!report) return
  say(
    `\nPlan  ${report.file}${report.validated ? '' : '  (changed since shred plan validated it)'}`,
  )
  if (!report.findings.length)
    say(
      report.mode === 'performance'
        ? `  pass  every kept line is on the timeline, in order, no cut line is back in, at the planned length (${report.checked} lines checked)`
        : `  pass  all ${report.checked} beats are where the plan puts them, in order, at the planned length`,
    )
  for (const f of report.findings) {
    say(`  ${TAG[f.level].padEnd(4)}  ${f.message}`)
  }
  if (report.skipped)
    say(
      `  info  ${report.skipped} ${report.mode === 'performance' ? 'line' : 'beat'}(s) not checked (media not imported)`,
    )
  if (report.findings.length)
    say(
      "  The user's tweaks are decisions: plan drift is reported, never failed. When the story itself changed, update plan.json and run shred plan.",
    )
}
