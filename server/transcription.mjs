// Native transcription: every imported clip with an audio stream is
// transcribed in the background by whisper.cpp (`whisper-cli`), locally, and
// stored in FreeCut's own transcript store (media/{id}/cache/ai/transcript.json)
// so the editor's transcript panel, captions and transcript cuts and the
// agent (`shred transcript`) all read the same words.
//
// Flow: import -> autoTranscribe() -> queue (one job at a time) -> wait for the
// source -> ffprobe -> ffmpeg to 16 kHz mono WAV from the ORIGINAL media ->
// silence check -> whisper-cli --output-json-full -> tokens merged into
// words, phantom speech dropped -> envelope written atomically.
// Status lives in media/{id}/metadata.json as
//   transcription: { status, engine, model, language?, updatedAt, error?, hint?, reason? }
// with status queued | running | done | none | failed | unavailable.
//
// Settings (optional) in ~/.shreditor/config.json (or $SHREDITOR_CONFIG):
//   "transcription": { "enabled": true, "whisperCli": "whisper-cli",
//     "model": "~/Library/Application Support/whisper.cpp/models/ggml-large-v3-turbo.bin",
//     (the default on a Mac; ~/.local/share/whisper.cpp/models/ on Linux,
//     %LOCALAPPDATA%\whisper.cpp\models\ on Windows: see server/platform.mjs)
//     "language": "auto", "threads": 4 }
// $SHREDITOR_WHISPER_CLI and $SHREDITOR_WHISPER_MODEL override them.
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveMediaFile } from '../headless/lib/workspace.mjs'
import {
  buildTranscriptEnvelope,
  canAutoWrite,
  canTransition,
  dtwPreset,
  NATIVE_SOURCE,
  segmentsFromWhisperJson,
} from './transcription-core.mjs'
import { defaultModelPath, executableNames, extraToolDirs } from './platform.mjs'

export const DEFAULT_MODEL_PATH = defaultModelPath()
const MAX_QUEUE = 64
const SOURCE_WAIT_MS = 120_000
const PROBE_TIMEOUT_MS = 30_000
const EXTRACT_TIMEOUT_MS = 10 * 60_000
const SILENCE_DB = -50
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const INSTALL_HINT = 'Native transcription needs whisper.cpp and its model: run `shred setup` (it says how to install whisper-cli here, then downloads the model). In-app transcription still works.'

class TranscriptionError extends Error {
  constructor(status, name, message) {
    super(message)
    this.status = status
    this.name = name
  }
}

/* ───────────────────────────── Settings ──────────────────────────────── */

const expandHome = (p) => String(p).replace(/^~(?=$|[\\/])/, os.homedir())

export function transcriptionConfig() {
  let settings = {}
  try {
    const file = process.env.SHREDITOR_CONFIG || path.join(os.homedir(), '.shreditor', 'config.json')
    settings = JSON.parse(fs.readFileSync(file, 'utf8')).transcription ?? {}
  } catch {
    // no config file: defaults
  }
  return {
    enabled: settings.enabled !== false,
    whisperCli: expandHome(process.env.SHREDITOR_WHISPER_CLI || settings.whisperCli || 'whisper-cli'),
    model: path.resolve(expandHome(process.env.SHREDITOR_WHISPER_MODEL || settings.model || DEFAULT_MODEL_PATH)),
    language: typeof settings.language === 'string' && settings.language ? settings.language : 'auto',
    threads: Number.isInteger(settings.threads) && settings.threads > 0 ? settings.threads : Math.min(8, Math.max(1, os.cpus().length)),
  }
}

/** Absolute path of an executable (a path, or a name searched on PATH), or null. */
export function findExecutable(command) {
  const names = executableNames(command)
  const candidates = /[\\/]/.test(command)
    ? names
    : [...String(process.env.PATH ?? '').split(path.delimiter), ...extraToolDirs()].filter(Boolean).flatMap((dir) => names.map((name) => path.join(dir, name)))
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

let versionCache = null
async function engineVersion(cli) {
  if (versionCache?.cli === cli) return versionCache.version
  const out = await run(cli, ['--version'], { timeout: 15_000 }).catch((error) => error)
  const version = /version:?\s*v?([\d.]+)/i.exec(`${out.stdout ?? ''}${out.stderr ?? ''}`)?.[1] ?? null
  versionCache = { cli, version }
  return version
}

/** What native transcription would use right now, and whether it can run. */
export async function engineInfo() {
  const config = transcriptionConfig()
  const cli = findExecutable(config.whisperCli)
  const ffmpeg = findExecutable('ffmpeg')
  const ffprobe = findExecutable('ffprobe')
  const modelSize = fs.statSync(config.model, { throwIfNoEntry: false })?.size ?? 0
  const missing = [
    ...(cli ? [] : [`whisper-cli (${config.whisperCli})`]),
    ...(modelSize > 0 ? [] : [`model (${config.model})`]),
    ...(ffmpeg ? [] : ['ffmpeg']),
    ...(ffprobe ? [] : ['ffprobe']),
  ]
  return {
    enabled: config.enabled,
    available: config.enabled && missing.length === 0,
    engine: NATIVE_SOURCE,
    version: cli ? await engineVersion(cli) : null,
    whisperCli: cli ?? config.whisperCli,
    model: config.model,
    modelName: modelName(config.model),
    modelBytes: modelSize,
    language: config.language,
    missing,
    ...(missing.length ? { hint: INSTALL_HINT } : {}),
    local: true,
  }
}

const modelName = (file) => path.basename(file).replace(/\.bin$/, '')

/* ─────────────────────────── Process helper ──────────────────────────── */

function run(command, args, { signal, timeout = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { signal, timeout, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr })
      const reason = signal?.aborted ? 'cancelled' : error.code === 'ENOENT' ? 'not found' : error.killed ? `timed out after ${Math.round(timeout / 1000)}s` : String(stderr || error.message).trim().split('\n').slice(-2).join(' ')
      const wrapped = new Error(`${path.basename(command)}: ${reason}`)
      wrapped.code = signal?.aborted ? 'ABORTED' : error.code === 'ENOENT' ? 'TOOL_MISSING' : 'FAILED'
      wrapped.stdout = stdout
      wrapped.stderr = stderr
      reject(wrapped)
    })
  })
}

/* ──────────────────────────── Workspace files ─────────────────────────── */

const mediaDir = (root, mediaId) => path.join(root, 'media', mediaId)
const metadataFile = (root, mediaId) => path.join(mediaDir(root, mediaId), 'metadata.json')
export const transcriptFile = (root, mediaId) => path.join(mediaDir(root, mediaId), 'cache', 'ai', 'transcript.json')
const legacyTranscriptFile = (root, mediaId) => path.join(mediaDir(root, mediaId), 'cache', 'transcript.json')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// Never recreates a media folder that was deleted meanwhile: callers create
// only folders inside an existing media/{id}/.
function writeJsonAtomic(target, value) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`)
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
    fs.renameSync(tmp, target)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

function assertMediaId(mediaId) {
  if (typeof mediaId !== 'string' || !ID_PATTERN.test(mediaId)) throw new TranscriptionError(400, 'TypeError', 'Invalid mediaId')
}

/** Stored transcript envelope (or legacy record), or null. */
export function readStoredTranscript(root, mediaId) {
  assertMediaId(mediaId)
  const envelope = readJson(transcriptFile(root, mediaId))
  if (envelope?.data) return envelope
  const legacy = readJson(legacyTranscriptFile(root, mediaId))
  return legacy ? { legacy: true, service: 'whisper', data: legacy } : null
}

/**
 * The workspace media imported from `file` (same name, size and modified time,
 * or a link to it) with its transcript, status and category, or null. Lets
 * `shred catalog` reuse the built-in transcript instead of running whisper
 * again, and show the category (and whether it is only a suggestion).
 */
export function transcriptForFile(root, file) {
  let real
  try {
    real = fs.realpathSync(file)
  } catch {
    return null
  }
  const st = fs.statSync(real)
  const name = path.basename(file)
  let entries = []
  try {
    entries = fs.readdirSync(path.join(root, 'media'), { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue
    const metadata = readJson(metadataFile(root, entry.name))
    if (!metadata) continue
    const link = readJson(path.join(mediaDir(root, entry.name), 'source.link.json'))
    const same = link?.path === real || (metadata.fileName === name && metadata.fileSize === st.size && Math.round(metadata.fileLastModified ?? -1) === Math.round(st.mtimeMs))
    if (!same) continue
    const envelope = readStoredTranscript(root, entry.name)
    return {
      mediaId: entry.name,
      status: metadata.transcription ?? null,
      envelope,
      path: envelope ? transcriptFile(root, entry.name) : null,
      category: metadata.category ?? null,
      categorySource: metadata.categorySource ?? null,
    }
  }
  return null
}

export function readTranscriptionStatus(root, mediaId) {
  assertMediaId(mediaId)
  return readJson(metadataFile(root, mediaId))?.transcription ?? null
}

/**
 * Update `transcription` in media/{id}/metadata.json. A no-op (false) when the
 * media is gone or the transition is not allowed; never creates the folder.
 * `status: null` removes the field.
 */
function setStatus(root, mediaId, status, extra = {}) {
  const file = metadataFile(root, mediaId)
  const metadata = readJson(file)
  if (!metadata) return false
  const from = metadata.transcription?.status
  if (status !== null && from !== status && !canTransition(from, status) && !extra.force) return false
  const next = { ...metadata }
  if (status === null) delete next.transcription
  else {
    const { force: _force, ...fields } = extra
    next.transcription = { status, engine: NATIVE_SOURCE, updatedAt: Date.now(), ...fields }
  }
  writeJsonAtomic(file, next)
  return true
}

/* ──────────────────────────── Cross-process lock ──────────────────────── */

function acquireLock(root, mediaId) {
  const file = path.join(mediaDir(root, mediaId), 'cache', 'ai', '.transcription.lock')
  if (!fs.existsSync(mediaDir(root, mediaId))) return null
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' })
      return () => fs.rmSync(file, { force: true })
    } catch {
      const pid = Number(fs.readFileSync(file, 'utf8'))
      let alive = false
      try {
        // Our own pid can only be a lock left by a run that never released it.
        if (pid !== process.pid) alive = process.kill(pid, 0)
      } catch {
        alive = false
      }
      if (alive) return null
      fs.rmSync(file, { force: true })
    }
  }
  return null
}

/* ─────────────────────────────── One job ──────────────────────────────── */

const isTemporaryName = (file) => /^\..*\.tmp$/.test(path.basename(file))

async function waitForSource(root, mediaId, signal) {
  const deadline = Date.now() + SOURCE_WAIT_MS
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'ABORTED' })
    if (!fs.existsSync(metadataFile(root, mediaId))) return null
    const source = resolveMediaFile(root, mediaId, { original: true })
    if (source && !isTemporaryName(source) && fs.statSync(source, { throwIfNoEntry: false })?.size > 0) return source
    if (Date.now() > deadline) throw new Error('The media file has not reached the workspace yet')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

/**
 * Transcribe one media now (in this process). Returns the final status object.
 * Used by the queue and by `shreditor transcribe`.
 */
export async function transcribeMedia(root, mediaId, { force = false, signal, log = () => {} } = {}) {
  assertMediaId(mediaId)
  const metadata = readJson(metadataFile(root, mediaId))
  if (!metadata) throw new TranscriptionError(404, 'NotFoundError', `Media not found: ${mediaId}`)
  if (!/^(audio|video)\//.test(metadata.mimeType ?? '')) {
    throw new TranscriptionError(422, 'NotSupportedError', `Not audio or video: ${metadata.fileName}`)
  }
  const existing = readStoredTranscript(root, mediaId)
  if (!canAutoWrite(existing, { force })) {
    setStatus(root, mediaId, null)
    return { status: 'kept', reason: 'A transcript made in the app is stored; pass force to replace it' }
  }

  const info = await engineInfo()
  if (!info.available) {
    const status = { model: info.modelName, hint: info.hint ?? 'Native transcription is turned off in ~/.shreditor/config.json', error: info.missing.length ? `Missing: ${info.missing.join(', ')}` : 'disabled' }
    setStatus(root, mediaId, 'unavailable', { ...status, force: true })
    return { status: 'unavailable', ...status }
  }

  const release = acquireLock(root, mediaId)
  if (!release) return { status: 'busy', reason: 'Another process is transcribing this media' }
  const config = transcriptionConfig()
  const wav = path.join(os.tmpdir(), `shreditor-transcribe-${crypto.randomUUID()}`)
  const base = { model: info.modelName }
  try {
    setStatus(root, mediaId, 'running', { ...base, force: true })
    const source = await waitForSource(root, mediaId, signal)
    if (!source) return { status: 'gone' }

    const probed = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=index,codec_type:format=duration', '-of', 'json', source], { signal })).stdout)
    const audio = probed.streams?.find((s) => s.codec_type === 'audio')
    const duration = Number(probed.format?.duration) || 0
    if (!audio) {
      setStatus(root, mediaId, 'none', { ...base, reason: 'no-audio' })
      return { status: 'none', reason: 'no-audio' }
    }

    log(`extracting audio (${duration.toFixed(1)}s)`)
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', source, '-map', `0:${audio.index}`, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', `${wav}.wav`], { signal, timeout: EXTRACT_TIMEOUT_MS })
    const { stderr: levels } = await run('ffmpeg', ['-nostdin', '-hide_banner', '-nostats', '-i', `${wav}.wav`, '-af', 'volumedetect', '-f', 'null', '-'], { signal, timeout: EXTRACT_TIMEOUT_MS })
    const peak = Number(/max_volume:\s*(-?[\d.]+|-inf)/.exec(levels)?.[1] ?? Number.NaN)
    if (!(peak > SILENCE_DB)) {
      setStatus(root, mediaId, 'none', { ...base, reason: 'silent' })
      return { status: 'none', reason: 'silent', peakDb: peak }
    }

    log(`whisper ${info.modelName} (${config.language})`)
    const timeout = 10 * 60_000 + Math.ceil(duration * 3000)
    // DTW token alignment (needs flash attention off) times words far better
    // than the plain token offsets, which bunch words up after pauses.
    const dtw = dtwPreset(config.model)
    await run(info.whisperCli, ['-m', config.model, '-f', `${wav}.wav`, '-l', config.language, '-t', String(config.threads), '-ojf', '-of', wav, '-np', ...(dtw ? ['-dtw', dtw, '-nfa'] : [])], { signal, timeout })
    const json = readJson(`${wav}.json`)
    if (!json) throw new Error('whisper-cli wrote no JSON')
    const { language, segments, dropped } = segmentsFromWhisperJson(json, { duration: duration || Infinity })
    if (dropped.length) log(`dropped phantom speech: ${dropped.map((t) => JSON.stringify(t)).join(', ')}`)
    if (segments.length === 0) {
      setStatus(root, mediaId, 'none', { ...base, language, reason: 'no-speech' })
      return { status: 'none', reason: 'no-speech', language, dropped }
    }

    // Re-check: the user may have transcribed in the app while this ran.
    const current = readStoredTranscript(root, mediaId)
    if (!canAutoWrite(current, { force })) {
      setStatus(root, mediaId, null)
      return { status: 'kept', reason: 'A transcript made in the app was saved meanwhile' }
    }
    if (!fs.existsSync(metadataFile(root, mediaId))) return { status: 'gone' }
    fs.mkdirSync(path.dirname(transcriptFile(root, mediaId)), { recursive: true })
    const envelope = buildTranscriptEnvelope({
      mediaId,
      segments,
      language,
      modelName: info.modelName,
      engineVersion: info.version,
      languageRequested: config.language,
      createdAt: current?.service === NATIVE_SOURCE ? current.createdAt : undefined,
    })
    writeJsonAtomic(transcriptFile(root, mediaId), envelope)
    const words = segments.reduce((n, s) => n + (s.words?.length ?? 0), 0)
    setStatus(root, mediaId, 'done', { ...base, language, words })
    return { status: 'done', language, segments: segments.length, words, dropped }
  } catch (error) {
    if (error.code === 'ABORTED') {
      setStatus(root, mediaId, 'failed', { ...base, error: 'Cancelled', force: true })
      return { status: 'failed', error: 'Cancelled' }
    }
    const message = String(error.message ?? error).slice(0, 300)
    setStatus(root, mediaId, 'failed', { ...base, error: message, force: true })
    return { status: 'failed', error: message }
  } finally {
    release()
    for (const ext of ['.wav', '.json']) fs.rmSync(`${wav}${ext}`, { force: true })
  }
}

/* ──────────────────────────────── Queue ──────────────────────────────── */

const jobs = new Map() // key -> { root, mediaId, force, controller }
const waiting = []
let active = null

function pump() {
  if (active || waiting.length === 0) return
  const job = waiting.shift()
  active = job
  void transcribeMedia(job.root, job.mediaId, { force: job.force, signal: job.controller.signal })
    .catch((error) => setStatus(job.root, job.mediaId, 'failed', { error: String(error.message).slice(0, 300), force: true }))
    .finally(() => {
      jobs.delete(job.key)
      active = null
      pump()
    })
}

/** Queue a media for transcription in this process. Returns its status. */
export function requestTranscription(root, mediaId, { force = false } = {}) {
  assertMediaId(mediaId)
  const key = `${root}\0${mediaId}`
  if (jobs.has(key)) return readTranscriptionStatus(root, mediaId)
  if (!fs.existsSync(metadataFile(root, mediaId))) throw new TranscriptionError(404, 'NotFoundError', `Media not found: ${mediaId}`)
  if (waiting.length >= MAX_QUEUE) throw new TranscriptionError(503, 'QuotaExceededError', 'The transcription queue is full; try again later')
  const job = { key, root, mediaId, force, controller: new AbortController() }
  jobs.set(key, job)
  waiting.push(job)
  setStatus(root, mediaId, 'queued', { model: modelName(transcriptionConfig().model), force: true })
  pump()
  return readTranscriptionStatus(root, mediaId)
}

/** Cancel a queued or running job. Returns true when there was one. */
export function cancelTranscription(root, mediaId) {
  const job = jobs.get(`${root}\0${mediaId}`)
  if (!job) return false
  const index = waiting.indexOf(job)
  if (index >= 0) {
    waiting.splice(index, 1)
    jobs.delete(job.key)
    setStatus(root, mediaId, 'failed', { error: 'Cancelled', force: true })
  } else job.controller.abort()
  return true
}

/* ───────────────────────────── Auto trigger ──────────────────────────── */

let autoMode = null // null (off) | { mode: 'worker' } | { mode: 'handoff', bridgeUrl }
const handoffs = new Set()
const handedOff = []

/**
 * Turn on automatic transcription after imports in this process. The bridge
 * runs jobs itself ('worker'); a CLI process hands them to a running bridge
 * ('handoff'), and leaves them queued for the next bridge start otherwise.
 */
export function enableAutoTranscription(options = { mode: 'worker' }) {
  autoMode = options
}

/**
 * Wait for CLI handoffs to finish (so a short-lived process can exit cleanly).
 * Resolves to the media ids a running bridge accepted.
 */
export async function settleHandoffs() {
  await Promise.allSettled([...handoffs])
  return handedOff.splice(0)
}

/**
 * Called once a media import has written its metadata. Queues a transcript
 * for new audio/video media that has none; otherwise does nothing.
 */
export function autoTranscribe(root, mediaId) {
  if (!autoMode || typeof mediaId !== 'string' || !ID_PATTERN.test(mediaId)) return
  try {
    const metadata = readJson(metadataFile(root, mediaId))
    if (!metadata || !/^(audio|video)\//.test(metadata.mimeType ?? '')) return
    if (metadata.transcription || readStoredTranscript(root, mediaId)) return
    if (!transcriptionConfig().enabled) return
    if (autoMode.mode === 'worker') {
      requestTranscription(root, mediaId)
      return
    }
    setStatus(root, mediaId, 'queued', { model: modelName(transcriptionConfig().model) })
    const handoff = fetch(`${autoMode.bridgeUrl}/__shreditor/media/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaId }),
      signal: AbortSignal.timeout(3000),
    })
      .then((res) => {
        if (res.ok) handedOff.push(mediaId)
      })
      .catch(() => {})
    handoffs.add(handoff)
    void handoff.finally(() => handoffs.delete(handoff))
  } catch {
    // Transcription must never break an import.
  }
}

/** Re-queue media left queued or running (a bridge restart, a CLI import with no bridge up). */
export function sweepPending(root) {
  const mediaRoot = path.join(root, 'media')
  let entries = []
  try {
    entries = fs.readdirSync(mediaRoot, { withFileTypes: true })
  } catch {
    return 0
  }
  let queued = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue
    const status = readTranscriptionStatus(root, entry.name)?.status
    if (status !== 'queued' && status !== 'running') continue
    try {
      requestTranscription(root, entry.name)
      queued += 1
    } catch {
      break
    }
  }
  return queued
}

/* ──────────────────────────────── Routes ─────────────────────────────── */

/**
 * Bridge routes (mounted by workspace-bridge.mjs under /__shreditor/):
 *   POST media/transcribe     { mediaId, force?, cancel? } -> 202 { mediaId, transcription }
 *   GET  media/transcription  ?mediaId=<id>                -> { mediaId, transcription, transcript }
 *   GET  transcription/engine                             -> engine, model, availability
 * It also watches the editor's own imports (Finder chooser, browser upload):
 * the first PUT of media/{id}/metadata.json queues that media. Returns true
 * when it answered the request.
 */
export function createTranscriptionRoutes({ sendJson, readBody }) {
  enableAutoTranscription({ mode: 'worker' })
  const swept = new Set()
  const readJsonBody = async (req) => {
    try {
      return JSON.parse((await readBody(req)).toString() || '{}')
    } catch {
      throw new TranscriptionError(400, 'SyntaxError', 'Body must be JSON')
    }
  }
  return async function handleTranscriptionRoute(req, res, { route, rel, root, query }) {
    if (!swept.has(root)) {
      swept.add(root)
      sweepPending(root)
    }
    if (route === 'PUT fs/file') {
      const match = /^media\/([^/]+)\/metadata\.json$/.exec(String(rel).replace(/^\/+/, ''))
      if (match && ID_PATTERN.test(match[1]) && !fs.existsSync(metadataFile(root, match[1]))) {
        res.once('finish', () => res.statusCode < 300 && autoTranscribe(root, match[1]))
      }
      return false
    }
    switch (route) {
      case 'POST media/transcribe': {
        const body = await readJsonBody(req)
        assertMediaId(body.mediaId)
        if (body.cancel === true) {
          sendJson(res, 200, { mediaId: body.mediaId, cancelled: cancelTranscription(root, body.mediaId), transcription: readTranscriptionStatus(root, body.mediaId) })
          return true
        }
        const transcription = requestTranscription(root, body.mediaId, { force: body.force === true })
        sendJson(res, 202, { mediaId: body.mediaId, transcription })
        return true
      }
      case 'GET media/transcription': {
        const mediaId = query?.get('mediaId')
        assertMediaId(mediaId)
        sendJson(res, 200, { mediaId, transcription: readTranscriptionStatus(root, mediaId), transcript: Boolean(readStoredTranscript(root, mediaId)) })
        return true
      }
      case 'GET transcription/engine': {
        sendJson(res, 200, await engineInfo())
        return true
      }
      default:
        return false
    }
  }
}
