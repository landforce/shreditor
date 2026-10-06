// `shred plan` and `shred build` for performance plans (Graphic Yap and
// Greenscreen: the plan is the speaker's performance, line by line): the
// scaffold from the speakers' transcripts (`shred plan <id> --scaffold
// <mediaId...>`), the plan printed as a script, and the build printout. The
// model lives in formats/plan/performance/.
import fs from 'node:fs'
import path from 'node:path'
import { scaffoldPerformance } from '../../../formats/plan/performance/scaffold.mjs'
import { performanceScript, toSourceList } from '../../../formats/plan/performance/script.mjs'
import { transcriptWords } from '../../../formats/scorecard.mjs'
import { readStoredTranscript, readTranscriptionStatus } from '../../../server/transcription.mjs'
import { readKitFile } from '../../../formats/kit/node.mjs'

const clock = (frames, fps) => {
  const s = frames / fps
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`
}
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Transcript words of a media (source seconds), or null when it has none. */
export function wordsReader(ws) {
  return (mediaId) => {
    try {
      const stored = readStoredTranscript(ws, mediaId)
      return stored ? transcriptWords(stored) : null
    } catch {
      return null
    }
  }
}

/** The plan as a script: header, every line, the to-source list. */
export function printPerformanceSheet(say, result) {
  const { plan, format, lines, layout } = result
  const fps = plan.fps
  const kept = lines.filter((line) => line.keep).length
  const cut = layout
    ? `cut ${(layout.durationFrames / fps).toFixed(2)} s (${layout.durationFrames} frames)`
    : 'no cut'
  say(
    `v${plan.version} performance, ${fps} fps, ${lines.length} lines (${kept} kept, ${lines.length - kept} cut), ${cut}, pad ${plan.performance?.padFrames ?? 0} frames, ${format.name}`,
  )
  if (plan.request) say(`Ask    ${plan.request}`)
  if (plan.story.arc) say(`Arc    ${plan.story.arc}`)
  const roles = plan.story.structure.length
    ? plan.story.structure
    : format.structure.map((p) => p.role)
  say(
    `Story  ${roles.join(' → ')}   (${format.name}: ${format.structure.map((p) => `${p.name}${p.required ? '' : '?'}`).join(' → ')})\n`,
  )
  if (!layout) return
  for (const line of performanceScript(plan, lines, layout)) say(line)
  const toSource = toSourceList(lines, layout, fps)
  say(
    `\nTo source (${toSource.length})${toSource.length ? '' : ': nothing, every visual has its media'}`,
  )
  for (const line of toSource) say(`  ${line}`)
}

/** What `shred build` placed for a performance plan. */
export function printPerformancePlaced(say, placed, layout, fps) {
  for (const { run, track, trackAdded, syncSound } of placed.runs)
    say(
      `  ${run.id.padEnd(6)} ${clock(run.start, fps)}-${clock(run.end, fps)}  ${track}${trackAdded ? ' (new track)' : ''}  ${run.media.fileName} ${run.inSec.toFixed(2)}-${run.outSec.toFixed(2)} s  lines ${run.lines.join(', ')}${syncSound ? `  (sync sound ${syncSound})` : ''}`,
    )
  for (const { visual, track, trackAdded } of placed.visuals)
    say(
      `  ${visual.id.padEnd(6)} ${clock(visual.start, fps)}-${clock(visual.end, fps)}  ${track}${trackAdded ? ' (new track)' : ''}  ${visual.media.fileName}`,
    )
  for (const text of placed.texts)
    say(
      `  text   ${clock(text.start, fps)}-${clock(text.end, fps)}  ${text.role} "${text.text}" on ${text.track}${text.style ? ` (style ${text.style})` : ' (no project style: plain)'}`,
    )
  say(`  markers: one per kept line (${layout.spans.size})`)
  if (!placed.toSource.length) return
  say(`\nTo source: ${placed.toSource.length} placeholder marker(s), red, on the ruler`)
  for (const visual of placed.toSource)
    say(
      `  ${visual.id.padEnd(8)} ${clock(visual.start, fps)}  ${visual.trackRole}  ${visual.toSource}`,
    )
}

/** The kit's tight-cut preference, if the project has a kit that turns it on. */
function kitTightCuts(ws, id, project) {
  if (!project.kit) return null
  let kit = null
  try {
    kit = readKitFile(project.kit.path).kit
  } catch {
    kit = readJson(path.join(ws, 'projects', id, 'agent', 'kit-applied.json'))
  }
  const cuts = kit?.preferences?.tightCuts
  return cuts && cuts.on !== false ? cuts : null
}

/**
 * Where the scaffold cuts silence and how much it pads each cut: the kit's
 * tightCuts when on (maxPauseMs, paddingFrames), else the format's longest
 * pause and a pad of a tenth of it (1 to 3 frames).
 */
export function scaffoldTiming(format, fps, cuts) {
  const pauseTarget = format.targets.find((target) => target.key === 'pauseMaxSec')?.max ?? 1
  const fallbackPad = Math.min(3, Math.max(1, Math.round((pauseTarget * fps) / 10)))
  if (!cuts)
    return { pauseSec: pauseTarget, padFrames: fallbackPad, from: `${format.name}'s pause target` }
  return {
    pauseSec: typeof cuts.maxPauseMs === 'number' ? cuts.maxPauseMs / 1000 : pauseTarget,
    padFrames: Number.isInteger(cuts.paddingFrames) ? cuts.paddingFrames : fallbackPad,
    from: "the Video Style Kit's tightCuts",
  }
}

function speakerFor(ws, mediaId) {
  const meta = readJson(path.join(ws, 'media', mediaId, 'metadata.json'))
  if (!meta)
    throw new Error(`media ${mediaId} is not in the workspace (shred media --project <id>)`)
  const stored = (() => {
    try {
      return readStoredTranscript(ws, mediaId)
    } catch {
      return null
    }
  })()
  const words = stored ? transcriptWords(stored) : []
  if (!words.length) {
    const status = readTranscriptionStatus(ws, mediaId)
    throw new Error(
      `${meta.fileName} has no transcript words${status ? ` (transcription ${status.status ?? status}${status.reason ? `: ${status.reason}` : ''})` : ''}: wait for it (shred transcript ${mediaId}) or run shred transcribe ${mediaId}`,
    )
  }
  return { mediaId, fileName: meta.fileName, duration: Number(meta.duration ?? 0), words }
}

/**
 * `shred plan <id> --scaffold <mediaId...>`: a draft performance plan from
 * the speakers' transcripts, written to agent/plan.json when there is none
 * (else agent/plan.scaffold.json), printed as a script. `check(file)` reads
 * and validates a plan file like `shred plan` (plan.mjs).
 */
export function scaffoldCommand(
  { say, workspace },
  { id, target, project, format, mediaIds, check },
) {
  if (!mediaIds.length)
    throw new Error(
      'Usage: shred plan <projectId> --scaffold <speaker mediaId...> (in the order they play)',
    )
  const ws = workspace()
  const fps = project.metadata?.fps ?? format.canvas.fps
  const timing = scaffoldTiming(format, fps, kitTightCuts(ws, target, project))
  const speakers = mediaIds.map((mediaId) => speakerFor(ws, mediaId))
  const { plan, counts } = scaffoldPerformance(speakers, { format, fps, ...timing })
  const dir = path.join(ws, 'projects', target, 'agent')
  fs.mkdirSync(dir, { recursive: true })
  const main = path.join(dir, 'plan.json')
  const file = fs.existsSync(main) ? path.join(dir, 'plan.scaffold.json') : main
  fs.writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`)
  say(`Scaffold  ${file}${file === main ? '' : '  (plan.json exists: not overwritten)'}`)
  say(
    `From ${speakers.map((s) => s.fileName).join(', ')}: ${counts.lines} lines, ${counts.kept} kept; cut ${counts.retakes} retake(s), ${counts.falseStarts} false start(s), ${counts.pauses} pause(s). Silences of ${timing.pauseSec} s or more split lines and are cut; pad ${timing.padFrames} frames (from ${timing.from}).\n`,
  )
  say(
    'THIS IS A STARTING POINT, NOT AN EDIT. It splits on sentence ends and pauses and guesses the obvious cuts (a repeated sentence: the earlier take is cut; filler-only fragments and restarts: false starts). Review every line: keep or cut it and say why, choose between takes, fix the roles, attach visuals per line (an asset from the catalog, or toSource with a clear description), then write request and story.arc.\n',
  )
  const result = check(file)
  if (result.plan) printPerformanceSheet(say, { ...result, format })
  say(
    `\nNext: edit ${path.basename(file)}${file === main ? '' : ' into plan.json'}, then shred plan ${id} (it validates the plan and prints this script again).`,
  )
}
