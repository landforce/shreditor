// Full-resolution decode derivatives. Originals stay untouched; preview and
// export resolve the same validated file. No Tesseract runtime dependency.
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 1
const active = new Map()
let running = 0
const waiting = []
const CACHE = ['cache', 'compatibility']
const FILE = /^[a-f0-9]{64}\.(mp4|mov)$/

export class CompatibilityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CompatibilityError'
    this.code = code
    this.status = code === 'ABORTED' ? 499 : 422
  }
}

function run(command, args, signal, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { signal, timeout, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const code = signal?.aborted
          ? 'ABORTED'
          : error.code === 'ENOENT'
            ? 'TOOL_MISSING'
            : error.killed
              ? 'TIMEOUT'
              : 'MEDIA_FAILED'
        reject(
          new CompatibilityError(
            code,
            `${command}: ${String(stderr || error.message).slice(-1500)}`,
          ),
        )
      },
    )
  })
}

export async function probeCompatibility(file, signal) {
  return JSON.parse(
    await run(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      signal,
    ),
  )
}

export function compatibilityPolicy(probed, force = false) {
  const video = probed.streams?.find(
    (s) => s.codec_type === 'video' && !s.disposition?.attached_pic,
  )
  if (!video) return null
  const audio = probed.streams?.find((s) => s.codec_type === 'audio')
  const alpha =
    /^(yuva|gbrap|rgba|bgra|argb|abgr|ya\d|pal8)/.test(video.pix_fmt ?? '') ||
    video.tags?.alpha_mode === '1'
  const hdr =
    ['smpte2084', 'arib-std-b67'].includes(video.color_transfer) ||
    video.color_primaries === 'bt2020'
  const nativeVideo = !['h264', 'hevc', 'vp8', 'vp9', 'av1', 'prores'].includes(video.codec_name)
  const nativeAudio =
    audio &&
    ![
      'aac',
      'mp3',
      'opus',
      'vorbis',
      'flac',
      'pcm_s16le',
      'pcm_s24le',
      'pcm_s32le',
      'pcm_f32le',
    ].includes(audio.codec_name)
  if (!force && !nativeVideo && !nativeAudio) return null
  if (hdr)
    throw new CompatibilityError(
      'HDR_POLICY_REQUIRED',
      'This media needs native preparation but is HDR/wide gamut. SDR conversion is not automatic; supply an SDR copy or use a decoder that preserves its color space.',
    )
  return {
    version: VERSION,
    alpha,
    videoIndex: video.index ?? 0,
    audioIndex: audio?.index ?? null,
    format: alpha ? 'mov' : 'mp4',
    reason: force ? 'decode-failed' : nativeVideo ? 'video-codec' : 'audio-codec',
  }
}

function identity(source) {
  const stat = fs.statSync(source)
  return { path: fs.realpathSync(source), size: stat.size, mtimeMs: stat.mtimeMs }
}

function readManifest(mediaDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(mediaDir, ...CACHE, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

export function resolveCompatibleMedia(source, mediaDir) {
  const manifest = readManifest(mediaDir)
  if (manifest?.version !== VERSION || !FILE.test(manifest.file ?? '')) return null
  const current = identity(source)
  if (JSON.stringify(current) !== JSON.stringify(manifest.source)) return null
  const file = path.join(mediaDir, ...CACHE, manifest.file)
  return fs.statSync(file, { throwIfNoEntry: false })?.size === manifest.outputSize ? file : null
}

async function acquire(signal) {
  signal?.throwIfAborted()
  if (running < 2) {
    running++
    return
  }
  if (waiting.length >= 16)
    throw new CompatibilityError('BUSY', 'Native media preparation queue is full; retry later.')
  await new Promise((resolve, reject) => {
    const entry = {
      resolve: () => {
        signal?.removeEventListener('abort', abort)
        resolve()
      },
    }
    const abort = () => {
      const i = waiting.indexOf(entry)
      if (i >= 0) waiting.splice(i, 1)
      reject(new CompatibilityError('ABORTED', 'Preparation cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    waiting.push(entry)
  })
}
function release() {
  const next = waiting.shift()
  if (next) next.resolve()
  else running--
}

function waitForSharedJob(job, signal) {
  if (!signal) return job.catch(() => {})
  signal.throwIfAborted()
  let abort
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(new CompatibilityError('ABORTED', 'Preparation cancelled'))
    signal.addEventListener('abort', abort, { once: true })
  })
  return Promise.race([job.catch(() => {}), cancelled]).finally(() =>
    signal.removeEventListener('abort', abort),
  )
}

/** Shared jobs cannot be cancelled by unrelated callers; a new caller waits for
 * an existing job, then rechecks the cache (including source identity). */
export async function prepareCompatibleMedia(source, mediaDir, { force = false, signal } = {}) {
  signal?.throwIfAborted()
  const key = path.resolve(mediaDir)
  while (active.has(key)) {
    await waitForSharedJob(active.get(key), signal)
    signal?.throwIfAborted()
    const cached = resolveCompatibleMedia(source, mediaDir)
    if (cached) return { file: cached, manifest: readManifest(mediaDir), cached: true }
  }
  const job = prepare(source, mediaDir, { force, signal })
  active.set(key, job)
  try {
    return await job
  } finally {
    if (active.get(key) === job) active.delete(key)
  }
}

async function prepare(source, mediaDir, { force, signal }) {
  const cached = resolveCompatibleMedia(source, mediaDir)
  if (cached) return { file: cached, manifest: readManifest(mediaDir), cached: true }
  await acquire(signal)
  let temporary
  try {
    signal?.throwIfAborted()
    const sourceIdentity = identity(source)
    const input = await probeCompatibility(source, signal)
    const policy = compatibilityPolicy(input, force)
    if (!policy) return null
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ sourceIdentity, policy }))
      .digest('hex')
    const dir = path.join(mediaDir, ...CACHE)
    fs.mkdirSync(dir, { recursive: true })
    const file = `${hash}.${policy.format}`
    temporary = path.join(dir, `.${crypto.randomUUID()}.${policy.format}`)
    const videoArgs = policy.alpha
      ? ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16']
      : [
          '-vf',
          'pad=ceil(iw/2)*2:ceil(ih/2)*2',
          '-c:v',
          'libx264',
          '-crf',
          '16',
          '-preset',
          'fast',
          '-pix_fmt',
          'yuv420p',
        ]
    await run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-nostdin',
        '-y',
        '-copyts',
        '-start_at_zero',
        '-i',
        source,
        '-map',
        `0:${policy.videoIndex}`,
        ...(policy.audioIndex === null ? ['-an'] : ['-map', `0:${policy.audioIndex}`]),
        ...videoArgs,
        '-fps_mode',
        'passthrough',
        '-c:a',
        policy.alpha ? 'pcm_s16le' : 'aac',
        '-movflags',
        '+faststart',
        temporary,
      ],
      signal,
      30 * 60_000,
    )
    const output = await probeCompatibility(temporary, signal)
    const video = output.streams?.find((s) => s.codec_type === 'video')
    if (
      !video ||
      !Number.isFinite(Number(output.format?.duration)) ||
      Number(output.format.duration) <= 0
    ) {
      throw new CompatibilityError('INVALID_OUTPUT', 'Preparation produced no usable video stream')
    }
    // A valid header is insufficient: exercise the produced decoder before publish.
    await run(
      'ffmpeg',
      ['-v', 'error', '-xerror', '-i', temporary, '-frames:v', '1', '-f', 'null', '-'],
      signal,
    )
    if (JSON.stringify(identity(source)) !== JSON.stringify(sourceIdentity))
      throw new CompatibilityError(
        'SOURCE_CHANGED',
        'Source changed during media preparation; retry.',
      )
    const manifest = {
      version: VERSION,
      file,
      source: sourceIdentity,
      outputSize: fs.statSync(temporary).size,
      policy,
      probe: output,
    }
    fs.renameSync(temporary, path.join(dir, file))
    temporary = path.join(dir, `.${crypto.randomUUID()}.json`)
    fs.writeFileSync(temporary, JSON.stringify(manifest))
    fs.renameSync(temporary, path.join(dir, 'manifest.json'))
    temporary = null
    return { file: path.join(dir, file), manifest, cached: false }
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true })
    release()
  }
}
