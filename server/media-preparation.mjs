// Background preparation of working copies (server/media-compatibility.mjs)
// and its state in media/{id}/metadata.json, which the editor's media pane
// watches (useProjectMediaWatcher) and the agent service checks for addClip.
//
//   compatibility.status  'preparing' (progress 0..1) | 'ready' | 'failed' (error)
//
// Jobs run in the process that started them (the editor's bridge), or in a
// detached worker for the command line:
//   node server/media-preparation.mjs run <workspace> <mediaId...> [--force]
// A per-media lock (cache/compatibility/job.json: pid + heartbeat) keeps two
// processes off the same media; a job whose process died is resumed by the next
// bridge poll or `shreditor media --wait`.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveMediaFile } from '../headless/lib/workspace.mjs'
import { compatibilityPolicy, describeMedia, prepareCompatibleMedia } from './media-compatibility.mjs'

const SELF = fileURLToPath(import.meta.url)
const HEARTBEAT_MS = 2000
const STALE_MS = 30_000
const PROGRESS_WRITE_MS = 1000
const jobs = new Map()

/* ─────────────────────────────── Metadata ────────────────────────────── */

const mediaDirOf = (root, mediaId) => path.join(root, 'media', mediaId)
const metadataFile = (root, mediaId) => path.join(mediaDirOf(root, mediaId), 'metadata.json')
const lockFile = (root, mediaId) => path.join(mediaDirOf(root, mediaId), 'cache', 'compatibility', 'job.json')

function writeJsonAtomic(target, value) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`)
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, target)
}

export function readMetadata(root, mediaId) {
  try {
    return JSON.parse(fs.readFileSync(metadataFile(root, mediaId), 'utf8'))
  } catch {
    return null
  }
}

/** Read-modify-write, re-reading each time so concurrent edits (a category) survive. */
function updateMetadata(root, mediaId, change) {
  const current = readMetadata(root, mediaId)
  if (!current) return null
  const next = change(current)
  if (!next) return current
  writeJsonAtomic(metadataFile(root, mediaId), { ...next, updatedAt: Date.now() })
  return next
}

// ffprobe codec names -> the names the editor's media worker (mediabunny) stores.
const CODEC_NAMES = { h264: 'avc', mpeg4: 'mpeg4', pcm_s16le: 'pcm-s16', pcm_s24le: 'pcm-s24', pcm_f32le: 'pcm-f32', pcm_s16be: 'pcm-s16be' }
const UNSUPPORTED_AUDIO = ['ac3', 'eac3', 'ec-3', 'ac-3', 'dts', 'truehd', 'mlp', 'alac', 'mp2']
export const MIME_BY_FORMAT = { mov: 'video/quicktime', mp4: 'video/mp4', mkv: 'video/x-matroska' }

function parseRate(rate) {
  const [num, den] = String(rate ?? '').split('/').map(Number)
  return den ? num / den : num || 0
}

/** Editor metadata fields (duration, size, fps, codecs) from an ffprobe result. */
export function metadataFromProbe(probed, mimeType) {
  const streams = probed?.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.find((s) => s.codec_type === 'audio')
  const duration = Number(probed?.format?.duration) || Number(video?.duration) || Number(audio?.duration) || 0
  const codecOf = (s) => (s ? (CODEC_NAMES[s.codec_name] ?? s.codec_name) : undefined)
  const bitrate = Number(probed?.format?.bit_rate) || 0
  if (mimeType.startsWith('video/') && video) {
    const rotated = Math.abs(Number(video.side_data_list?.find((d) => 'rotation' in d)?.rotation ?? 0)) % 180 === 90
    const audioCodec = codecOf(audio)
    const codec = codecOf(video)
    return {
      duration,
      width: (rotated ? video.height : video.width) ?? 0,
      height: (rotated ? video.width : video.height) ?? 0,
      fps: Number(parseRate(video.avg_frame_rate || video.r_frame_rate).toFixed(3)) || 30,
      codec: codec ?? 'unknown',
      bitrate,
      audioCodec,
      audioCodecSupported: !audioCodec || !UNSUPPORTED_AUDIO.some((c) => audioCodec.toLowerCase().includes(c)),
      // ProRes decodes through the editor's WASM decoder, never <video>.
      videoCodecSupported: codec !== 'prores',
    }
  }
  if (mimeType.startsWith('audio/')) {
    return { duration, width: 0, height: 0, fps: 0, codec: codecOf(audio) ?? 'unknown', bitrate }
  }
  return { duration: 0, width: video?.width ?? 0, height: video?.height ?? 0, fps: 0, codec: 'unknown', bitrate: 0 }
}

/** The `compatibility` record for media that starts preparing. */
export function preparingRecord(plan, probed, originalMimeType) {
  return {
    version: 2,
    backend: 'native',
    status: 'preparing',
    progress: 0,
    action: plan.action,
    reason: plan.reason,
    detail: plan.detail,
    alpha: plan.alpha,
    originalMimeType,
    original: describeMedia(probed),
    startedAt: Date.now(),
  }
}

/** Metadata after a finished job: the decode source is now the working copy. */
function readyMetadata(metadata, manifest) {
  const mimeType = MIME_BY_FORMAT[manifest.policy.format] ?? 'video/quicktime'
  const previous = metadata.compatibility ?? {}
  return {
    ...metadata,
    ...metadataFromProbe(manifest.probe, mimeType),
    mimeType,
    compatibility: {
      version: 2,
      backend: 'native',
      status: 'ready',
      progress: 1,
      action: manifest.policy.action,
      reason: manifest.policy.reason,
      detail: manifest.policy.detail,
      alpha: manifest.policy.alpha,
      originalMimeType: previous.originalMimeType ?? metadata.mimeType,
      original: manifest.original,
      derivative: { file: `cache/compatibility/${manifest.file}`, ...manifest.derivative },
      settings: manifest.settings,
      notes: manifest.notes,
      verification: manifest.verification,
      seconds: manifest.seconds,
      startedAt: previous.startedAt,
      finishedAt: Date.now(),
    },
  }
}

/* ──────────────────────────────── Locks ──────────────────────────────── */

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function writeLock(root, mediaId, pid = process.pid) {
  fs.mkdirSync(path.dirname(lockFile(root, mediaId)), { recursive: true })
  writeJsonAtomic(lockFile(root, mediaId), { pid, heartbeatAt: Date.now() })
}

/** True when another live process is preparing this media. */
function lockedElsewhere(root, mediaId) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile(root, mediaId), 'utf8'))
    if (lock.pid === process.pid) return false
    return pidAlive(lock.pid) && Date.now() - lock.heartbeatAt < STALE_MS
  } catch {
    return false
  }
}

/* ──────────────────────────────── Jobs ───────────────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function runJob(root, mediaId, force) {
  writeLock(root, mediaId)
  const heartbeat = setInterval(() => writeLock(root, mediaId), HEARTBEAT_MS)
  heartbeat.unref?.()
  try {
    const source = resolveMediaFile(root, mediaId, { original: true })
    if (!source) throw new Error('The original file is missing')
    let lastWrite = 0
    const onProgress = (progress) => {
      const now = Date.now()
      if (now - lastWrite < PROGRESS_WRITE_MS) return
      lastWrite = now
      updateMetadata(root, mediaId, (m) =>
        m.compatibility?.status === 'preparing' ? { ...m, compatibility: { ...m.compatibility, progress: Math.round(progress * 100) / 100 } } : null,
      )
    }
    updateMetadata(root, mediaId, (m) =>
      m.compatibility?.status === 'preparing' ? null : { ...m, compatibility: { version: 2, backend: 'native', ...m.compatibility, originalMimeType: m.compatibility?.originalMimeType ?? m.mimeType, status: 'preparing', progress: 0, error: undefined, startedAt: Date.now() } },
    )
    const prepared = await prepareCompatibleMedia(source, mediaDirOf(root, mediaId), { force, onProgress })
    if (!prepared) {
      updateMetadata(root, mediaId, (m) => {
        const { compatibility, ...rest } = m
        return compatibility ? rest : null
      })
      return { status: 'not-needed' }
    }
    updateMetadata(root, mediaId, (m) => readyMetadata(m, prepared.manifest))
    return { status: 'ready', prepared }
  } catch (error) {
    const message = `${error.code ? `${error.code}: ` : ''}${String(error.message ?? error)}`.slice(0, 600)
    updateMetadata(root, mediaId, (m) => ({
      ...m,
      compatibility: { ...m.compatibility, status: 'failed', error: message, code: error.code, finishedAt: Date.now() },
    }))
    return { status: 'failed', error }
  } finally {
    clearInterval(heartbeat)
    fs.rmSync(lockFile(root, mediaId), { force: true })
  }
}

/**
 * Prepare `mediaId` in this process (or join the running job). When another
 * live process holds it, wait for that one. Resolves to
 * { status: 'ready'|'failed'|'not-needed', prepared?, error? }; never rejects.
 */
export function startPreparation(root, mediaId, { force = false } = {}) {
  const key = `${path.resolve(root)}\0${mediaId}`
  if (jobs.has(key)) return jobs.get(key)
  const job = (async () => {
    while (lockedElsewhere(root, mediaId)) await sleep(500)
    return runJob(root, mediaId, force)
  })().finally(() => jobs.delete(key))
  jobs.set(key, job)
  return job
}

/** Run jobs in a detached worker so they outlive the calling command. */
export function startPreparationDetached(root, mediaIds, { force = false } = {}) {
  const ids = mediaIds.filter((id) => !jobs.has(`${path.resolve(root)}\0${id}`) && !lockedElsewhere(root, id))
  if (!ids.length) return null
  const logDir = path.join(mediaDirOf(root, ids[0]), 'cache', 'compatibility')
  fs.mkdirSync(logDir, { recursive: true })
  const log = fs.openSync(path.join(logDir, 'worker.log'), 'a')
  const child = spawn(process.execPath, [SELF, 'run', root, ...ids, ...(force ? ['--force'] : [])], {
    detached: true,
    stdio: ['ignore', log, log],
  })
  fs.closeSync(log)
  // Claim them for the worker right away so a resume doesn't start them twice.
  for (const id of ids) writeLock(root, id, child.pid)
  child.unref()
  return child.pid
}

/** Restart jobs whose process went away (killed worker, restarted editor). */
export function resumePreparations(root, { detached = false, mediaIds } = {}) {
  const mediaRoot = path.join(root, 'media')
  if (!fs.existsSync(mediaRoot)) return 0
  const ids = mediaIds ?? fs.readdirSync(mediaRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  const stale = ids.filter(
    (id) =>
      readMetadata(root, id)?.compatibility?.status === 'preparing' &&
      !jobs.has(`${path.resolve(root)}\0${id}`) &&
      !lockedElsewhere(root, id),
  )
  if (detached) startPreparationDetached(root, stale)
  else for (const id of stale) void startPreparation(root, id)
  return stale.length
}

/** Mark failed media as preparing again and start it. */
export function retryPreparation(root, mediaId, { detached = false } = {}) {
  const metadata = updateMetadata(root, mediaId, (m) =>
    m.compatibility?.status === 'failed'
      ? { ...m, compatibility: { ...m.compatibility, status: 'preparing', progress: 0, error: undefined, code: undefined, startedAt: Date.now() } }
      : null,
  )
  if (metadata?.compatibility?.status !== 'preparing') return Promise.resolve(null)
  if (detached) return Promise.resolve(startPreparationDetached(root, [mediaId]))
  return startPreparation(root, mediaId)
}

/** { id, fileName, status, progress?, action?, error? } per media id. */
export function preparationStates(root, mediaIds) {
  return mediaIds.map((id) => {
    const m = readMetadata(root, id)
    if (!m) return { id, status: 'missing' }
    const c = m.compatibility
    return {
      id,
      fileName: m.fileName,
      status: c?.status ?? 'ready',
      ...(c ? { action: c.action, progress: c.progress, ...(c.error ? { error: c.error } : {}) } : {}),
    }
  })
}

/**
 * Poll until none of `mediaIds` is preparing; jobs whose process died are
 * resumed. `onChange(states)` is called whenever a state or whole percent moves.
 */
export async function waitForPreparation(root, mediaIds, { detached = true, onChange, intervalMs = 500 } = {}) {
  let last = ''
  for (;;) {
    resumePreparations(root, { detached, mediaIds })
    const states = preparationStates(root, mediaIds)
    const stamp = JSON.stringify(states.map((s) => [s.status, Math.floor((s.progress ?? 0) * 100)]))
    if (stamp !== last) {
      last = stamp
      onChange?.(states)
    }
    if (!states.some((s) => s.status === 'preparing')) return states
    await sleep(intervalMs)
  }
}

/** Plan for a probed file (null when it decodes as it is); HDR refusals become `error`. */
export function planFor(probed) {
  try {
    return { plan: compatibilityPolicy(probed) }
  } catch (error) {
    return { plan: null, error }
  }
}

// Detached worker: node server/media-preparation.mjs run <workspace> <mediaId...> [--force]
if (process.argv[1] === SELF && process.argv[2] === 'run') {
  const args = process.argv.slice(3)
  const force = args.includes('--force')
  const [root, ...mediaIds] = args.filter((a) => a !== '--force').map((a, i) => (i === 0 ? path.resolve(a) : a))
  for (const id of mediaIds) writeLock(root, id)
  Promise.all(mediaIds.map((id) => startPreparation(root, id, { force }))).then(() => process.exit(0))
}
