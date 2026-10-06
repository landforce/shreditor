#!/usr/bin/env node
// The one way an agent touches a Shreditor project. Every engine call in the
// shreditor-edit skill goes through here, so edits are consistent and checked.
//
//   shred up                             start the editor (5273) and the agent service (8787)
//   shred start                          start only the agent edit service
//   shred status                         editor, service, workspace and writer-lock state
//   shred catalog <folder|file...> --name <slug> [--no-transcribe] [--no-proxies]
//                                        probe, contact-sheet, transcribe, and make playable proxies
//   shred new --name "..." [--size 1080x1920] [--fps 30]   create a project; prints id and editor URL
//   shred project <id>                   timeline summary (tracks, items, frames)
//   shred import <file...> --project <id> [--category <c>]   bring footage in (clone/link in place)
//   shred categorize <mediaId>=<category>... | --category <c> <mediaId>...
//                                        set what each media is for; the editor groups by it
//   shred draft <id>                     copy a project to a private draft; prints the draft id
//   shred apply <id> <ops.json>          apply an op batch atomically (revision-checked)
//   shred frames <id> --at 30,95,... [--out grid.jpg] [--size 270x480]
//                                        render saved frames and tile them for review
//   shred publish <draftId> <targetId> --label "..." --summary <file.md>
//                                        hand the finished draft to the user's project as one pass
//   shred changes <id>                   what the user changed since the last published pass
//
// Service: 127.0.0.1:8787 (SHRED_SERVICE to override). Times are frames at the
// project fps. Ops reference earlier results with {"$ref":"<callerId>#/detail/..."}.
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SERVICE = process.env.SHRED_SERVICE || 'http://127.0.0.1:8787'
const say = (line = '') => process.stdout.write(`${line}\n`)
process.stdout.on('error', (e) => e.code === 'EPIPE' && process.exit(0))

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    at: { type: 'string' },
    out: { type: 'string' },
    size: { type: 'string' },
    name: { type: 'string' },
    fps: { type: 'string', default: '30' },
    'no-transcribe': { type: 'boolean' },
    'no-proxies': { type: 'boolean' },
    label: { type: 'string' },
    summary: { type: 'string' },
    link: { type: 'boolean' },
    category: { type: 'string' },
    build: { type: 'boolean' },
    json: { type: 'boolean' },
  },
})
const [command, ...args] = positionals

function workspace() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.shreditor/config.json'), 'utf8'))
    if (config.workspace) return config.workspace
  } catch {}
  return path.join(os.homedir(), 'Movies', 'Shreditor')
}

async function call(method, route, body, headers = {}) {
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
    const fields = (e.fields ?? []).map((f) => `  ${f.path?.join?.('.') ?? f.path}: ${f.message}`).join('\n')
    throw new Error(`${method} ${route}: ${e.code ?? res.status} ${e.message ?? ''}${fields ? `\n${fields}` : ''}`)
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

const EDITOR = process.env.SHRED_EDITOR || 'http://localhost:5273'
const editorUp = async () => {
  try {
    return (await fetch(`${EDITOR}/__shreditor/info`)).ok
  } catch {
    return false
  }
}
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'footage'
const MEDIA_EXT = /\.(mov|mp4|m4v|mkv|webm|avi|mts|mxf|wav|mp3|m4a|aac|aif|aiff|flac|png|jpe?g|webp|heic|gif)$/i
const WHISPER_MODEL = path.join(os.homedir(), 'Library/Application Support/whisper.cpp/models/ggml-large-v3-turbo.bin')
const which = (bin) => {
  try {
    return execFileSync('which', [bin], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

// Whisper invents these on non-speech audio (music, typing, room tone).
const WHISPER_PHANTOMS = new Set(['thank you', 'thanks', 'thank you very much', 'thanks for watching', 'thank you for watching', 'you', 'bye', 'bye bye', 'music', 'applause', 'laughter', 'silence', 'subtitles by the amara org community', 'please subscribe'])
const isPhantomSpeech = (text, seconds) => {
  const t = text.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (WHISPER_PHANTOMS.has(t)) return true
  const words = t.split(' ').length
  return words <= 2 && seconds > 3
}

const key = (tag) => `${tag}-${crypto.randomUUID()}`
const getProject = (id) => call('GET', `/v1/projects/${encodeURIComponent(id)}`)

async function health() {
  try {
    return await call('GET', '/health')
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

// Items keyed by id: added, removed, changed (timing, source, text, transform, other).
function diffTimelines(before, after) {
  const b = new Map((before?.items ?? []).map((i) => [i.id, i]))
  const a = new Map((after?.items ?? []).map((i) => [i.id, i]))
  const out = []
  const name = (i) => i.label || i.text || `${i.type} ${i.id}`
  for (const [id, item] of a) {
    const old = b.get(id)
    if (!old) {
      out.push({ id, kind: 'added', name: name(item), type: item.type, from: item.from, frames: item.durationInFrames })
      continue
    }
    const fields = []
    if (old.from !== item.from || old.durationInFrames !== item.durationInFrames || old.trackId !== item.trackId) fields.push('timing')
    if (old.sourceStart !== item.sourceStart || old.sourceEnd !== item.sourceEnd) fields.push('source')
    if (old.text !== item.text) fields.push('text')
    if (JSON.stringify(old.transform) !== JSON.stringify(item.transform)) fields.push('frame')
    const rest = (i) => JSON.stringify({ ...i, from: 0, durationInFrames: 0, trackId: 0, sourceStart: 0, sourceEnd: 0, text: 0, transform: 0 })
    if (rest(old) !== rest(item)) fields.push('other')
    if (fields.length) out.push({ id, kind: 'changed', name: name(item), type: item.type, from: item.from, frames: item.durationInFrames, fields })
  }
  for (const [id, item] of b) if (!a.has(id)) out.push({ id, kind: 'removed', name: name(item), type: item.type, from: item.from, frames: item.durationInFrames })
  return out.sort((x, y) => x.from - y.from)
}

const commands = {
  async up() {
    if (!(await editorUp())) {
      const log = path.join(os.tmpdir(), 'shreditor-editor.log')
      const child = spawn('npm', ['run', 'dev', '--', '--port', new URL(EDITOR).port, '--strictPort'], {
        cwd: REPO,
        detached: true,
        stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')],
      })
      child.unref()
      for (let i = 0; i < 120 && !(await editorUp()); i++) await new Promise((r) => setTimeout(r, 1000))
      if (!(await editorUp())) throw new Error(`Editor did not start; see ${log}`)
    }
    say(`Editor   ${EDITOR}`)
    await commands.start()
  },

  async new() {
    if (!opt.name) throw new Error('--name is required')
    const [width, height] = (opt.size ?? '1080x1920').split('x').map(Number)
    const created = await call('POST', '/v1/projects', { name: opt.name, width, height, fps: Number(opt.fps) }, { 'Idempotency-Key': key('new') })
    fs.mkdirSync(path.join(workspace(), 'projects', created.id, 'agent', 'passes'), { recursive: true })
    say(created.id)
    say(`${EDITOR}/editor/${created.id}`)
  },

  async catalog(inputs) {
    if (!inputs.length) throw new Error('Pass a folder or files')
    const files = inputs.flatMap((p) => {
      const full = path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()))
      if (fs.statSync(full).isDirectory()) {
        return fs.readdirSync(full).filter((f) => MEDIA_EXT.test(f) && !f.startsWith('.')).sort().map((f) => path.join(full, f))
      }
      return [full]
    })
    const name = opt.name ?? slug(path.basename(path.resolve(inputs[0])))
    const dir = path.join(workspace(), 'catalogs', name)
    fs.mkdirSync(path.join(dir, 'sheets'), { recursive: true })
    const transcribe = !opt['no-transcribe'] && which('whisper-cli') && fs.existsSync(WHISPER_MODEL)
    const entries = []
    for (const file of files) {
      // Extension included: floor-plan.png and floor-plan.mov must not share a sheet.
      const base = slug(path.basename(file))
      let probe
      try {
        probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt', '-of', 'json', file], { encoding: 'utf8' }))
      } catch {
        entries.push({ file, error: 'ffprobe could not read it' })
        continue
      }
      const v = probe.streams.find((x) => x.codec_type === 'video')
      const a = probe.streams.find((x) => x.codec_type === 'audio')
      const duration = Number(probe.format?.duration ?? 0)
      const [fn, fd] = (v?.r_frame_rate ?? '0/1').split('/').map(Number)
      const isStill = Boolean(v) && (!duration || /png|mjpeg|jpe?g|webp|heic|gif/i.test(v.codec_name) && duration < 0.2)
      const entry = {
        file,
        kind: v ? (isStill ? 'image' : 'video') : 'audio',
        duration: Math.round(duration * 1000) / 1000,
        ...(v ? { width: v.width, height: v.height, fps: fd ? Math.round((fn / fd) * 1000) / 1000 : 0, codec: v.codec_name, alpha: /^(yuva|rgba|argb|bgra|abgr|gbrap|ya)/.test(v.pix_fmt ?? '') } : {}),
        ...(a ? { audio: a.codec_name } : {}),
        browserPlayable: !v || isStill || ['h264', 'hevc', 'vp9', 'av1', 'vp8'].includes(v.codec_name),
      }
      if (v) {
        const sheet = path.join(dir, 'sheets', `${base}.jpg`)
        const vf = isStill ? 'scale=320:-2' : `fps=8/${Math.max(duration, 0.5)},scale=180:320:force_original_aspect_ratio=decrease,pad=180:320:-1:-1:color=gray,tile=8x1:padding=3`
        try {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', vf, '-frames:v', '1', sheet])
          entry.sheet = sheet
        } catch {}
      }
      // Browsers can't decode ProRes, PNG-codec .mov and similar: make a playable copy.
      // Transparent clips become VP9 WebM with alpha so they stay separate layers.
      if (v && !isStill && !entry.browserPlayable && !opt['no-proxies']) {
        const proxyDir = path.join(dir, 'proxies')
        fs.mkdirSync(proxyDir, { recursive: true })
        const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
        const proxy = path.join(proxyDir, `${base}.${entry.alpha ? 'webm' : 'mp4'}`)
        const args = entry.alpha
          ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '20', '-row-mt', '1', '-auto-alt-ref', '0', ...(a ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-an'])]
          : ['-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...(a ? ['-c:a', 'aac', '-b:a', '256k'] : ['-an'])]
        try {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', even, ...args, proxy])
          entry.proxy = proxy
        } catch {
          entry.proxyError = 'ffmpeg could not make a playable copy'
        }
      }
      if (transcribe && a && duration > 1) {
        const wav = path.join(os.tmpdir(), `shred-${crypto.randomUUID()}.wav`)
        const outBase = path.join(dir, 'transcripts', base)
        fs.mkdirSync(path.dirname(outBase), { recursive: true })
        try {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav])
          execFileSync('whisper-cli', ['-m', WHISPER_MODEL, '-f', wav, '-oj', '-osrt', '-of', outBase, '-np'], { stdio: 'ignore' })
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
      entries.push(entry)
      say(`${entry.kind.padEnd(5)} ${String(entry.duration).padStart(7)}s  ${path.basename(file)}${entry.browserPlayable ? '' : entry.proxy ? `  → proxy ${path.basename(entry.proxy)}${entry.alpha ? ' (alpha)' : ''}` : '  (not playable; no proxy made)'}${entry.speechNote ? '  (no speech)' : ''}${entry.speech ? `  "${entry.speech.slice(0, 60)}…"` : ''}`)
    }
    const out = path.join(dir, 'catalog.json')
    fs.writeFileSync(out, `${JSON.stringify({ name, createdAt: new Date().toISOString(), sources: inputs.map((p) => path.resolve(p)), entries }, null, 2)}\n`)
    say(`\n${entries.length} items → ${out}`)
    say(`Contact sheets in ${path.join(dir, 'sheets')}: open them and write what each shot shows into catalog.json ("content", "usable").`)
    say('Import an entry\'s "proxy" instead of its file when it has one (originals are untouched).')
  },

  async changes([id]) {
    const dir = path.join(workspace(), 'projects', id, 'agent', 'passes')
    const passes = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []
    if (!passes.length) return say('No published passes yet.')
    const last = JSON.parse(fs.readFileSync(path.join(dir, passes.at(-1)), 'utf8'))
    const { revision, project } = await getProject(id)
    if (revision === last.resultRevision) return say(`No changes since pass #${Number(last.id)} "${last.label}".`)
    const diff = diffTimelines(last.timeline, project.timeline)
    if (opt.json) return say(JSON.stringify({ since: last.id, revision, diff }, null, 2))
    say(`Since pass #${Number(last.id)} "${last.label}" the user changed ${diff.length} item(s). Treat these as decisions:`)
    for (const d of diff) say(`  ${d.kind.padEnd(7)} ${String(d.from).padStart(5)}  ${d.name}${d.fields ? `  (${d.fields.join(', ')})` : ''}`)
    const notes = path.join(workspace(), 'projects', id, 'agent', 'notes.json')
    if (fs.existsSync(notes)) say(`Notes from the user: ${notes}`)
  },

  async start() {
    if (await health()) return say(`Service already running at ${SERVICE}`)
    const ws = workspace()
    const log = path.join(os.tmpdir(), 'shreditor-service.log')
    // The service renders and edits through the built app; rebuild after code changes.
    if (opt.build || !fs.existsSync(path.join(REPO, 'dist', 'headless.html'))) {
      say('Building Shreditor…')
      execFileSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'ignore' })
    }
    const child = spawn(process.execPath, [path.join(REPO, 'headless/serve.mjs'), '--workspace', ws, '--port', new URL(SERVICE).port], {
      cwd: REPO,
      detached: true,
      stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')],
    })
    child.unref()
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      if (await health()) return say(`Service running at ${SERVICE} on ${ws} (log: ${log})`)
    }
    throw new Error(`Service did not start; see ${log}`)
  },

  async status() {
    const h = await health()
    const ws = workspace()
    say(`workspace  ${ws}`)
    say(`editor     ${(await editorUp()) ? EDITOR : 'down (run: shred up)'}`)
    say(`service    ${h ? `up, GPU ${h.gpu?.available ? 'yes' : 'no'}` : 'down (run: shred start)'}`)
    const lock = path.join(ws, '.freecut-headless', 'writer.lock')
    say(`writer     ${fs.existsSync(lock) ? 'locked by the service (imports go through `shred import`)' : 'free'}`)
  },

  async project([id]) {
    const { revision, project } = await getProject(id)
    const s = summarize(project)
    if (opt.json) return say(JSON.stringify({ revision, ...s }, null, 2))
    say(`${project.name}  ${project.metadata?.width}x${project.metadata?.height} @${s.fps}  ${s.end} frames (${(s.end / s.fps).toFixed(2)}s)`)
    say(`revision ${revision}`)
    for (const t of [...s.tracks].sort((x, y) => x.order - y.order)) {
      say(`\n${t.name} (${t.kind ?? 'track'} ${t.id})`)
      for (const i of s.items.filter((x) => x.trackId === t.id).sort((x, y) => x.from - y.from)) {
        const src = i.sourceStart !== undefined ? `  src ${i.sourceStart}-${i.sourceEnd}` : ''
        say(`  ${String(i.from).padStart(5)}-${String(i.from + i.durationInFrames).padEnd(5)} ${i.type.padEnd(6)} ${i.label ?? i.text ?? ''}${src}  [${i.id}]`)
      }
    }
  },

  async import(files) {
    if (!files.length) throw new Error('Pass one or more file paths')
    const cli = path.join(REPO, 'bin/shreditor.mjs')
    const out = execFileSync(process.execPath, [cli, 'import', ...files, ...(opt.project ? ['--project', opt.project] : []), ...(opt.link ? ['--link'] : []), ...(opt.category ? ['--category', opt.category] : [])], { encoding: 'utf8' })
    say(out.trim())
  },

  // Through the editor's bridge when it's up, else the same code in-process.
  async categorize(pairs) {
    if (!pairs.length) throw new Error('Pass <mediaId>=<category>... or --category <category> <mediaId>...')
    if (!(await editorUp())) {
      const cli = path.join(REPO, 'bin/shreditor.mjs')
      const out = execFileSync(process.execPath, [cli, 'categorize', ...pairs, ...(opt.category ? ['--category', opt.category] : [])], { encoding: 'utf8' })
      return say(out.trim())
    }
    const clear = (c) => (c === 'none' || c === '' ? null : c)
    const items = pairs.map((arg) => {
      if (opt.category) return { mediaId: arg, category: clear(opt.category) }
      const at = arg.lastIndexOf('=')
      if (at < 1) throw new Error(`Expected <mediaId>=<category>, got ${arg}`)
      return { mediaId: arg.slice(0, at), category: clear(arg.slice(at + 1)) }
    })
    const res = await fetch(`${EDITOR}/__shreditor/media/category`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) })
    const body = await res.json()
    if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
    for (const c of body.changed) say(`set     ${c.mediaId}  ${c.from ?? 'none'} -> ${c.to ?? 'none'}`)
    for (const u of body.unchanged) say(`same    ${u.mediaId}  ${u.category ?? 'none'}`)
  },

  async draft([id]) {
    const { project, revision } = await getProject(id)
    const created = await call('POST', '/v1/projects', { name: `${project.name} (draft)`.slice(0, 100), width: project.metadata?.width, height: project.metadata?.height, fps: project.metadata?.fps }, { 'Idempotency-Key': key('draft') })
    const fresh = await getProject(created.id)
    await call('PUT', `/v1/projects/${created.id}`, { project: { ...fresh.project, timeline: project.timeline }, expectedRevision: fresh.revision }, { 'Idempotency-Key': key('draft-copy') })
    writeDrafts({ ...readDrafts(), [created.id]: { targetId: id, baseRevision: revision, createdAt: new Date().toISOString() } })
    say(created.id)
  },

  async apply([id, file]) {
    const body = JSON.parse(fs.readFileSync(file, 'utf8'))
    const ops = (Array.isArray(body) ? body : body.ops).map((op, i) => ({ callerId: `op${i}`, ...op }))
    const { revision } = await getProject(id)
    let res
    try {
      res = await call('POST', `/v1/projects/${id}/edit`, { ops, expectedRevision: revision, persist: true }, { 'Idempotency-Key': key('apply') })
    } catch (error) {
      const log = path.join(os.tmpdir(), 'shreditor-service.log')
      const tail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => /Error|failed/.test(l)).slice(-3).join('\n') : ''
      throw new Error(`${error.message}${tail ? `\nservice log:\n${tail}` : ''}\nNothing was applied (batches are atomic).`)
    }
    say(`applied ${res.applied} ops, revision ${res.revision}`)
    for (const w of res.warnings ?? []) say(`warning: ${typeof w === 'string' ? w : JSON.stringify(w)}`)
  },

  async frames([id]) {
    if (!opt.at) throw new Error('--at frame,frame,... is required')
    const [w, h] = (opt.size ?? '270x480').split('x').map(Number)
    const at = opt.at.split(',').map((x) => Number(x.trim())).filter(Number.isFinite)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-frames-'))
    const { revision } = await getProject(id)
    for (const frame of at) {
      const bytes = await call('POST', '/frame', { project: id, frame, width: w, height: h, format: 'jpeg' })
      fs.writeFileSync(path.join(dir, `f${String(frame).padStart(6, '0')}.jpg`), bytes)
    }
    const out = path.resolve(opt.out ?? path.join(dir, 'grid.jpg'))
    const cols = Math.min(at.length, 10)
    const rows = Math.ceil(at.length / cols)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-pattern_type', 'glob', '-i', path.join(dir, 'f*.jpg'), '-vf', `tile=${cols}x${rows}:padding=4:color=gray`, '-frames:v', '1', out])
    say(`${out}  (frames ${at.join(', ')} of revision ${revision.slice(0, 19)}…; open it and look)`)
  },

  async publish([draftId, targetId]) {
    if (!opt.label) throw new Error('--label is required (one line naming the pass)')
    const summary = opt.summary ? fs.readFileSync(opt.summary, 'utf8').trim() : ''
    const draft = await getProject(draftId)
    const target = await getProject(targetId)
    const origin = readDrafts()[draftId]
    if (!origin || origin.targetId !== targetId) throw new Error(`${draftId} is not a draft of ${targetId} (make one with: shred draft ${targetId})`)
    if (origin.baseRevision !== target.revision) {
      throw new Error('The project changed since this draft was taken (the user saved edits). Publishing would erase them.\nRe-read it (shred project), take a new draft, re-apply your ops on top, verify, then publish.')
    }
    const changes = diffTimelines(target.project.timeline, draft.project.timeline)
    const saved = await call('PUT', `/v1/projects/${targetId}`, { project: { ...target.project, timeline: draft.project.timeline }, expectedRevision: target.revision }, { 'Idempotency-Key': key('publish') })
    const dir = path.join(workspace(), 'projects', targetId, 'agent', 'passes')
    fs.mkdirSync(dir, { recursive: true })
    const n = String(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length + 1).padStart(3, '0')
    const record = { id: n, label: opt.label, summary, by: 'agent', status: 'review', createdAt: new Date().toISOString(), draftId, baseRevision: target.revision, resultRevision: saved.revision, changes, timeline: draft.project.timeline }
    fs.writeFileSync(path.join(dir, `${n}.json`), `${JSON.stringify(record, null, 2)}\n`)
    say(`Pass #${Number(n)} "${opt.label}" published to ${targetId}: ${changes.length} changes, revision ${saved.revision}`)
    say(`Editor: ${EDITOR}/editor/${targetId}  (an open editor reloads it within a second; open this link if it isn't showing)`)
  },
}

try {
  const fn = commands[command]
  if (!fn) {
    const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1)
    say(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    process.exit(command ? 1 : 0)
  }
  await fn(args)
} catch (error) {
  process.stderr.write(`shred: ${error.message}\n`)
  process.exit(1)
}
