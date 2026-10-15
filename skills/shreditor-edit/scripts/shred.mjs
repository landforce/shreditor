#!/usr/bin/env node
// The one way an agent touches a Shreditor project. Every engine call in the
// shreditor-edit skill goes through here, so edits are consistent and checked.
//
//   shred up [--dev] [--build]           start the editor (5273, a built preview; --dev for live reload)
//                                        and the agent service (8787)
//   shred start                          start only the agent edit service
//   shred status                         editor, service, workspace, writer-lock state and passes in progress
//   shred catalog <folder|file...> --name <slug> [--no-transcribe]
//                                        probe, contact-sheet and transcribe (import makes working copies)
//                                        (reuses the built-in transcript of footage already imported)
//   shred transcript <mediaId> [--json]  the built-in transcript: words with start/end seconds
//   shred transcribe <mediaId...> | --project <id> [--force]   transcribe now (imports do it on their own)
//   shred setup [--yes]                  check ffmpeg, whisper-cli and the model; --yes downloads the model
//   shred format list                    the four formats, with when each fits
//   shred format <formatId|projectId> [--variant v]
//                                        a format's (or a project's) rules, targets, checklist and guide
//   shred format set <projectId> <formatId> [--variant v]   record the format (an empty project also
//                                        gets its canvas and track layout)
//   shred new --name "..." --format <id> [--variant v]   create a project in a format: its canvas and
//                                        named tracks (with roles); prints id, editor URL and tracks
//   shred new --name "..." [--size 1080x1920] [--fps 30]   create a project without a format
//   shred project <id>                   timeline summary (tracks, items, frames)
//   shred import <file...> --project <id> [--category <c>] [--no-wait]
//                                        bring footage in (clone/link in place); video Chrome can't
//                                        decode gets a playable working copy, and import waits for it
//   shred media <mediaId...> | --project <id> [--wait] [--retry] [--json]
//                                        working-copy state (ready/preparing NN%/failed), category with
//                                        who set it ([speaker auto] = the editor's unconfirmed suggestion)
//                                        and transcript state
//   shred qc <mediaId...> | --project <id> [--json]
//                                        measure each clip's sound (noise in pauses, rumble, pops, hiss,
//                                        clipping) and picture (exposure, contrast, colour cast) from the
//                                        original, with hints; whether a clip gets a fix is your call
//   shred effects [--category color] [<effectId>]
//                                        the GPU effects with their params, ranges and defaults
//   shred lut add <file.cube...> [--name x.cube] [--force]
//                                        copy 3D .cube LUTs into <workspace>/luts/, the LUT library the
//                                        editor's LUT panel and the addLut op share (1D LUTs are refused)
//   shred lut list [--json]              the library: file name, LUT_3D_SIZE and TITLE
//   shred grade list [--json]            the user's saved grade presets: name, id and their effects
//   shred grade apply <id> <itemId...> --preset <name|id>
//                                        give clips a saved grade the way the editor does: their colour
//                                        effects are replaced by the preset's, the rest kept (one batch)
//   shred styles list [--project <id>] [--json]
//                                        the text style library (or a project's copies: items using each,
//                                        and whether the library moved on)
//                                        (a style has one look per aspect ratio: 9:16, 16:9, ...)
//   shred styles show <name|id> [--project <id>]   a style's definition
//   shred styles use <projectId> <name|id...>       copy library styles into a project (again = update
//                                        the project copy from the library; restyles its items)
//   shred styles save <projectId> <itemId> --name "..." --role title|caption|label|lower-third|other
//                                        an item's look as a style, in the project (item linked) and library
//   shred styles import <pack.json> | export [<name|id...>] [--project <id>] [--out f.json] [--name kit]
//                                        style packs: a brand kit's title, caption and label styles in one file
//   shred styles clone <name|id> --aspect 16:9 [--from 9:16] [--project <id>]
//                                        add a look for another aspect, cloned from the closest
//                                        (sizes kept, positions keep their edge): library, or the
//                                        project's copy and the library; then adjust it
//   shred styles remove <name|id>        delete from the library (projects keep their copies)
//   shred categorize <mediaId>=<category>... | --category <c> <mediaId>...
//                                        set what each media is for (as the agent: the editor never
//                                        changes it; re-setting an auto suggestion confirms it)
//   shred draft <id> [--label "..."] [--no-plan]
//                                        copy a project to a private draft; prints the draft id. The
//                                        open editor shows the user you're working (--label: a few
//                                        words on what the pass does) and holds their edits until you
//                                        publish; every shred command on the draft or project keeps
//                                        that alive (it lapses after 10 minutes without one). A
//                                        project's first draft needs a validated plan (shred plan);
//                                        --no-plan only on a timeline the user built by hand
//   shred done <draftId|id>              end the pass without publishing (the editor lets the user edit)
//   shred plan <projectId> [--file plan.json]
//                                        validate the plan (agent/plan.json) and print it (a story plan's
//                                        beat sheet, a performance plan's script and to-source list),
//                                        with the format's targets estimated; records its hash. The
//                                        first draft of a project needs a plan that validated clean
//   shred plan <projectId> --scaffold <speaker mediaId...>
//                                        Graphic Yap / Greenscreen: a draft performance plan from the
//                                        speakers' transcripts (lines, obvious cuts marked), written to
//                                        agent/plan.json if none (else plan.scaffold.json); review every line
//   shred build <draftId> [--plan file] [--replace]
//                                        the first assembly from the plan, one atomic batch: clips (a
//                                        performance's kept lines back to back), sync sound per the
//                                        format, visuals, planned text, a marker per beat or kept line
//   shred build <projectId> --markers-only   only the plan markers, on the user's project (plan review)
//   shred apply <id> <ops.json>          apply an op batch atomically (revision-checked)
//   shred frames <id> --at 30,95,... [--out grid.jpg] [--size 270x480]
//                                        render saved frames and tile them for review
//   shred check <id> [--json] [--frames]            the format scorecard: rules and targets, pass/warn/fail, with
//                                        frame ranges to look at; numbers are guidelines (warn), format-defining rules and kit musts
//                                        can fail (exit 1); --frames renders every flagged frame into one
//                                        contact sheet with what each is for
//                                        (a project with a Video Style Kit adds the kit's rules: Kit section)
//                                        (a project with a plan adds a Plan section: beats or kept lines
//                                        missing or out of order, cut lines back in, length drift; warnings only)
//   shred kit apply <kit.json|folder> --project <id> [--force]
//                                        a Video Style Kit: its titles, captions and overlays become
//                                        kit:* text styles (project and library), the kit is recorded on
//                                        the project; prints the mapping, fonts and the kit's preferences
//   shred kit status <id>                the project's kit: version, hash, drift since apply, fonts, prefs
//   shred kit show <kit.json|folder>     a kit in words
//   shred kit save-back <id> [--style kit:title] [--force]
//                                        write the project's kit:* style tweaks into kit.json (version
//                                        bump, changelog); only when the user asks
//   shred publish <draftId> <targetId> --label "..." --summary <file.md>
//                                        hand the finished draft to the user's project as one pass
//                                        (the pass record carries the scorecard; refreshes the
//                                        project's thumbnail in the project list)
//   shred thumbnail <id> [--at frame]    re-render the project's thumbnail
//   shred changes <id>                   what the user changed since the last published pass
//   shred notes <id> [--json]            the user's open notes: comments pinned to a timecode (with
//                                        what sits at that frame and what they had selected) and
//                                        general notes from the Pass card
//   shred notes <id> --read <id,...|all> [--reply "what you did"]
//                                        mark notes read once acted on; the reply and the latest
//                                        pass show on the done note in the editor's Notes lane
//   shred notes <id> --watch             print each note as the user sends it (run it under a monitor)
//   shred master <audio|video> [--lufs -14] [--tp -1.5] [--out file.wav]
//                                        loudness-master to a new WAV (two-pass loudnorm)
//   shred sync <id> [--timeout 20]       make the open editor save now, so the agent sees unsaved tweaks
//   shred motion new <projectId> --name "..." [--duration 3]
//                                        scaffold a HyperFrames motion graphic at the project's canvas
//                                        (projects/<id>/motion/<slug>/, transparent starter)
//   shred motion add <draftId> <motion folder|.html> [--at <frame|2.5s>] [--variables JSON]
//                                        [--item <clipId>] [--keep-audio]   render it to a transparent
//                                        WebM and put it on the Motion track (or swap the render into
//                                        that clip); its own audio is muted unless --keep-audio
//   shred motion render <motion folder|.html> [--variables JSON]   render only
//   shred motion list <id>               the motion graphics on a timeline, with their folders
//   shred templates list [--category c] [--json]   the motion graphics template library: name,
//                                        category, size, duration, controls (with defaults)
//   shred templates show <name|id>       one template: controls, media, folder, thumbnail
//   shred templates save <projectId> <compositionItemId|compositionId> --name "..." --category <c> [--role r]
//                     [--hold <frame|start-end|none>]
//                                        save a composition as the template variant for its aspect ratio
//                                        (a copy of a template, or the same name = new version); --hold is
//                                        where a longer instance freezes between its in and out animation
//   shred templates clone <name|id> --aspect 16:9 [--from 9:16] [--size WxH]
//                                        make another aspect ratio's version from an existing one (items
//                                        keep their nearest edge, sizes follow the short side) to adjust
//   shred templates export <name|id> --out <dir|file.zip>   a template pack (template, thumbnails, media)
//   shred templates import <dir|file.zip>   add a pack's templates; media comes in through import
//   shred export <id> [--native|--browser] [--codec h264|hevc|prores] [--quality low|medium|high|ultra] [--out name]
//                                        final export to <workspace>/projects/<id>/exports/; default: native
//                                        (ffmpeg from the originals) when the plan allows it, else browser
//
// Service: 127.0.0.1:8787 (SHRED_SERVICE to override). Workspace: SHRED_WORKSPACE,
// else ~/.shreditor/config.json, else ~/Movies/Shreditor. Times are frames at the
// project fps. Ops reference earlier results with {"$ref":"<callerId>#/detail/..."}.
//
// Commands start what they need: a command that talks to the agent service (or
// reads the editor's unsaved state) starts it when it isn't answering, through
// the login item when `shreditor install` set one up for that port, else like
// `shred up`, and says so in one line on stderr. SHRED_AUTOSTART=0 turns it off.
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compatibilityPolicy } from '../../../server/media-compatibility.mjs'
import {
  CHOOSING_GUIDE,
  FORMATS,
  createFormatTracks,
  getFormat,
  resolveFormat,
} from '../../../formats/registry.mjs'
import { describeTarget, scoreProject, trackRole } from '../../../formats/scorecard.mjs'
import { suggestFormat } from '../../../formats/suggest.mjs'
import { qcMedia } from './qc.mjs'
import { flaggedFrames } from './check-frames.mjs'
import { stylesCommands } from './styles.mjs'
import { kitCheck, kitCommands, printKitCheck } from './kit.mjs'
import {
  LUTS_DIR,
  MAX_LUT_BYTES,
  checkCubeText,
  listLutNames,
  readCubeFileHeader,
} from '../../../headless/lib/luts.mjs'
import { templatesCommand } from './templates.mjs'
import { motionCommands } from './motion.mjs'
import { describeNote, markRead, noteSpan, openNotes } from './notes.mjs'
import { createActivity } from './activity.mjs'
import { draftPlanGate, planCheck, planCommands, printPlanCheck } from './plan.mjs'
import { runBuild, gitHead, staleBuild } from '../../../server/install/build-state.mjs'
import { DEFAULT_LABEL_PREFIX, jobLabel, jobStatus } from '../../../server/install/launchd.mjs'
import { logFile, spawnEditor, spawnService } from '../../../server/install/processes.mjs'
import { createAutostart } from '../../../server/install/self-start.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SERVICE = process.env.SHRED_SERVICE || 'http://127.0.0.1:8787'
const say = (line = '') => process.stdout.write(`${line}\n`)
process.stdout.on('error', (e) => e.code === 'EPIPE' && process.exit(0))

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  // `--lufs -14` reads as a flag to parseArgs; glue negative numbers to their option.
  args: process.argv.slice(2).reduce((out, arg) => {
    if (/^-\d/.test(arg) && /^--(lufs|tp)$/.test(out.at(-1) ?? '')) out.push(`${out.pop()}=${arg}`)
    else out.push(arg)
    return out
  }, []),
  options: {
    lufs: { type: 'string', default: '-14' },
    tp: { type: 'string', default: '-1.5' },
    project: { type: 'string' },
    at: { type: 'string' },
    out: { type: 'string' },
    size: { type: 'string' },
    name: { type: 'string' },
    fps: { type: 'string' },
    format: { type: 'string' },
    variant: { type: 'string' },
    'no-transcribe': { type: 'boolean' },
    frames: { type: 'boolean' },
    'no-wait': { type: 'boolean' },
    wait: { type: 'boolean' },
    retry: { type: 'boolean' },
    label: { type: 'string' },
    summary: { type: 'string' },
    link: { type: 'boolean' },
    category: { type: 'string' },
    role: { type: 'string' },
    build: { type: 'boolean' },
    dev: { type: 'boolean' },
    timeout: { type: 'string' },
    json: { type: 'boolean' },
    yes: { type: 'boolean' },
    force: { type: 'boolean' },
    native: { type: 'boolean' },
    browser: { type: 'boolean' },
    codec: { type: 'string' },
    quality: { type: 'string' },
    preset: { type: 'string' },
    aspect: { type: 'string' },
    from: { type: 'string' },
    hold: { type: 'string' },
    style: { type: 'string' },
    file: { type: 'string' },
    plan: { type: 'string' },
    replace: { type: 'boolean' },
    'markers-only': { type: 'boolean' },
    scaffold: { type: 'boolean' },
    'no-plan': { type: 'boolean' },
    read: { type: 'string' },
    reply: { type: 'string' },
    watch: { type: 'boolean' },
    duration: { type: 'string' },
    variables: { type: 'string' },
    item: { type: 'string' },
    'keep-audio': { type: 'boolean' },
  },
})
const [command, ...args] = positionals

function workspace() {
  if (process.env.SHRED_WORKSPACE) return path.resolve(process.env.SHRED_WORKSPACE)
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.shreditor/config.json'), 'utf8'),
    )
    if (config.workspace) return config.workspace
  } catch {}
  return path.join(os.homedir(), 'Movies', 'Shreditor')
}

async function call(method, route, body, headers = {}) {
  await autostart.ensure('service')
  return request(method, route, body, headers)
}

async function request(method, route, body, headers = {}) {
  const res = await fetch(`${SERVICE}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) {
    if (!res.ok) throw new Error(`${method} ${route}: HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    const e = data.error ?? {}
    const fields = (e.fields ?? [])
      .map((f) => `  ${f.path?.join?.('.') ?? f.path}: ${f.message}`)
      .join('\n')
    throw new Error(
      `${method} ${route}: ${e.code ?? res.status} ${e.message ?? ''}${fields ? `\n${fields}` : ''}`,
    )
  }
  return data
}

const DRAFTS = path.join(os.homedir(), '.shreditor', 'drafts.json')
const readDrafts = () => {
  try {
    return JSON.parse(fs.readFileSync(DRAFTS, 'utf8'))
  } catch {
    return {}
  }
}
const writeDrafts = (d) => {
  fs.mkdirSync(path.dirname(DRAFTS), { recursive: true })
  fs.writeFileSync(DRAFTS, `${JSON.stringify(d, null, 2)}\n`)
}

/** The user's project behind a draft (a project id stays as it is). */
const baseProjectId = (id) => readDrafts()[id]?.targetId ?? id

const EDITOR = process.env.SHRED_EDITOR || 'http://localhost:5273'
const editorUp = async () => {
  try {
    return (await fetch(`${EDITOR}/__shreditor/info`)).ok
  } catch {
    return false
  }
}
// The editor's "agent is working" banner for a pass (see activity.mjs).
const activity = createActivity({
  workspace,
  editor: EDITOR,
  editorUp,
  readDrafts,
  writeDrafts,
  warn: (line) => process.stderr.write(`${line}\n`),
})
const editorInfo = async () => {
  try {
    const res = await fetch(`${EDITOR}/__shreditor/info`)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}
// 'dev' or 'preview'. Older bridges don't say; a dev server serves /@vite/client.
async function editorKind(info) {
  if (info.mode) return info.mode
  try {
    const res = await fetch(`${EDITOR}/@vite/client`)
    return (res.headers.get('content-type') ?? '').includes('javascript') ? 'dev' : 'preview'
  } catch {
    return 'unknown'
  }
}
const portAnswers = async () => {
  try {
    await fetch(EDITOR)
    return true
  } catch {
    return false
  }
}
let built = false
function build(reason) {
  runBuild(REPO, { reason, say })
  built = true
}

// Login items (`shreditor install`) for these ports: launchd keeps them running.
const LABEL_PREFIX = process.env.SHREDITOR_LABEL_PREFIX || DEFAULT_LABEL_PREFIX
function loginItem(kind, url) {
  const job = jobStatus(jobLabel(LABEL_PREFIX, kind))
  return job.loaded && job.port === Number(new URL(url).port) ? job : null
}

/** Start the editor like `shred up` (a built preview, built first when stale; --dev the dev server). */
async function startEditor() {
  if (!opt.dev) {
    const reason = opt.build ? 'requested' : staleBuild(REPO)
    if (reason) build(reason)
  }
  return spawnEditor({
    repo: REPO,
    port: new URL(EDITOR).port,
    dev: opt.dev,
    // An overridden workspace is pinned for the editor too; otherwise it follows the config.
    workspace: process.env.SHRED_WORKSPACE,
  })
}

/** Start the service like `shred start` (it renders through the built app). */
function startService() {
  if (!built && (opt.build || !fs.existsSync(path.join(REPO, 'dist', 'headless.html'))))
    build(opt.build ? 'requested' : 'no build yet')
  return spawnService({ repo: REPO, port: new URL(SERVICE).port, workspace: workspace() })
}

const autostart = createAutostart({
  targets: {
    service: {
      name: 'the agent service',
      port: new URL(SERVICE).port,
      up: async () => Boolean(await health()),
      spawn: startService,
    },
    editor: {
      name: 'the editor',
      port: new URL(EDITOR).port,
      up: editorUp,
      spawn: startEditor,
    },
  },
})

// What the open editor has not saved yet (see server/editor-state.mjs).
// null when no editor answers, or it predates the heartbeat.
async function editorState(id) {
  await autostart.ensure('editor')
  try {
    const res = await fetch(`${EDITOR}/__shreditor/editor-state?project=${encodeURIComponent(id)}`)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}
const ago = (t) => `${Math.max(0, Math.round((Date.now() - t) / 1000))}s ago`
const CONFLICT =
  'The editor is showing a conflict banner for this project (it changed on disk while the user had unsaved edits). Ask the user to pick a version, then run shred sync again.'
async function warnUnsaved(id) {
  const s = await editorState(id)
  if (!s?.dirty && !s?.conflict) return null
  const line = s.conflict
    ? `WARNING: ${CONFLICT}`
    : `WARNING: The editor has unsaved edits (last edit ${s.lastEditAt ? ago(s.lastEditAt) : 'just now'}); run shred sync ${id} first. Below is the saved state only.`
  if (opt.json) process.stderr.write(`${line}\n`)
  else say(`${line}\n`)
  return { unsaved: Boolean(s.dirty), conflict: Boolean(s.conflict), lastEditAt: s.lastEditAt }
}

const slug = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'footage'
const MEDIA_EXT =
  /\.(mov|mp4|m4v|mkv|webm|avi|mts|mxf|wav|mp3|m4a|aac|aif|aiff|flac|png|jpe?g|webp|heic|gif)$/i
const WHISPER_MODEL = path.join(
  os.homedir(),
  'Library/Application Support/whisper.cpp/models/ggml-large-v3-turbo.bin',
)
const which = (bin) => {
  try {
    return execFileSync('which', [bin], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

// Share of strongly green pixels in the middle frame (0-1): talking heads shot
// on a green screen read well above GREEN_SCREEN_SHARE.
function greenShare(file, duration) {
  try {
    const raw = execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-ss',
        String(Math.max(0, duration / 2)),
        '-i',
        file,
        '-frames:v',
        '1',
        '-vf',
        'scale=36:64',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-',
      ],
      { maxBuffer: 1 << 20 },
    )
    let green = 0
    for (let i = 0; i + 2 < raw.length; i += 3)
      if (raw[i + 1] > 90 && raw[i + 1] > raw[i] * 1.4 && raw[i + 1] > raw[i + 2] * 1.4) green += 1
    return raw.length ? Math.round((green / (raw.length / 3)) * 100) / 100 : 0
  } catch {
    return undefined
  }
}

// Whisper invents these on non-speech audio (music, typing, room tone).
const WHISPER_PHANTOMS = new Set([
  'thank you',
  'thanks',
  'thank you very much',
  'thanks for watching',
  'thank you for watching',
  'you',
  'bye',
  'bye bye',
  'music',
  'applause',
  'laughter',
  'silence',
  'subtitles by the amara org community',
  'please subscribe',
])
const isPhantomSpeech = (text, seconds) => {
  const t = text
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return true
  if (WHISPER_PHANTOMS.has(t)) return true
  // "Thank you. Thank you." on a music bed: every sentence a phantom.
  const sentences = text
    .toLowerCase()
    .split(/[.!?]+/)
    .map((x) =>
      x
        .replace(/[^a-z' ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
  if (sentences.length && sentences.every((x) => WHISPER_PHANTOMS.has(x))) return true
  const words = t.split(' ').length
  return words <= 2 && seconds > 3
}

// Built-in transcripts (server/transcription.mjs), read straight from the workspace.
const transcription = () => import(pathToFileURL(path.join(REPO, 'server/transcription.mjs')).href)
const shreditorCli = (args) => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin/shreditor.mjs'), ...args], {
    stdio: 'inherit',
    env: { ...process.env, SHREDITOR_WORKSPACE: workspace(), SHREDITOR_PORT: new URL(EDITOR).port },
  })
  if (r.status) process.exitCode = r.status
}

const key = (tag) => `${tag}-${crypto.randomUUID()}`
const getProject = (id) => call('GET', `/v1/projects/${encodeURIComponent(id)}`)

const notesFile = (id) => path.join(workspace(), 'projects', id, 'agent', 'notes.json')

/** The project's notes (open and read); none when the file is missing or unreadable. */
function readNotes(id) {
  try {
    const stored = JSON.parse(fs.readFileSync(notesFile(id), 'utf8'))
    return Array.isArray(stored?.notes) ? stored.notes : []
  } catch {
    return []
  }
}

/** "Pass 5: <label>" for the project's latest published pass; undefined before the first. */
function latestPassLabel(id) {
  const dir = path.join(workspace(), 'projects', id, 'agent', 'passes')
  try {
    const last = fs
      .readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .sort()
      .at(-1)
    if (!last) return undefined
    const pass = JSON.parse(fs.readFileSync(path.join(dir, last), 'utf8'))
    return `Pass ${Number(pass.id ?? last.slice(0, -5))}${pass.label ? `: ${pass.label}` : ''}`
  } catch {
    return undefined
  }
}

/** Last frame any root item reaches (0 for an empty timeline). */
const timelineEnd = (project) =>
  Math.max(
    0,
    ...(project.timeline?.items ?? []).map((i) => (i.from ?? 0) + (i.durationInFrames ?? 0)),
  )

/**
 * The project's cover in the project list, as the editor makes on save: a
 * rendered frame (about a second in, or `at`) at the project's aspect.
 * Best effort: a failed render only warns.
 */
async function writeThumbnail(id, project, at) {
  const { width = 1080, height = 1920, fps = 30 } = project.metadata ?? {}
  const scale = 640 / Math.max(width, height)
  const frame = at ?? Math.max(0, Math.min(Math.round(fps), timelineEnd(project) - 1))
  try {
    const bytes = await call('POST', '/frame', {
      project: id,
      frame,
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      format: 'jpeg',
    })
    const file = path.join(workspace(), 'projects', id, 'thumbnail.jpg')
    fs.writeFileSync(`${file}.tmp`, bytes)
    fs.renameSync(`${file}.tmp`, file)
    return file
  } catch (error) {
    say(`warning: no thumbnail (${error.message})`)
    return null
  }
}

async function health() {
  try {
    return await request('GET', '/health')
  } catch {
    return null
  }
}

function summarize(project) {
  const t = project.timeline ?? { tracks: [], items: [] }
  const fps = project.metadata?.fps ?? 30
  const end = Math.max(0, ...t.items.map((i) => i.from + i.durationInFrames))
  return { fps, end, tracks: t.tracks, items: t.items }
}

// Items, markers and in/out points; the logic and its tests live beside this file.
const { diffTimelines, changesSincePass, describeChangesSincePass } =
  await import('./timeline-diff.mjs')

// ---------------------------------------------------------------------------
// Formats (formats/registry.mjs) and the scorecard (formats/scorecard.mjs)
// ---------------------------------------------------------------------------

const formatTitle = (format) => `${format.name}${format.variant ? ` (${format.variant.name})` : ''}`
const repoPath = (file) => path.join(REPO, file)

function formatOrThrow(id, variant) {
  if (!getFormat(id))
    throw new Error(
      `Unknown format "${id}". Formats: ${FORMATS.map((f) => f.id).join(', ')} (shred format list)`,
    )
  return resolveFormat(id, variant)
}

function projectFormatOrNull(project) {
  if (!project.format?.id || !getFormat(project.format.id)) return null
  try {
    return resolveFormat(project.format.id, project.format.variant)
  } catch {
    return null
  }
}

function listFormats() {
  for (const f of FORMATS) {
    const variants = f.variants
      .map((v) => `${v.id}${v.id === f.defaultVariant ? ' (default)' : ''}`)
      .join(', ')
    say(`${f.id.padEnd(12)} ${f.name}${variants ? `  [variants: ${variants}]` : ''}`)
    say(`${''.padEnd(12)} ${f.tagline}`)
    say(`${''.padEnd(12)} use when: ${f.useWhen}`)
  }
  say(`\nHow to choose: ${repoPath(CHOOSING_GUIDE.path)}`)
}

function printFormat(format) {
  const c = format.canvas
  const r = format.rules
  say(
    `${formatTitle(format)}  [${format.id}${format.variant ? ` --variant ${format.variant.id}` : ''}]`,
  )
  say(format.description)
  for (const v of format.variants) say(`  variant ${v.id.padEnd(9)} ${v.description}`)
  say(`canvas    ${c.width}x${c.height} @${c.fps}`)
  say(`guide     ${repoPath(format.guide.path)}  (read it fully before planning)`)
  say(`research  ${repoPath(format.guide.research)}`)
  say('\nTracks, top to bottom')
  for (const t of format.tracks) say(`  ${t.name.padEnd(14)} ${t.kind.padEnd(6)} role ${t.role}`)
  say('\nRules')
  const hold = describeTarget({ ...r.titleHook.holdSec, ideal: null, unit: 's' })
  say(
    `  ${'title hook'.padEnd(12)} ${r.titleHook.required ? 'required' : 'optional'} from ${r.titleHook.fromSec} s, held ${hold}${r.titleHook.allowFullHold ? ' or all video' : ''}`,
  )
  for (const k of ['captions', 'speech', 'voiceover', 'music', 'sfx', 'syncSound', 'transitions'])
    say(`  ${k.padEnd(12)} ${r[k]}`)
  say('\nTargets (fail = must fix or explain; warn = starting point)')
  for (const t of format.targets) {
    const banded = t.min !== null || t.max !== null
    const ideal = t.ideal !== null && banded ? `  ideal ~${t.ideal}` : ''
    say(
      `  ${t.label.padEnd(42)} ${describeTarget(t).padEnd(16)} ${(banded ? t.severity : 'info').padEnd(5)}${t.source.padEnd(9)}${ideal}${t.note ? `  (${t.note})` : ''}`,
    )
  }
  say('\nChecklist')
  for (const line of format.checklist) say(`  - ${line}`)
}

function printTracks(project, format) {
  const tracks = [...(project?.timeline?.tracks ?? [])].sort((a, b) => a.order - b.order)
  for (const t of tracks) {
    const role = format ? trackRole(t, format) : null
    say(
      `${t.name.padEnd(format ? 14 : 3)} ${t.id}  (${t.kind ?? 'video'}${role ? `, role ${role}` : ', default track: reuse it'})`,
    )
  }
}

async function setFormat(id, formatId) {
  if (!id || !formatId)
    throw new Error('Usage: shred format set <projectId> <formatId> [--variant v]')
  const format = formatOrThrow(formatId, opt.variant)
  const { project, revision } = await getProject(id)
  const empty = !project.timeline?.items?.length
  const c = format.canvas
  const m = project.metadata ?? {}
  const canvasDiffers = m.width !== c.width || m.height !== c.height || m.fps !== c.fps
  const choice = { id: format.id, ...(format.variant ? { variant: format.variant.id } : {}) }
  const updates = {
    format: choice,
    ...(empty && canvasDiffers ? { width: c.width, height: c.height, fps: c.fps } : {}),
  }
  const updated = await call(
    'PATCH',
    `/v1/projects/${id}`,
    { updates, expectedRevision: revision },
    { 'Idempotency-Key': key('format') },
  )
  if (!updated.project?.format)
    throw new Error(
      'The service ignored the format; restart it on this build (shred start --build)',
    )
  say(`${id}: format ${formatTitle(format)}`)
  if (empty) {
    // An empty timeline takes the format's canvas and named tracks.
    const timeline = {
      ...(updated.project.timeline ?? {}),
      tracks: createFormatTracks(format),
      items: [],
    }
    const saved = await call(
      'PUT',
      `/v1/projects/${id}`,
      { project: { ...updated.project, timeline }, expectedRevision: updated.revision },
      { 'Idempotency-Key': key('format-tracks') },
    )
    if (canvasDiffers) say(`canvas   ${c.width}x${c.height} @${c.fps}`)
    say('Track layout applied (the timeline was empty):')
    printTracks(saved.project, format)
  } else {
    if (canvasDiffers)
      say(
        `warning: the canvas is ${m.width}x${m.height} @${m.fps}, the format's is ${c.width}x${c.height} @${c.fps}; left as is (the timeline has items).`,
      )
    say(
      'Tracks left as they are (the timeline has items). Roles come from item formatRole, media categories, then track names:',
    )
    printTracks(project, format)
  }
  say(`Read the guide before planning: ${repoPath(format.guide.path)}`)
}

const readJsonOrNull = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Media metadata and built-in transcripts for the media a project uses. */
async function scoringInputs(project) {
  const ws = workspace()
  const { readStoredTranscript } = await transcription()
  const mediaById = {}
  const transcripts = {}
  for (const id of new Set((project.timeline?.items ?? []).map((i) => i.mediaId).filter(Boolean))) {
    if (path.basename(id) !== id) continue
    const meta = readJsonOrNull(path.join(ws, 'media', id, 'metadata.json'))
    if (meta) mediaById[id] = meta
    const stored = readStoredTranscript(ws, id)
    if (stored) transcripts[id] = stored
  }
  return { mediaById, transcripts }
}

const TAG = { pass: 'pass', warn: 'WARN', fail: 'FAIL', info: 'info', na: 'n/a' }

/** Write JSON so a reader (the editor) never sees half a file. */
function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

/**
 * A published pass as kept in `agent/passes/NNN.json`. `baseTimeline` is what
 * the pass started from, so `shred changes` can tell when the user undid it.
 */
function passRecord({ n, draftId, origin, target, saved, changes, draft, scorecard, kit }) {
  return {
    id: n,
    label: opt.label,
    summary: opt.summary ? fs.readFileSync(opt.summary, 'utf8').trim() : '',
    by: 'agent',
    status: 'review',
    createdAt: new Date().toISOString(),
    draftId,
    baseRevision: target.revision,
    resultRevision: saved.revision,
    changes,
    ...(scorecard ? { scorecard } : {}),
    ...(kit ? { kit } : {}),
    ...(origin.plan ? { plan: origin.plan } : {}),
    timeline: draft.project.timeline,
    baseTimeline: target.project.timeline,
  }
}

function printScorecard(card, project) {
  const fps = project.metadata?.fps ?? 30
  const format = resolveFormat(card.format, card.variant)
  const s = card.summary
  say(
    `Scorecard: ${formatTitle(format)}, ${card.durationSec} s  (${s.pass} pass, ${s.warn} warn, ${s.fail} fail)`,
  )
  const sec = (frame) => (frame / fps).toFixed(2)
  for (const c of card.checks) {
    const value =
      c.value === null
        ? '-'
        : typeof c.value === 'boolean'
          ? c.value
            ? 'yes'
            : 'no'
          : String(c.value)
    say(
      `  ${TAG[c.status].padEnd(4)}  ${c.label.padEnd(42)} ${value.padStart(6)}  target ${c.target}${c.detail ? `  (${c.detail})` : ''}`,
    )
    if (c.ranges.length)
      say(
        `        frames ${c.ranges.map((r) => `${r.startFrame}-${r.endFrame} [${sec(r.startFrame)}-${sec(r.endFrame)} s]`).join(', ')}`,
      )
  }
  if (s.fail)
    say('A FAIL is a rule that makes this the format: fix it, or tell the user why it stays.')
  if (s.warn) say('WARNs are guidelines from videos that work, not quotas: look, then decide.')
}

/**
 * Apply an op batch to a project atomically at a known revision (ops get
 * callerIds op0, op1, ... unless they carry their own). A revision the project
 * has moved past fails the whole batch.
 */
/** Import one file into a project's media (waiting for a working copy); returns its media id. */
function importOne(file, projectId, category) {
  const out = execFileSync(
    process.execPath,
    [path.join(REPO, 'bin/shreditor.mjs'), 'import', file, '--project', projectId, '--category', category],
    {
      encoding: 'utf8',
      env: { ...process.env, SHREDITOR_WORKSPACE: workspace(), SHREDITOR_PORT: new URL(EDITOR).port },
    },
  )
  const id = /^(?:clone|link|copy|exists)\s+([0-9a-f-]{36})\s/m.exec(out)?.[1]
  if (!id) throw new Error(`Import of ${file} failed:\n${out.trim()}`)
  return id
}

async function applyBatch(id, batch, revision) {
  const ops = batch.map((op, i) => ({ callerId: `op${i}`, ...op }))
  const logStart = serviceLogSize()
  let res
  try {
    res = await call(
      'POST',
      `/v1/projects/${id}/edit`,
      { ops, expectedRevision: revision, persist: true },
      { 'Idempotency-Key': key('apply') },
    )
  } catch (error) {
    throw new Error(
      `${error.message}${serviceLogTail(logStart)}\nNothing was applied (batches are atomic).`,
    )
  }
  say(`applied ${res.applied} ops, revision ${res.revision}`)
  for (const w of res.warnings ?? [])
    say(`warning: ${typeof w === 'string' ? w : JSON.stringify(w)}`)
  return res
}

// The login item's log when launchd runs the service, else `shred start`'s.
let serviceLogPath
const serviceLog = () =>
  (serviceLogPath ??= loginItem('service', SERVICE)?.log ?? logFile('service'))
const serviceLogSize = () => fs.statSync(serviceLog(), { throwIfNoEntry: false })?.size ?? 0

/** Error lines the service logged since `from` (bytes), so another run's errors never show. */
function serviceLogTail(from) {
  const size = serviceLogSize()
  if (size <= from) return ''
  const fd = fs.openSync(serviceLog(), 'r')
  const buffer = Buffer.alloc(Math.min(size - from, 256 * 1024))
  fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length)
  fs.closeSync(fd)
  const tail = buffer
    .toString('utf8')
    .split('\n')
    .filter((l) => /Error|failed/.test(l))
    .slice(-3)
    .join('\n')
  return tail ? `\nservice log:\n${tail}` : ''
}

/** Render frames of the saved project and tile them into one image. */
async function renderFrameGrid(id, at, size = '270x480', outPath) {
  const [w, h] = size.split('x').map(Number)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-frames-'))
  const { revision } = await getProject(id)
  for (const frame of at) {
    const bytes = await call('POST', '/frame', {
      project: id,
      frame,
      width: w,
      height: h,
      format: 'jpeg',
    })
    fs.writeFileSync(path.join(dir, `f${String(frame).padStart(6, '0')}.jpg`), bytes)
  }
  const out = path.resolve(outPath ?? path.join(dir, 'grid.jpg'))
  const cols = Math.min(at.length, 10)
  const rows = Math.ceil(at.length / cols)
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-pattern_type',
    'glob',
    '-i',
    path.join(dir, 'f*.jpg'),
    '-vf',
    `tile=${cols}x${rows}:padding=4:color=gray`,
    '-frames:v',
    '1',
    out,
  ])
  return { out, revision }
}

/** `shred check --frames`: the flagged frames as one contact sheet, with what each is for. */
async function printFlaggedFrames(id, card, kitCard) {
  const frames = flaggedFrames(card, kitCard)
  if (!frames.length) return say('\nNo flagged frames to look at.')
  const { out } = await renderFrameGrid(
    id,
    frames.map((f) => f.frame),
    opt.size,
    opt.out,
  )
  say(`\nFlagged frames: ${out}  (left to right, top to bottom; open it and look)`)
  for (const [i, f] of frames.entries())
    say(`  ${String(i + 1).padStart(2)}. frame ${f.frame}  ${f.ids.join(', ')}`)
}

const planDeps = () => ({
  say,
  opt,
  workspace,
  getProject,
  applyBatch,
  readDrafts,
  writeDrafts,
  warnUnsaved,
})

/** Did the user change the project since the draft was taken (saved, or unsaved in the editor)? */
async function userChangedSince(origin, targetId) {
  try {
    const target = await getProject(targetId)
    const unsaved = (await editorState(targetId))?.dirty === true
    return unsaved || origin.baseRevision !== target.revision
  } catch {
    return true
  }
}

const commands = {
  async up() {
    const info = await editorInfo()
    const managed = loginItem('editor', EDITOR)
    if (info && managed) {
      say(`Editor   ${EDITOR}  managed by the login item (${managed.label}); left as is`)
    } else if (info) {
      // Never kill or replace a running editor: the user may be mid-edit in it.
      const kind = await editorKind(info)
      const what =
        { dev: 'dev server (reloads on source edits)', preview: 'built preview' }[kind] ??
        'unknown kind'
      say(`Editor   ${EDITOR}  already running: ${what}; left as is`)
      if (opt.dev ? kind === 'preview' : kind === 'dev')
        say(
          `         (stop it yourself to switch to ${opt.dev ? 'the dev server' : 'a built preview'})`,
        )
    } else if (await portAnswers()) {
      throw new Error(
        `Something other than the Shreditor editor is serving ${EDITOR}. Stop it, or set SHRED_EDITOR to a free port.`,
      )
    } else {
      await autostart.ensure('editor', { explicit: true })
      const what = managed
        ? `started by its login item (${managed.label})`
        : opt.dev
          ? 'dev server (reloads on source edits)'
          : `built preview of ${gitHead(REPO)?.sha ?? 'this checkout'}`
      say(`Editor   ${EDITOR}  ${what}`)
    }
    await commands.start()
  },

  async sync([id]) {
    if (!id) throw new Error('Pass a project id')
    const first = await editorState(id)
    if (!first)
      return say(
        `No editor answering at ${EDITOR} (or it predates shred sync); the saved state is all there is.`,
      )
    if (!first.open) return say(`No editor open on ${id}; the saved state is current.`)
    if (first.conflict) throw new Error(CONFLICT)
    // Clean, not saving, and holding the revision that is on disk.
    const settled = (s) =>
      s.editors.every(
        (e) => !e.dirty && !e.saving && (!e.revision || e.revision === s.diskRevision),
      )
    if (settled(first))
      return say(
        `Editor has no unsaved edits (revision ${String(first.diskRevision).slice(0, 19)}…).`,
      )
    const res = await fetch(
      `${EDITOR}/__shreditor/editor-state/save?project=${encodeURIComponent(id)}`,
      { method: 'POST' },
    )
    if (!res.ok) throw new Error(`Save request failed: HTTP ${res.status}`)
    const seconds = Number(opt.timeout ?? 20)
    const deadline = Date.now() + seconds * 1000
    let last = first
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250))
      const s = await editorState(id)
      if (!s?.open)
        return say(
          'The editor closed while syncing; the saved state is all there is (shred changes shows it).',
        )
      if (s.conflict) throw new Error(CONFLICT)
      if (settled(s))
        return say(
          `Saved: the editor's edits are on disk (revision ${String(s.diskRevision).slice(0, 19)}…).`,
        )
      last = s
    }
    throw new Error(
      `Timed out after ${seconds}s: the editor still has unsaved edits (last edit ${last.lastEditAt ? ago(last.lastEditAt) : 'unknown'}). The user may be mid-drag or in a dialog; ask them to save (Cmd+S), then run shred sync again.`,
    )
  },

  async new() {
    if (!opt.name) throw new Error('--name is required')
    if (opt.variant && !opt.format) throw new Error('--variant needs --format')
    const format = opt.format ? formatOrThrow(opt.format, opt.variant) : null
    // A format sets the canvas; --size/--fps still win when given.
    const [width, height] = opt.size ? opt.size.split('x').map(Number) : format ? [] : [1080, 1920]
    const fps = opt.fps ? Number(opt.fps) : format ? undefined : 30
    const body = {
      name: opt.name,
      ...(width ? { width, height } : {}),
      ...(fps ? { fps } : {}),
      ...(format
        ? { format: { id: format.id, ...(format.variant ? { variant: format.variant.id } : {}) } }
        : {}),
    }
    const created = await call('POST', '/v1/projects', body, { 'Idempotency-Key': key('new') })
    fs.mkdirSync(path.join(workspace(), 'projects', created.id, 'agent', 'passes'), {
      recursive: true,
    })
    say(created.id)
    say(`${EDITOR}/editor/${created.id}`)
    const meta = created.project?.metadata ?? {}
    if (format) {
      if (!created.project?.format)
        throw new Error(
          'The service ignored --format; restart it on this build (shred start --build)',
        )
      say(`${formatTitle(format)}  ${meta.width}x${meta.height} @${meta.fps}`)
      say(`Read the guide before planning: ${path.join(REPO, format.guide.path)}`)
    }
    printTracks(created.project, format)
  },

  async format([first, ...rest]) {
    if (!first || first === 'list') return listFormats()
    if (first === 'set') return setFormat(rest[0], rest[1])
    if (getFormat(first)) return printFormat(resolveFormat(first, opt.variant))
    const { project } = await getProject(first)
    if (!project.format) {
      say(`${project.name} (${first}) has no format yet. Choose one with the user:`)
      return listFormats()
    }
    const format = resolveFormat(project.format.id, opt.variant ?? project.format.variant)
    printFormat(format)
    if (project.format.reviewedHash && project.format.reviewedHash !== format.guide.reviewedHash) {
      say(
        `\nNote: the format's guide changed since this project chose it (${project.format.reviewedHash.slice(0, 19)}…); re-read it.`,
      )
    }
  },

  async check([id]) {
    if (!id) throw new Error('Pass a project id')
    const editor = await warnUnsaved(id)
    const { project, revision } = await getProject(id)
    if (!project.format && !project.kit)
      throw new Error(
        `${id} has no format. Choose one (shred format list), then: shred format set ${id} <format>`,
      )
    const inputs = await scoringInputs(project)
    const kit = await kitCheck({ call, workspace }, id, project, inputs.mediaById)
    const card = project.format
      ? scoreProject(project, { ...inputs, targetOverrides: kit?.overrides })
      : null
    const plan = project.format ? planCheck({ workspace, readDrafts }, id, project) : null
    if (opt.json)
      say(
        JSON.stringify(
          {
            revision,
            ...(card ?? {}),
            ...(kit ? { kit } : {}),
            ...(plan ? { plan } : {}),
            ...(editor ? { editor } : {}),
          },
          null,
          2,
        ),
      )
    else {
      if (card) printScorecard(card, project)
      else say(`${id} has no format: kit rules only (shred format set ${id} <format>)`)
      printKitCheck(say, kit, project.metadata?.fps ?? 30)
      printPlanCheck(say, plan)
      if (opt.frames) await printFlaggedFrames(id, card, kit?.card)
    }
    if (card?.summary.fail || kit?.card?.summary.fail) process.exitCode = 1
  },

  async catalog(inputs) {
    if (!inputs.length) throw new Error('Pass a folder or files')
    const files = inputs.flatMap((p) => {
      const full = path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()))
      if (fs.statSync(full).isDirectory()) {
        return fs
          .readdirSync(full)
          .filter((f) => MEDIA_EXT.test(f) && !f.startsWith('.'))
          .sort()
          .map((f) => path.join(full, f))
      }
      return [full]
    })
    const name = opt.name ?? slug(path.basename(path.resolve(inputs[0])))
    const dir = path.join(workspace(), 'catalogs', name)
    fs.mkdirSync(path.join(dir, 'sheets'), { recursive: true })
    const transcribe = !opt['no-transcribe'] && which('whisper-cli') && fs.existsSync(WHISPER_MODEL)
    const { transcriptForFile } = await transcription()
    const entries = []
    for (const file of files) {
      // Extension included: floor-plan.png and floor-plan.mov must not share a sheet.
      const base = slug(path.basename(file))
      let probe
      try {
        probe = JSON.parse(
          execFileSync(
            'ffprobe',
            ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
            { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
          ),
        )
      } catch {
        entries.push({ file, error: 'ffprobe could not read it' })
        continue
      }
      const v = probe.streams.find((x) => x.codec_type === 'video' && !x.disposition?.attached_pic)
      const a = probe.streams.find((x) => x.codec_type === 'audio')
      const duration = Number(probe.format?.duration ?? 0)
      const [fn, fd] = (v?.r_frame_rate ?? '0/1').split('/').map(Number)
      const isStill =
        Boolean(v) &&
        (!duration || (/png|mjpeg|jpe?g|webp|heic|gif/i.test(v.codec_name) && duration < 0.2))
      const entry = {
        file,
        kind: v ? (isStill ? 'image' : 'video') : 'audio',
        duration: Math.round(duration * 1000) / 1000,
        ...(v
          ? {
              width: v.width,
              height: v.height,
              fps: fd ? Math.round((fn / fd) * 1000) / 1000 : 0,
              codec: v.codec_name,
              alpha: /^(yuva|rgba|argb|bgra|abgr|gbrap|ya)/.test(v.pix_fmt ?? ''),
            }
          : {}),
        ...(a ? { audio: a.codec_name } : {}),
        browserPlayable: true,
      }
      // The decision import makes (server/media-compatibility.mjs): what Chrome
      // can't decode as it is gets a working copy automatically when imported.
      if (v && !isStill) {
        try {
          const plan = compatibilityPolicy(probe)
          if (plan)
            Object.assign(entry, {
              browserPlayable: false,
              workingCopy: `${plan.action}: ${plan.detail}`,
            })
        } catch (error) {
          Object.assign(entry, { browserPlayable: false, workingCopy: `none: ${error.message}` })
        }
      }
      if (v) {
        const sheet = path.join(dir, 'sheets', `${base}.jpg`)
        const vf = isStill
          ? 'scale=320:-2'
          : `fps=8/${Math.max(duration, 0.5)},scale=180:320:force_original_aspect_ratio=decrease,pad=180:320:-1:-1:color=gray,tile=8x1:padding=3`
        try {
          execFileSync('ffmpeg', [
            '-v',
            'error',
            '-y',
            '-i',
            file,
            '-vf',
            vf,
            '-frames:v',
            '1',
            sheet,
          ])
          entry.sheet = sheet
        } catch {}
      }
      // Footage already imported: its media id, its category (an `auto` one is
      // the editor's suggestion: confirm or correct it with shred categorize),
      // and its built-in transcript.
      const imported = transcriptForFile(workspace(), file)
      if (imported) {
        entry.mediaId = imported.mediaId
        if (imported.category)
          Object.assign(entry, {
            category: imported.category,
            categorySource: imported.categorySource ?? 'explicit',
          })
      }
      const builtIn = a ? imported : null
      if (builtIn?.envelope) {
        entry.mediaId = builtIn.mediaId
        entry.transcript = builtIn.path
        entry.speech = builtIn.envelope.data.text.slice(0, 400)
      } else if (builtIn?.status?.status === 'none') {
        entry.mediaId = builtIn.mediaId
        entry.speech = null
        entry.speechNote = `no clear speech (built-in transcription: ${builtIn.status.reason ?? 'none'})`
      }
      if (
        transcribe &&
        a &&
        duration > 1 &&
        !builtIn?.envelope &&
        builtIn?.status?.status !== 'none'
      ) {
        const wav = path.join(os.tmpdir(), `shred-${crypto.randomUUID()}.wav`)
        const outBase = path.join(dir, 'transcripts', base)
        fs.mkdirSync(path.dirname(outBase), { recursive: true })
        try {
          execFileSync('ffmpeg', [
            '-v',
            'error',
            '-y',
            '-i',
            file,
            '-vn',
            '-ac',
            '1',
            '-ar',
            '16000',
            wav,
          ])
          execFileSync(
            'whisper-cli',
            ['-m', WHISPER_MODEL, '-f', wav, '-oj', '-osrt', '-of', outBase, '-np'],
            { stdio: 'ignore' },
          )
          const segs = JSON.parse(fs.readFileSync(`${outBase}.json`, 'utf8')).transcription ?? []
          const text = segs.map((x) => x.text.trim()).join(' ')
          if (isPhantomSpeech(text, duration)) {
            entry.speech = null
            entry.speechNote = `no clear speech (whisper heard ${JSON.stringify(text.slice(0, 40))}; discarded)`
          } else {
            entry.transcript = `${outBase}.srt`
            entry.speech = text.slice(0, 400)
          }
        } catch {
          entry.transcriptError = 'whisper failed'
        } finally {
          fs.rmSync(wav, { force: true })
        }
      }
      // Talking heads: how much of a frame is green screen (format choice).
      if (entry.kind === 'video' && entry.speech) entry.greenShare = greenShare(file, duration)
      entries.push(entry)
      say(
        `${entry.kind.padEnd(5)} ${String(entry.duration).padStart(7)}s  ${path.basename(file)}${entry.category ? `  [${entry.category} ${entry.categorySource}]` : ''}${entry.browserPlayable ? '' : `  (import makes a working copy: ${entry.workingCopy})`}${entry.speechNote ? '  (no speech)' : ''}${entry.speech ? `  "${entry.speech.slice(0, 60)}…"` : ''}`,
      )
    }
    const out = path.join(dir, 'catalog.json')
    const suggestedFormat = suggestFormat(entries)
    fs.writeFileSync(
      out,
      `${JSON.stringify({ name, createdAt: new Date().toISOString(), sources: inputs.map((p) => path.resolve(p)), ...(suggestedFormat ? { suggestedFormat } : {}), entries }, null, 2)}\n`,
    )
    say(`\n${entries.length} items → ${out}`)
    if (suggestedFormat) {
      const also = suggestedFormat.alternatives.map((a) => getFormat(a).name).join(', ')
      say(
        `Suggested format: ${suggestedFormat.name} (${suggestedFormat.id}): ${suggestedFormat.reason}${also ? `. Also consider: ${also}` : ''}.`,
      )
      say(
        'A suggestion only: propose it to the user with the reason and let them pick (shred format list).',
      )
    } else say('No format suggestion from this footage (shred format list; ask the user).')
    say(
      `Contact sheets in ${path.join(dir, 'sheets')}: open them and write what each shot shows into catalog.json ("content", "usable").`,
    )
    say(
      'Import the original files: import makes a working copy automatically where browserPlayable is false (originals are untouched).',
    )
  },

  async transcript([id]) {
    if (!id) throw new Error('Pass a media id')
    const { readStoredTranscript, readTranscriptionStatus } = await transcription()
    const stored = readStoredTranscript(workspace(), id)
    const status = readTranscriptionStatus(workspace(), id)
    if (!stored) {
      const why = status
        ? `${status.status}${status.reason ? ` (${status.reason})` : ''}${status.error ? `: ${status.error}` : ''}${status.hint ? `\n${status.hint}` : ''}`
        : 'never transcribed (run: shred transcribe ' + id + ')'
      if (opt.json)
        return say(
          JSON.stringify({ mediaId: id, transcription: status, transcript: null }, null, 2),
        )
      say(`No transcript for ${id}: ${why}`)
      process.exitCode = status?.status === 'none' ? 0 : 1
      return
    }
    const data = stored.data
    const source =
      stored.service === 'whisper.cpp'
        ? `whisper.cpp ${stored.model}`
        : `made in the app (${data.modelVariant ?? data.model ?? 'unknown model'})`
    if (opt.json)
      return say(
        JSON.stringify(
          {
            mediaId: id,
            language: data.language,
            source,
            transcription: status,
            text: data.text,
            segments: data.segments,
          },
          null,
          2,
        ),
      )
    say(`${id}  ${data.language ?? '?'}  ${source}`)
    for (const seg of data.segments ?? []) {
      say(`\n[${seg.start.toFixed(2)}-${seg.end.toFixed(2)}] ${seg.text}`)
      for (const w of seg.words ?? [])
        say(`  ${w.start.toFixed(3).padStart(8)} ${w.end.toFixed(3).padStart(8)}  ${w.text}`)
    }
  },

  async transcribe(ids) {
    shreditorCli([
      'transcribe',
      ...ids,
      ...(opt.project ? ['--project', opt.project] : []),
      ...(opt.force ? ['--force'] : []),
    ])
  },

  async setup() {
    shreditorCli(['setup', 'whisper', ...(opt.yes ? ['--yes'] : [])])
  },

  async changes([id]) {
    const editor = await warnUnsaved(id)
    const dir = path.join(workspace(), 'projects', id, 'agent', 'passes')
    const passes = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .sort()
      : []
    if (!passes.length) return say('No published passes yet.')
    const readPass = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    const last = readPass(passes.at(-1))
    const { revision, project } = await getProject(id)
    if (revision === last.resultRevision)
      return say(`No changes since pass #${Number(last.id)} "${last.label}".`)
    const previous = passes.length > 1 ? readPass(passes.at(-2)) : null
    const since = changesSincePass(last, previous, project.timeline)
    if (opt.json) {
      const undone = since.undone && {
        pass: last.id,
        all: since.undone.all,
        reverted: since.undone.reverted.map((d) => d.id),
        total: since.undone.total,
      }
      const report = { since: last.id, revision, diff: since.diff, ...(undone ? { undone } : {}) }
      return say(JSON.stringify({ ...report, ...(editor ? { editor } : {}) }, null, 2))
    }
    for (const line of describeChangesSincePass(last, since)) say(line)
    const open = openNotes(readNotes(id)).length
    if (open) say(`${open} open note${open === 1 ? '' : 's'} from the user: shred notes ${id}`)
  },

  async notes([id]) {
    if (!id) throw new Error('Pass a project id: shred notes <id>')
    if (opt.read) {
      const stored = readNotes(id)
      if (!stored.length) return say('No notes from the user.')
      const { notes, marked, unknown } = markRead(stored, opt.read, {
        reply: opt.reply?.trim() || undefined,
        pass: latestPassLabel(id),
      })
      if (unknown.length)
        throw new Error(`No note ${unknown.join(', ')} (shred notes ${id} lists them)`)
      const file = notesFile(id)
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify({ version: 1, notes }, null, 2)}\n`)
      fs.renameSync(`${file}.tmp`, file)
      const pass = latestPassLabel(id)
      return say(
        `Marked ${marked} note${marked === 1 ? '' : 's'} read${pass ? ` (${pass})` : ''}.` +
          (opt.reply ? '' : ' Add --reply "<what you did>" so the user sees it on the Notes lane.'),
      )
    }
    // Frames are read against the saved timeline; the user's unsaved tweaks need `shred sync`.
    const context = async () => {
      try {
        const { project } = await getProject(id)
        return { timeline: project.timeline, fps: project.metadata?.fps ?? 30 }
      } catch {
        return { timeline: null, fps: 30 }
      }
    }
    if (opt.watch) {
      const seen = new Set()
      say(`Watching for the user's notes on ${id} (stop with Ctrl+C)`)
      for (;;) {
        const fresh = openNotes(readNotes(id)).filter((note) => !seen.has(note.id))
        if (fresh.length) {
          const { timeline, fps } = await context()
          for (const note of fresh) {
            seen.add(note.id)
            say(
              `note ${describeNote(note, timeline, fps)
                .map((l) => l.trim())
                .join(' | ')}`,
            )
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
    const open = openNotes(readNotes(id))
    if (opt.json) {
      const { timeline, fps } = await context()
      // `span` is where each note sits now (it follows the clip it was pinned to).
      const notes = open.map((note) => ({ ...note, span: noteSpan(note, timeline, fps) }))
      return say(JSON.stringify({ fps, notes, hasTimeline: Boolean(timeline) }, null, 2))
    }
    if (!open.length) return say('No open notes from the user.')
    const { timeline, fps } = await context()
    say(`${open.length} open note${open.length === 1 ? '' : 's'} from the user`)
    for (const note of open) {
      say()
      for (const line of describeNote(note, timeline, fps)) say(line)
    }
    say()
    say(`Once acted on: shred notes ${id} --read <id,...> --reply "what you did" (or --read all)`)
  },

  async start() {
    const managed = loginItem('service', SERVICE)
    const running = await health()
    if (running && managed)
      return say(`Service  ${SERVICE}  managed by the login item (${managed.label}); left as is`)
    if (running) return say(`Service already running at ${SERVICE}`)
    await autostart.ensure('service', { explicit: true })
    const log = managed?.log ?? logFile('service')
    say(
      `Service running at ${SERVICE} on ${(await health())?.workspace ?? workspace()} (log: ${log})`,
    )
  },

  async status() {
    const h = await health()
    const ws = workspace()
    say(`workspace  ${ws}`)
    say(`editor     ${(await editorUp()) ? EDITOR : 'down (run: shred up)'}`)
    say(
      `service    ${h ? `up, GPU ${h.gpu?.available ? 'yes' : 'no'}` : 'down (run: shred start)'}`,
    )
    const lock = path.join(ws, '.freecut-headless', 'writer.lock')
    say(
      `writer     ${fs.existsSync(lock) ? 'locked by the service (imports go through `shred import`)' : 'free'}`,
    )
    const items = [loginItem('editor', EDITOR), loginItem('service', SERVICE)].filter(Boolean)
    say(
      `login      ${items.length ? items.map((j) => `${j.label} ${j.state}${j.pid ? ` pid ${j.pid}` : ''}`).join(', ') : 'none (npx shreditor install keeps both running)'}`,
    )
    const passes = await activity.statusLines()
    say(`passes     ${passes.length ? passes.join('\n           ') : 'none in progress'}`)
  },

  async project([id]) {
    const editor = await warnUnsaved(id)
    const { revision, project } = await getProject(id)
    const s = summarize(project)
    if (opt.json)
      return say(JSON.stringify({ revision, ...s, ...(editor ? { editor } : {}) }, null, 2))
    say(
      `${project.name}  ${project.metadata?.width}x${project.metadata?.height} @${s.fps}  ${s.end} frames (${(s.end / s.fps).toFixed(2)}s)`,
    )
    say(`revision ${revision}`)
    const format = projectFormatOrNull(project)
    say(
      format
        ? `format   ${formatTitle(format)} (shred format ${id})`
        : 'format   none (shred format list)',
    )
    for (const t of [...s.tracks].sort((x, y) => x.order - y.order)) {
      const role = format ? trackRole(t, format) : null
      say(`\n${t.name} (${t.kind ?? 'track'} ${t.id}${role ? `, role ${role}` : ''})`)
      for (const i of s.items.filter((x) => x.trackId === t.id).sort((x, y) => x.from - y.from)) {
        const src = i.sourceStart !== undefined ? `  src ${i.sourceStart}-${i.sourceEnd}` : ''
        say(
          `  ${String(i.from).padStart(5)}-${String(i.from + i.durationInFrames).padEnd(5)} ${i.type.padEnd(6)} ${(i.type === 'text' ? JSON.stringify(i.text) : i.label) ?? ''}${src}  [${i.id}]`,
        )
      }
    }
  },

  async import(files) {
    if (!files.length) throw new Error('Pass one or more file paths')
    const cli = path.join(REPO, 'bin/shreditor.mjs')
    // Streams progress while working copies are made (unless --no-wait).
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'import',
        ...files,
        ...(opt.project ? ['--project', opt.project] : []),
        ...(opt.link ? ['--link'] : []),
        ...(opt.category ? ['--category', opt.category] : []),
        ...(opt['no-wait'] ? ['--no-wait'] : []),
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          SHREDITOR_WORKSPACE: workspace(),
          SHREDITOR_PORT: new URL(EDITOR).port,
        },
      },
    )
    if (result.status) process.exitCode = result.status
  },

  async media(ids) {
    if (!ids.length && !opt.project)
      throw new Error('Pass one or more media ids, or --project <id>')
    const cli = path.join(REPO, 'bin/shreditor.mjs')
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'media',
        ...ids,
        ...(opt.project ? ['--project', opt.project] : []),
        ...(opt.wait ? ['--wait'] : []),
        ...(opt.retry ? ['--retry'] : []),
        ...(opt.json ? ['--json'] : []),
      ],
      { stdio: 'inherit', env: { ...process.env, SHREDITOR_WORKSPACE: workspace() } },
    )
    if (result.status) process.exitCode = result.status
  },

  async qc(ids) {
    const { collectMediaIds, loadProject, readMediaMetadata, resolveMediaFile } =
      await import('../../../headless/lib/workspace.mjs')
    const mediaIds = ids.length
      ? ids
      : opt.project
        ? collectMediaIds(loadProject(workspace(), opt.project).project)
        : []
    if (!mediaIds.length) throw new Error('Pass one or more media ids, or --project <id>')
    const rows = mediaIds.map((id) => {
      const meta = readMediaMetadata(workspace(), id)
      const file = resolveMediaFile(workspace(), id, { original: true })
      return { mediaId: id, name: meta?.fileName ?? path.basename(file), ...qcMedia(meta, file) }
    })
    if (opt.json) return say(JSON.stringify(rows, null, 2))
    for (const r of rows) printQc(r)
    say(
      'Hints are prompts to look or listen, not instructions. Fix only what you can see or hear; say what you changed in the pass summary.',
    )
  },

  async effects([effectId]) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(REPO, 'headless/lib/effect-catalog.json'), 'utf8'),
    )
    const pick = catalog.filter((e) =>
      effectId ? e.id === effectId : !opt.category || e.category === opt.category,
    )
    if (!pick.length)
      throw new Error(
        effectId
          ? `No effect "${effectId}" (shred effects --category color)`
          : `No effects in category "${opt.category}"`,
      )
    if (opt.json) return say(JSON.stringify(pick, null, 2))
    for (const e of pick) {
      say(`${e.id.padEnd(26)} ${e.category.padEnd(8)} ${e.name}`)
      if (!effectId && !opt.category) continue
      for (const [key, p] of Object.entries(e.params)) {
        const range =
          p.min !== undefined ? ` ${p.min}..${p.max}` : p.options ? ` ${p.options.join('|')}` : ''
        say(
          `    ${key.padEnd(22)} ${p.type.padEnd(7)} default ${p.type === 'json' ? '(editor-managed)' : JSON.stringify(p.default)}${range}  ${p.label}`,
        )
      }
    }
  },

  async motion([sub, ...rest]) {
    const run = motionCommands({
      say,
      opt,
      workspace,
      getProject,
      applyBatch,
      baseProjectId,
      importFile: (file, projectId) => importOne(file, projectId, 'overlay'),
    })[sub]
    if (!run) throw new Error('Usage: shred motion new|add|render|list (see shred help)')
    await run(rest)
  },

  async templates(rest) {
    await templatesCommand(rest, {
      opt,
      say,
      call,
      getProject,
      warnUnsaved,
      workspace: workspace(),
    })
  },

  // Through the editor's bridge when it's up, else the same code in-process.
  async categorize(pairs) {
    if (!pairs.length)
      throw new Error('Pass <mediaId>=<category>... or --category <category> <mediaId>...')
    if (!(await editorUp())) {
      const cli = path.join(REPO, 'bin/shreditor.mjs')
      const out = execFileSync(
        process.execPath,
        [cli, 'categorize', ...pairs, ...(opt.category ? ['--category', opt.category] : [])],
        { encoding: 'utf8' },
      )
      return say(out.trim())
    }
    const clear = (c) => (c === 'none' || c === '' ? null : c)
    const items = pairs.map((arg) => {
      if (opt.category) return { mediaId: arg, category: clear(opt.category) }
      const at = arg.lastIndexOf('=')
      if (at < 1) throw new Error(`Expected <mediaId>=<category>, got ${arg}`)
      return { mediaId: arg.slice(0, at), category: clear(arg.slice(at + 1)) }
    })
    const res = await fetch(`${EDITOR}/__shreditor/media/category`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, source: 'agent' }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
    const label = (category, source) => `${category ?? 'none'}${source ? ` (${source})` : ''}`
    for (const c of body.changed)
      say(`set     ${c.mediaId}  ${label(c.from, c.fromSource)} -> ${label(c.to, c.source)}`)
    for (const u of body.unchanged) say(`same    ${u.mediaId}  ${label(u.category, u.source)}`)
  },

  async draft([id]) {
    const { project, revision } = await getProject(id)
    // Before anything is created: a refused draft must not start a pass.
    const plan = draftPlanGate({ say, opt, workspace }, id, project)
    const created = await call(
      'POST',
      '/v1/projects',
      {
        name: `${project.name} (draft)`.slice(0, 100),
        width: project.metadata?.width,
        height: project.metadata?.height,
        fps: project.metadata?.fps,
      },
      { 'Idempotency-Key': key('draft') },
    )
    const fresh = await getProject(created.id)
    const copy = {
      ...fresh.project,
      ...(project.format ? { format: project.format } : {}),
      ...(project.kit ? { kit: project.kit } : {}),
      timeline: project.timeline,
    }
    await call(
      'PUT',
      `/v1/projects/${created.id}`,
      { project: copy, expectedRevision: fresh.revision },
      { 'Idempotency-Key': key('draft-copy') },
    )
    writeDrafts({
      ...readDrafts(),
      [created.id]: {
        targetId: id,
        baseRevision: revision,
        createdAt: new Date().toISOString(),
        plan,
      },
    })
    await activity.start(id, created.id, opt.label)
    say(created.id)
  },

  async plan(rest) {
    await planCommands(planDeps()).plan(rest)
  },

  async build(rest) {
    await planCommands(planDeps()).build(rest)
  },

  async done([id]) {
    if (!id) throw new Error('Pass the draft id (or the project id)')
    const { targetId } = await activity.done(id)
    say(`Pass on ${targetId} ended without publishing; the editor lets the user edit again.`)
  },

  async apply([id, file]) {
    const body = JSON.parse(fs.readFileSync(file, 'utf8'))
    const { revision } = await getProject(id)
    await applyBatch(id, Array.isArray(body) ? body : body.ops, revision)
  },

  async kit([sub, ...rest]) {
    const run = kitCommands({ say, opt, workspace, getProject, applyBatch, call, key })[sub]
    if (!run) throw new Error('Usage: shred kit apply|status|show|save-back (see shred help)')
    await run(rest)
  },

  async styles([sub, ...rest]) {
    const run = stylesCommands({ say, opt, workspace, getProject, applyBatch })[sub ?? 'list']
    if (!run)
      throw new Error(
        'Usage: shred styles list|show|use|save|clone|import|export|remove (see shred help)',
      )
    await run(rest)
  },

  async lut([sub, ...rest]) {
    const run = LUT_COMMANDS[sub]
    if (!run)
      throw new Error('Usage: shred lut add <file.cube...> [--name x.cube] | shred lut list')
    await run(rest)
  },

  async grade([sub, ...rest]) {
    const run = GRADE_COMMANDS[sub]
    if (!run)
      throw new Error(
        'Usage: shred grade list | shred grade apply <id> <itemId...> --preset <name|id>',
      )
    await run(rest)
  },

  async frames([id]) {
    if (!opt.at) throw new Error('--at frame,frame,... is required')
    const at = opt.at
      .split(',')
      .map((x) => Number(x.trim()))
      .filter(Number.isFinite)
    const { out, revision } = await renderFrameGrid(id, at, opt.size, opt.out)
    say(`${out}  (frames ${at.join(', ')} of revision ${revision.slice(0, 19)}…; open it and look)`)
  },

  async publish([draftId, targetId]) {
    if (!opt.label) throw new Error('--label is required (one line naming the pass)')
    const origin = readDrafts()[draftId]
    if (!origin || origin.targetId !== targetId)
      throw new Error(
        `${draftId} is not a draft of ${targetId} (make one with: shred draft ${targetId})`,
      )
    await activity.beforePublish(draftId, targetId, () => userChangedSince(origin, targetId))
    const draft = await getProject(draftId)
    const target = await getProject(targetId)
    if (origin.baseRevision !== target.revision) {
      await activity.refused(draftId, targetId)
      throw new Error(
        'The project changed since this draft was taken (the user saved edits). Publishing would erase them.\nRe-read it (shred project), take a new draft, re-apply your ops on top, verify, then publish.',
      )
    }
    const changes = diffTimelines(target.project.timeline, draft.project.timeline)
    const agentDir = path.join(workspace(), 'projects', targetId, 'agent')
    const dir = path.join(agentDir, 'passes')
    fs.mkdirSync(dir, { recursive: true })
    // The open editor turns the pass into one undo step named by its label; it
    // may reload before the record below exists, so say what is coming first.
    const publishing = path.join(agentDir, 'publishing.json')
    const intent = { label: opt.label, draftId, baseRevision: target.revision }
    writeJsonAtomic(publishing, intent)
    const n = String(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length + 1).padStart(
      3,
      '0',
    )
    const recordPath = path.join(dir, `${n}.json`)
    let saved
    const writeRecord = (extra = {}) =>
      writeJsonAtomic(
        recordPath,
        passRecord({ n, draftId, origin, target, saved, changes, draft, ...extra }),
      )
    try {
      saved = await call(
        'PUT',
        `/v1/projects/${targetId}`,
        {
          project: { ...target.project, timeline: draft.project.timeline },
          expectedRevision: target.revision,
        },
        { 'Idempotency-Key': key('publish') },
      ).catch(async (error) => {
        await activity.refused(draftId, targetId)
        throw error
      })
      writeRecord()
    } finally {
      fs.rmSync(publishing, { force: true })
    }
    await activity.published(draftId, targetId, opt.label)
    // The format scorecard of what was published, kept with the pass.
    const published = { ...target.project, timeline: draft.project.timeline }
    const inputs = await scoringInputs(published)
    const kitResult = await kitCheck({ call, workspace }, draftId, draft.project, inputs.mediaById)
    const scorecard = published.format
      ? scoreProject(published, { ...inputs, targetOverrides: kitResult?.overrides })
      : null
    const kit = kitResult?.card ? { ...kitResult.card, note: kitResult.note } : null
    writeRecord({ scorecard, kit })
    await writeThumbnail(targetId, published)
    say(
      `Pass #${Number(n)} "${opt.label}" published to ${targetId}: ${changes.length} changes, revision ${saved.revision}`,
    )
    say(
      `Editor: ${EDITOR}/editor/${targetId}  (an open editor reloads it within a second; open this link if it isn't showing)`,
    )
    if (scorecard) {
      say('')
      printScorecard(scorecard, published)
      say(`(saved in ${recordPath} as "scorecard")`)
    } else say('No format on this project, so no scorecard (shred format set).')
    if (kitResult) {
      printKitCheck(say, kitResult, published.metadata?.fps ?? 30)
      say(`(saved in ${recordPath} as "kit")`)
    }
  },

  async thumbnail([id]) {
    if (!id) throw new Error('Pass a project id')
    const { project } = await getProject(id)
    const file = await writeThumbnail(
      id,
      project,
      opt.at === undefined ? undefined : Number(opt.at),
    )
    if (file) say(file)
  },

  // Final export. Native: ffmpeg renders from the ORIGINAL media and the browser
  // draws only what ffmpeg can't (text, shapes, effects...) as transparent
  // overlays; auto (default) falls back to the browser render with the reasons.
  async export([id]) {
    if (!id) throw new Error('Pass a project id')
    if (opt.native && opt.browser) throw new Error('Pass --native or --browser, not both')
    await warnUnsaved(id)
    const codec = opt.codec ?? 'h264'
    const quality = opt.quality ?? 'high'
    const dir = path.join(workspace(), 'projects', id, 'exports')
    const name = opt.out ? path.parse(opt.out).name.replace(/[^\w.-]+/g, '_') : undefined
    let output
    if (opt.browser) {
      if (codec === 'prores') throw new Error('ProRes needs the native engine')
      const { project } = await getProject(id)
      const bytes = await call('POST', '/v1/render', { project: id, codec, quality })
      const ext =
        { hevc: 'mp4', h265: 'mp4', vp9: 'webm', vp8: 'webm', av1: 'webm' }[codec] ?? 'mp4'
      fs.mkdirSync(dir, { recursive: true })
      output = path.join(dir, `${name ?? `${slug(project.name ?? id)}-browser`}.${ext}`)
      fs.writeFileSync(output, bytes)
      say('engine   browser (everything drawn in headless Chrome, media decoded by the browser)')
    } else {
      const res = await call('POST', '/v1/render', {
        project: id,
        engine: opt.native ? 'native' : 'auto',
        codec,
        quality,
        ...(name ? { out: name } : {}),
      })
      output = res.output
      if (res.engine === 'browser') {
        say('engine   browser (native export not possible):')
        for (const r of res.fallbackReasons ?? []) say(`  - ${r}`)
      } else {
        say(`engine   native (${res.codec}; ffmpeg from the original media)`)
        for (const line of res.summary ?? []) say(`  ${line}`)
        const v = res.verification
        say(
          `checked  ${v.frames} frames, ${v.seconds.toFixed(3)}s, ${v.videoCodec} ${v.pixFmt} ${v.color.matrix}/${v.color.range}${v.audio ? `, ${v.audio.codec} ${v.audio.rate} Hz ${v.audio.seconds.toFixed(3)}s` : ', no audio'}`,
        )
        say(
          `time     ${res.timings.totalSeconds.toFixed(1)}s (overlays ${res.timings.overlaySeconds.toFixed(1)}s, encode ${res.timings.encodeSeconds.toFixed(1)}s)`,
        )
      }
    }
    if (opt.out && path.dirname(opt.out) !== '.') {
      const copy = path.resolve(opt.out.replace(/^~(?=\/|$)/, os.homedir()))
      const target = path.extname(copy) ? copy : `${copy}${path.extname(output)}`
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(output, target)
      say(`copied   ${target}`)
    }
    say(output)
  },

  // Clip volume is plain gain with no limiter, so loudness targets are met here,
  // before import: ffmpeg loudnorm, measure pass then linear pass with the measured
  // values (it limits true peak itself when linear gain alone would clip).
  async master([input]) {
    if (!input) throw new Error('Pass an audio or video file')
    const src = path.resolve(input)
    if (!fs.existsSync(src)) throw new Error(`${src} does not exist`)
    const lufs = Number(opt.lufs)
    const tp = Number(opt.tp)
    if (!(lufs >= -70 && lufs <= -5)) throw new Error('--lufs must be between -70 and -5')
    if (!(tp >= -9 && tp <= 0)) throw new Error('--tp must be between -9 and 0')
    const out = path.resolve(
      opt.out ?? path.join(path.dirname(src), `${path.parse(src).name}.mastered.wav`),
    )
    if (out === src)
      throw new Error('--out must differ from the input; the original is never overwritten')
    const before = measureLoudness(src)
    if (!Number.isFinite(before.i)) throw new Error(`No measurable audio in ${src}`)
    const runLoudnorm = (filter, outArgs) => {
      const log = ffmpegLog(['-i', src, '-vn', '-af', `${filter}:print_format=json`, ...outArgs])
      return JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1))
    }
    const m = runLoudnorm(`loudnorm=I=${lufs}:TP=${tp}:LRA=11`, ['-f', 'null', '-'])
    // Linear mode needs a target range at least as wide as the source's.
    const lra = Math.min(50, Math.max(11, Math.ceil(Number(m.input_lra)) + 1))
    const rate =
      Number(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-select_streams',
            'a:0',
            '-show_entries',
            'stream=sample_rate',
            '-of',
            'csv=p=0',
            src,
          ],
          { encoding: 'utf8' },
        ).trim(),
      ) || 48000
    // loudnorm limits at 192 kHz and its limiter costs a little loudness, so the file
    // can land a hair over the ceiling or under the target. Measure the result and
    // render again with the target and ceiling nudged by the miss (max 4 tries).
    let aimI = lufs
    let ceiling = tp
    let pass2
    let after
    for (let attempt = 0; attempt < 4; attempt++) {
      pass2 = runLoudnorm(
        `loudnorm=I=${aimI}:TP=${ceiling}:LRA=${lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
        ['-ar', String(rate), '-c:a', 'pcm_s16le', '-y', out],
      )
      after = measureLoudness(out)
      const iMiss = lufs - after.i
      const tpOver = after.tp - tp
      if (Math.abs(iMiss) <= 0.3 && !(tpOver > 0)) break
      const tenth = (x) => Math.round(x * 10) / 10
      aimI = tenth(Math.min(-5, Math.max(-70, aimI + iMiss)))
      if (tpOver > 0) ceiling = tenth(Math.max(-9, ceiling - tpOver - 0.1))
    }
    const row = (name, x) =>
      `${name.padEnd(7)} ${x.i.toFixed(1).padStart(6)} LUFS integrated   ${x.tp.toFixed(1).padStart(5)} dBTP true peak   ${x.lra.toFixed(1)} LU range`
    say(row('before', before))
    say(row('after', after))
    say(
      `target  ${lufs} LUFS, true peak <= ${tp} dBTP (loudnorm ${pass2.normalization_type ?? 'two-pass'}${aimI === lufs && ceiling === tp ? '' : `, aimed ${aimI} LUFS / ceiling ${ceiling}`}; measured with ebur128)`,
    )
    if (Math.abs(after.i - lufs) > 0.5)
      say(
        `warning: integrated is ${(after.i - lufs).toFixed(1)} LU off target (very short or very dynamic source?)`,
      )
    if (after.tp > tp) say(`warning: true peak ${after.tp.toFixed(1)} dBTP is above ${tp}`)
    say(`${out}  (original untouched; import this file)`)
  },
}

// ── LUT library (<workspace>/luts/) ─────────────────────────────────────────

/**
 * The library file name for `--name` or a source file: a plain name ending in
 * .cube, with the characters the editor won't put in a file name replaced (as
 * the editor's own import does).
 */
function lutTargetName(source) {
  const unsafe = (c) => c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c)
  const name = [...(opt.name ?? path.basename(source))].map((c) => (unsafe(c) ? '_' : c)).join('')
  const withExt = /\.cube$/i.test(name) ? name : `${name}.cube`
  if (withExt.startsWith('.')) throw new Error(`--name must be a plain file name, got "${name}"`)
  return withExt
}

/** Read a .cube to add, refusing anything the editor couldn't load. */
function readCubeToAdd(file) {
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  if (!stat?.isFile()) throw new Error(`${file}: no such file`)
  if (!/\.cube$/i.test(file)) throw new Error(`${file}: not a .cube file`)
  if (stat.size > MAX_LUT_BYTES) throw new Error(`${file}: over ${MAX_LUT_BYTES} bytes`)
  const text = fs.readFileSync(file, 'utf8')
  try {
    return { file, text, header: checkCubeText(text) }
  } catch (error) {
    throw new Error(`${file}: ${error.message}`)
  }
}

function addLutFile({ file, text, header }, dir) {
  const name = lutTargetName(file)
  const target = path.join(dir, name)
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
  if (existing === text) return say(`same     ${name}  (already in the library)`)
  if (existing !== null && !opt.force)
    throw new Error(
      `luts/${name} exists with other content; pick another --name, or --force to replace it`,
    )
  fs.writeFileSync(target, text)
  const title = header.title ? `  "${header.title}"` : ''
  say(`${existing === null ? 'added   ' : 'replaced'} ${name}  ${header.size}³${title}`)
}

const LUT_COMMANDS = {
  async add(files) {
    if (!files.length) throw new Error('Pass one or more .cube files')
    if (opt.name && files.length > 1) throw new Error('--name takes one file at a time')
    const dir = path.join(workspace(), LUTS_DIR)
    // Check every file before copying any.
    const checked = files.map(readCubeToAdd)
    fs.mkdirSync(dir, { recursive: true })
    for (const lut of checked) addLutFile(lut, dir)
    say(`Apply one with {"op":"addLut","itemId":"…","lut":"<name>","intensity":1}`)
  },

  async list() {
    const dir = path.join(workspace(), LUTS_DIR)
    const luts = listLutNames(workspace()).map((name) => ({
      name,
      ...readCubeFileHeader(path.join(dir, name)),
    }))
    if (opt.json) return say(JSON.stringify(luts, null, 2))
    if (!luts.length) return say(`No LUTs in ${dir} (shred lut add <file.cube>)`)
    for (const l of luts)
      say(
        `${l.name.padEnd(36)} ${(l.oneDimensional ? '1D' : `${l.size}³`).padEnd(6)} ${l.title ?? ''}`,
      )
  },
}

// ── Grade presets (<workspace>/app/effect-presets.json, owned by the editor) ──

/** The colour (grade) effect ids: what the editor's grade presets replace. */
function gradeEffectTypes() {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(REPO, 'headless/lib/effect-catalog.json'), 'utf8'),
  )
  return new Set(catalog.filter((e) => e.category === 'color').map((e) => e.id))
}

function readGradePresets() {
  const file = readJsonOrNull(path.join(workspace(), 'app', 'effect-presets.json'))
  return (file?.presets ?? []).filter((p) => p?.id && p?.name && Array.isArray(p.effects))
}

function findGradePreset(wanted) {
  const presets = readGradePresets()
  const preset =
    presets.find((p) => p.id === wanted) ??
    presets.find((p) => p.name.toLowerCase() === wanted.toLowerCase())
  if (preset) return preset
  const have = presets.map((p) => `"${p.name}"`).join(', ') || 'none saved yet'
  throw new Error(`No grade preset "${wanted}" (presets: ${have}; shred grade list)`)
}

const isGradeEffect = (effect, types) =>
  effect?.type === 'gpu-effect' && types.has(effect.gpuEffectType)

/** Ops that do to one item what the editor's applyGradePresetToEffectStack does. */
function gradeOpsForItem(project, itemId, gradeEffects, types) {
  const item = project.timeline?.items?.find((i) => i.id === itemId)
  if (!item) throw new Error(`No item ${itemId} in this project (shred project <id>)`)
  if (item.type === 'audio') throw new Error(`${itemId} is an audio item; grades go on picture`)
  const removals = (item.effects ?? [])
    .filter((entry) => isGradeEffect(entry.effect, types))
    .map((entry) => ({ op: 'removeEffect', itemId, effectId: entry.id }))
  const additions = gradeEffects.map((effect) => ({
    op: 'addEffect',
    itemId,
    effect: {
      type: 'gpu-effect',
      gpuEffectType: effect.gpuEffectType,
      params: effect.params ?? {},
    },
  }))
  return [...removals, ...additions]
}

const GRADE_COMMANDS = {
  async list() {
    const types = gradeEffectTypes()
    const presets = readGradePresets()
    if (opt.json) return say(JSON.stringify(presets, null, 2))
    if (!presets.length)
      return say('No grade presets saved yet (the user saves them in the editor’s Color panel).')
    for (const p of presets) {
      const effects = p.effects.map((e) => e.gpuEffectType)
      const grade = p.effects.some((e) => isGradeEffect(e, types))
      say(
        `${p.name.padEnd(28)} ${p.id}  ${effects.join(', ')}${grade ? '' : '  (no colour effects: nothing to apply)'}`,
      )
    }
  },

  async apply([id, ...itemIds]) {
    if (!id || !itemIds.length || !opt.preset)
      throw new Error('Usage: shred grade apply <id> <itemId...> --preset <name|id>')
    const types = gradeEffectTypes()
    const preset = findGradePreset(opt.preset)
    const gradeEffects = preset.effects.filter((e) => isGradeEffect(e, types))
    if (!gradeEffects.length) throw new Error(`Preset "${preset.name}" has no colour effects`)
    const { project, revision } = await getProject(id)
    const ops = itemIds.flatMap((itemId) => gradeOpsForItem(project, itemId, gradeEffects, types))
    say(`preset "${preset.name}": ${gradeEffects.map((e) => e.gpuEffectType).join(', ')}`)
    await applyBatch(id, ops, revision)
  },
}

function printQc(r) {
  say(`${r.mediaId}  ${r.name}${r.category ? `  [${r.category}]` : ''}`)
  if (r.skipped) return say(`  (${r.skipped}: not measured)`)
  const s = r.sound
  say(
    s
      ? `  sound    peak ${s.peakDb.toFixed(1)} dBFS  voice ~${s.speechDb.toFixed(0)}  pauses ~${s.noiseFloorDb.toFixed(0)} dBFS  <80 Hz ${(s.lowRmsDb - s.rmsDb).toFixed(0)} dB  >5 kHz ${(s.airRmsDb - s.rmsDb).toFixed(0)} dB`
      : '  sound    none',
  )
  const p = r.picture
  if (p)
    say(
      `  picture  shadows ${p.shadows}  mids ${p.mids.toFixed(0)}  highlights ${p.highlights}  (16-235)  saturation ${p.saturation.toFixed(0)}  cast u ${p.u.toFixed(1)} v ${p.v.toFixed(1)}`,
    )
  for (const h of r.hints) say(`  - ${h}`)
  if (!r.hints.length) say('  - nothing stands out')
}

function ffmpegLog(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0)
    throw new Error(`ffmpeg failed: ${r.stderr.trim().split('\n').slice(-3).join(' ')}`)
  return r.stderr
}

/** Integrated loudness, true peak and loudness range from ffmpeg's ebur128 summary. */
function measureLoudness(file) {
  const log = ffmpegLog([
    '-i',
    file,
    '-vn',
    '-filter_complex',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ])
  const summary = log.slice(log.lastIndexOf('Summary:'))
  const num = (re) => Number(re.exec(summary)?.[1] ?? Number.NaN)
  return {
    i: num(/I:\s+(-?[\d.]+|-inf) LUFS/),
    tp: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/),
    lra: num(/LRA:\s+(-?[\d.]+) LU/),
  }
}

try {
  const fn = commands[command]
  if (!fn) {
    const lines = fs
      .readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(1)
    say(
      lines
        .slice(
          0,
          lines.findIndex((l) => !l.startsWith('//')),
        )
        .map((l) => l.replace(/^\/\/ ?/, ''))
        .join('\n'),
    )
    process.exit(command ? 1 : 0)
  }
  await activity.preflight(command, [...args, opt.project])
  await fn(args)
} catch (error) {
  process.stderr.write(`shred: ${error.message}\n`)
  process.exit(1)
}
