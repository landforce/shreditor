// Full-resolution decode derivatives ("working copies"). Originals stay
// untouched; preview and export resolve the same validated file.
//
// Decision table (measured with Chrome 154 on macOS, headless and headed:
// <video> playback and the export path through mediabunny/WebCodecs):
//
//   keep      Chrome decodes it: H.264 8/10-bit 4:2:0/4:2:2/4:4:4, HEVC 8/10-bit
//             (incl. PQ/HLG, 4:2:2, 4:4:4), VP8, VP9 (incl. alpha, 4:4:4, 10-bit),
//             AV1 8/10-bit, in MOV/MP4/Matroska/WebM, with AAC/MP3/Opus/Vorbis/
//             FLAC/PCM audio. ProRes is kept too: the editor decodes it with its
//             ProRes WASM decoder (never through <video>).
//   rewrap    Playable video in a container Chrome can't open (AVI, MPEG-TS/PS,
//             MXF, ...) or with audio it can't decode (AC-3, E-AC-3, ALAC, DTS,
//             MP2, ...): video stream copied bit for bit, audio copied or decoded
//             to PCM at the same rate, channels and sample format.
//   hevc      Unplayable video that is HDR/BT.2020 or above 8-bit: HEVC Main10
//             (libx265 CRF 12), chroma layout and colour tags kept. HDR stays HDR.
//   h264      Unplayable 8-bit video: H.264 CRF 12 keeping the chroma layout
//             (4:4:4 for RGB sources, converted with the BT.709 matrix).
//   prores-alpha  Unplayable video with alpha: ProRes 4444 (10-bit, 16-bit alpha)
//             decoded by the editor's ProRes WASM decoder.
//   vp9-alpha Forced preparation of a ProRes alpha source (its WASM decode
//             failed): VP9 with alpha, 8-bit 4:2:0 (recorded in notes).
//
// Off macOS only plain H.264/VP8/VP9/AV1 are assumed to decode; HDR that would
// need conversion there is refused (HDR_POLICY_REQUIRED) rather than tone-mapped.
import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 2
const active = new Map()
let running = 0
const waiting = []
const CACHE = ['cache', 'compatibility']
const FILE = /^[a-f0-9]{64}\.(mp4|mov|mkv)$/

export class CompatibilityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CompatibilityError'
    this.code = code
    this.status = code === 'ABORTED' ? 499 : 422
  }
}

function failureCode(signal, error) {
  if (signal?.aborted) return 'ABORTED'
  if (error.code === 'ENOENT') return 'TOOL_MISSING'
  return error.killed ? 'TIMEOUT' : 'MEDIA_FAILED'
}

function run(command, args, signal, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { signal, timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        reject(
          new CompatibilityError(
            failureCode(signal, error),
            `${command}: ${String(stderr || error.message).slice(-1500)}`,
          ),
        )
      },
    )
  })
}

/** ffmpeg with `-progress pipe:1`; reports 0..1 of `duration`. */
function runEncode(args, { signal, timeout, duration, onProgress }) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { signal, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let buffer = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeout)
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let at
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        const match = /^out_time_us=(\d+)/.exec(line)
        if (match && duration > 0) onProgress?.(Math.min(0.99, Number(match[1]) / 1e6 / duration))
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new CompatibilityError(failureCode(signal, error), `ffmpeg: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      const kind = signal?.aborted ? 'ABORTED' : timedOut ? 'TIMEOUT' : 'MEDIA_FAILED'
      reject(new CompatibilityError(kind, `ffmpeg: ${stderr.trim().slice(-1500) || `exit ${code}`}`))
    })
  })
}

export async function probeCompatibility(file, signal) {
  return JSON.parse(
    await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], signal),
  )
}

/* ─────────────────────────────── Describe ────────────────────────────── */

const known = (value) => (value && value !== 'unknown' && value !== 'unspecified' && value !== 'reserved' ? value : undefined)

function parseRate(rate) {
  const [num, den] = String(rate ?? '').split('/').map(Number)
  if (!num) return 0
  return den ? num / den : num
}

function bitDepthOf(stream) {
  const raw = Number(stream?.bits_per_raw_sample)
  if (raw > 0) return raw
  const fmt = String(stream?.pix_fmt ?? '')
  const match = /(\d+)(le|be)$/.exec(fmt)
  if (match && Number(match[1]) > 8) return Number(match[1])
  return /^(rgb|bgr)(48|64)/.test(fmt) ? 16 : 8
}

const RGB = /^(gbr|rgb|bgr|argb|abgr|rgba|bgra|0rgb|rgb0|0bgr|bgr0|pal8|monob|monow|x2rgb|x2bgr)/
const ALPHA = /^(yuva|gbrap|rgba|bgra|argb|abgr|ya\d|pal8|rgba64|bgra64)/

/** The parts of a probed video stream the policy and the metadata record use. */
function describeVideo(v) {
  const pixFmt = v.pix_fmt ?? ''
  const rgb = RGB.test(pixFmt)
  return {
    codec: v.codec_name,
    ...(known(v.profile) ? { profile: v.profile } : {}),
    pixFmt,
    bitDepth: bitDepthOf(v),
    chroma: rgb || /444/.test(pixFmt) ? '444' : /422/.test(pixFmt) ? '422' : /^gray/.test(pixFmt) ? '400' : '420',
    rgb,
    alpha: ALPHA.test(pixFmt) || v.tags?.alpha_mode === '1' || v.tags?.ALPHA_MODE === '1',
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: Math.round(parseRate(v.avg_frame_rate || v.r_frame_rate) * 1000) / 1000,
    timeBase: v.time_base,
    ...(known(v.color_primaries) ? { colorPrimaries: v.color_primaries } : {}),
    ...(known(v.color_transfer) ? { colorTransfer: v.color_transfer } : {}),
    ...(known(v.color_space) ? { colorSpace: v.color_space } : {}),
    ...(known(v.color_range) ? { colorRange: v.color_range } : /^yuvj/.test(pixFmt) ? { colorRange: 'pc' } : {}),
  }
}

function describeAudio(a) {
  return {
    codec: a.codec_name,
    sampleRate: Number(a.sample_rate) || 0,
    channels: a.channels ?? 0,
    sampleFmt: a.sample_fmt,
    ...(Number(a.bits_per_raw_sample) > 0 ? { bitDepth: Number(a.bits_per_raw_sample) } : {}),
  }
}

const videoStreamOf = (probed) => probed?.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
const audioStreamOf = (probed) => probed?.streams?.find((s) => s.codec_type === 'audio')

/** How a probed file is recorded in metadata (`compatibility.original` / `.derivative`). */
export function describeMedia(probed) {
  const v = videoStreamOf(probed)
  const a = audioStreamOf(probed)
  return {
    container: probed?.format?.format_name ?? '',
    duration: Number(probed?.format?.duration) || 0,
    ...(v ? { video: describeVideo(v) } : {}),
    ...(a ? { audio: describeAudio(a) } : {}),
  }
}

/* ──────────────────────────────── Policy ─────────────────────────────── */

// Pixel formats per codec that Chrome 154 decoded in both <video> and the
// export path on macOS (see the table at the top).
const MAC_VIDEO = {
  h264: ['yuv420p', 'yuvj420p', 'yuv422p', 'yuvj422p', 'yuv444p', 'yuvj444p', 'yuv420p10le', 'yuv422p10le', 'yuv444p10le'],
  hevc: ['yuv420p', 'yuvj420p', 'yuv444p', 'yuv420p10le', 'yuv422p10le', 'yuv444p10le'],
  vp8: ['yuv420p', 'yuva420p'],
  vp9: ['yuv420p', 'yuva420p', 'yuv444p', 'yuv420p10le'],
  av1: ['yuv420p', 'yuv420p10le'],
}
const OTHER_VIDEO = {
  h264: ['yuv420p', 'yuvj420p'],
  vp8: ['yuv420p', 'yuva420p'],
  vp9: ['yuv420p', 'yuva420p'],
  av1: ['yuv420p'],
}
// Decoded by the editor's registered WASM decoder, not by <video>.
const WASM_VIDEO = new Set(['prores'])
const PLAYABLE_AUDIO = new Set([
  'aac', 'mp3', 'opus', 'vorbis', 'flac',
  'pcm_s16le', 'pcm_s16be', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le',
])
// Audio MOV holds and Chrome plays as is; anything else becomes PCM there.
const MOV_AUDIO = new Set(['aac', 'mp3', 'pcm_s16le', 'pcm_s16be', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'])
const MKV_AUDIO = new Set(['opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'])
const PLAYABLE_CONTAINER = /^(mov,mp4|matroska)/
const HDR_TRANSFER = new Set(['smpte2084', 'arib-std-b67'])

function videoPlayable(video, mac) {
  const table = mac ? MAC_VIDEO : OTHER_VIDEO
  return (table[video.codec] ?? []).includes(video.pixFmt) || (video.alpha && (video.codec === 'vp8' || video.codec === 'vp9'))
}

/** Same-rate, same-channels PCM that keeps the decoded sample precision. */
function pcmFor(audio) {
  const fmt = String(audio.sampleFmt ?? '')
  if (/^(flt|dbl)/.test(fmt)) return 'pcm_f32le'
  if (/^s32/.test(fmt)) return audio.bitDepth && audio.bitDepth <= 24 ? 'pcm_s24le' : 'pcm_s32le'
  return 'pcm_s16le'
}

function outputAudio(audio, container) {
  if (!audio) return null
  const keep = container === 'mkv' ? MKV_AUDIO : MOV_AUDIO
  if (keep.has(audio.codec)) return { codec: audio.codec, copy: true }
  return { codec: pcmFor(audio), copy: false, from: audio.codec }
}

const FRIENDLY = {
  prores: 'ProRes', dnxhd: 'DNxHD/DNxHR', png: 'PNG-codec video', qtrle: 'QuickTime Animation',
  mjpeg: 'Motion JPEG', mpeg4: 'MPEG-4 Part 2', mpeg2video: 'MPEG-2', cfhd: 'CineForm', hevc: 'HEVC', h264: 'H.264',
}
const friendly = (v) => `${FRIENDLY[v.codec] ?? v.codec}${v.profile && v.codec === 'prores' ? ` ${v.profile}` : ''} (${v.pixFmt})`

function rewrapPlan(base, video, audio, problem) {
  const format = ['vp8', 'vp9', 'av1'].includes(video.codec) ? 'mkv' : 'mov'
  const out = outputAudio(audio, format)
  const notes = []
  if (out && !out.copy) notes.push(`${audio.codec} audio decoded to ${out.codec} (same rate and channels)`)
  return { ...base, action: 'rewrap', format, reason: problem, video: { copy: true, codec: video.codec }, audio: out, notes }
}

function alphaPlan(base, video, audio, force) {
  const notes = []
  if (video.codec === 'prores' && force) {
    // The WASM decoder failed on this ProRes; a ProRes copy would fail too.
    if (video.bitDepth > 8) notes.push(`${video.bitDepth}-bit colour and alpha stored as 8-bit (VP9 alpha)`)
    if (video.chroma !== '420') notes.push(`chroma ${video.chroma} stored as 4:2:0 (VP9 alpha)`)
    return { ...base, action: 'vp9-alpha', format: 'mkv', video: { codec: 'vp9', pixFmt: 'yuva420p', crf: 10 }, audio: outputAudio(audio, 'mkv'), notes }
  }
  if (video.bitDepth > 10) notes.push(`${video.bitDepth}-bit colour stored as 10-bit (ProRes 4444; alpha 16-bit)`)
  return { ...base, action: 'prores-alpha', format: 'mov', video: { codec: 'prores', pixFmt: 'yuva444p10le' }, audio: outputAudio(audio, 'mov'), notes }
}

function opaquePlan(base, video, audio, mac) {
  const notes = []
  const hdr = HDR_TRANSFER.has(video.colorTransfer) || video.colorPrimaries === 'bt2020'
  if (hdr && !mac)
    throw new CompatibilityError(
      'HDR_POLICY_REQUIRED',
      'This HDR/wide-gamut media needs conversion, and no HDR-preserving output is verified to decode on this platform. It was not tone-mapped; supply a copy Chrome decodes (HEVC Main10 or AV1 10-bit).',
    )
  const layout = video.chroma === '444' ? '444' : video.chroma === '422' ? '422' : '420'
  if (hdr || video.bitDepth > 8) {
    if (mac) {
      if (video.bitDepth > 10) notes.push(`${video.bitDepth}-bit source stored as 10-bit`)
      return { ...base, action: 'hevc', format: 'mov', video: { codec: 'hevc', pixFmt: `yuv${layout}p10le`, crf: 12 }, audio: outputAudio(audio, 'mov'), notes }
    }
    notes.push(`${video.bitDepth}-bit source stored as 8-bit (10-bit output is not verified on this platform)`)
  }
  const pixFmt = mac ? `yuv${layout}p` : 'yuv420p'
  if (pixFmt === 'yuv420p' && layout !== '420') notes.push(`chroma ${layout} stored as 4:2:0`)
  return { ...base, action: 'h264', format: 'mov', video: { codec: 'h264', pixFmt, crf: 12 }, audio: outputAudio(audio, 'mov'), notes }
}

/**
 * What a probed file needs so the editor (preview in Chrome, export in headless
 * Chrome) can decode it, or null when it decodes as it is. `force` (a decode
 * failed in the browser) converts even candidate codecs.
 */
export function compatibilityPolicy(probed, force = false, { platform = process.platform } = {}) {
  const v = videoStreamOf(probed)
  if (!v) return null
  const a = audioStreamOf(probed)
  const mac = platform === 'darwin'
  const video = describeVideo(v)
  const audio = a ? describeAudio(a) : null
  const playable = videoPlayable(video, mac)
  const wasm = WASM_VIDEO.has(video.codec)
  const containerOk = PLAYABLE_CONTAINER.test(probed.format?.format_name ?? '')
  const audioOk = !audio || PLAYABLE_AUDIO.has(audio.codec)
  const base = { version: VERSION, alpha: video.alpha, videoIndex: v.index ?? 0, audioIndex: a?.index ?? null }
  if (!force) {
    if ((playable || wasm) && containerOk && audioOk) return null
    if (playable || (wasm && containerOk)) {
      const problem = !audioOk ? `Chrome can't decode ${audio.codec} audio` : `Chrome can't open ${probed.format?.format_name} files`
      return { ...rewrapPlan(base, video, audio, problem), reason: audioOk ? 'container' : 'audio-codec', detail: problem }
    }
  }
  const detail = force ? `${friendly(video)} failed to decode in the browser` : `Chrome can't decode ${friendly(video)}`
  const plan = video.alpha ? alphaPlan(base, video, audio, force) : opaquePlan(base, video, audio, mac)
  return { ...plan, reason: force ? 'decode-failed' : 'video-codec', detail }
}

/* ───────────────────────────── ffmpeg args ───────────────────────────── */

/** Colour tags and conversion filter for a transcode; never invents tags the source lacks. */
function colourArgs(plan, video) {
  const out = plan.video
  const filters = []
  const tags = []
  const scale = ['flags=accurate_rnd+full_chroma_int+full_chroma_inp']
  const wide = video.colorPrimaries === 'bt2020' || HDR_TRANSFER.has(video.colorTransfer)
  // swscale defaults to BT.601 for RGB->YUV; say which matrix, and tag it.
  const matrix = video.rgb ? (wide ? 'bt2020nc' : 'bt709') : video.colorSpace
  const range = video.rgb || out.codec === 'prores' || out.codec === 'vp9' ? 'tv' : video.colorRange === 'pc' ? 'pc' : video.colorRange
  // Decoders don't always label frames like the stream (DNxHD says BT.709 for a
  // BT.2020 file); ffmpeg would then "convert" to the requested tags and alter
  // the pixels. Relabel decoded frames with the stream's tags first, so nothing
  // converts between YUV matrices or ranges.
  const relabel = []
  if (video.colorPrimaries) relabel.push(`color_primaries=${video.colorPrimaries}`)
  if (video.colorTransfer) relabel.push(`color_trc=${video.colorTransfer}`)
  if (!video.rgb && video.colorSpace) relabel.push(`colorspace=${video.colorSpace}`)
  if (!video.rgb && video.colorRange) relabel.push(`range=${video.colorRange === 'pc' ? 'pc' : 'tv'}`)
  if (relabel.length) filters.push(`setparams=${relabel.join(':')}`)
  if (video.rgb) scale.push(`out_color_matrix=${matrix}`)
  if (range) scale.push(`out_range=${range}`)
  filters.push(`scale=${scale.join(':')}`)
  const [sx, sy] = /420/.test(out.pixFmt) ? [2, 2] : /422/.test(out.pixFmt) ? [2, 1] : [1, 1]
  if (video.width % sx || video.height % sy) {
    filters.push(`pad=ceil(iw/${sx})*${sx}:ceil(ih/${sy})*${sy}`)
    plan.notes.push(`padded by one pixel to ${Math.ceil(video.width / sx) * sx}x${Math.ceil(video.height / sy) * sy} (${out.pixFmt} needs even dimensions)`)
  }
  filters.push(`format=${out.pixFmt}`)
  if (video.colorPrimaries) tags.push('-color_primaries', video.colorPrimaries)
  if (video.colorTransfer) tags.push('-color_trc', video.colorTransfer)
  if (matrix) tags.push('-colorspace', matrix)
  if (range) tags.push('-color_range', range)
  return { filter: filters.join(','), tags }
}

// No B-frames: with variable frame timing, reordering scrambles the decode-time
// deltas MOV stores as sample durations (a VFR clip came out 0.3 s short).
const ENCODERS = {
  h264: (v) => ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(v.crf), '-bf', '0'],
  hevc: (v) => ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(v.crf), '-tag:v', 'hvc1', '-x265-params', 'log-level=error:bframes=0'],
  prores: () => ['-c:v', 'prores_ks', '-profile:v', '4', '-alpha_bits', '16', '-vendor', 'apl0'],
  vp9: (v) => ['-c:v', 'libvpx-vp9', '-crf', String(v.crf), '-b:v', '0', '-auto-alt-ref', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2'],
}

/** Human-readable encoder settings recorded in metadata. */
export function describeSettings(plan) {
  const audio = plan.audio ? (plan.audio.copy ? `audio ${plan.audio.codec} copied` : `audio ${plan.audio.from} -> ${plan.audio.codec}`) : 'no audio'
  if (plan.action === 'rewrap') return `video ${plan.video.codec} copied into ${plan.format.toUpperCase()}, ${audio}`
  const v = plan.video
  const codec = { h264: 'libx264 preset medium, no B-frames', hevc: 'libx265 preset medium (Main10), no B-frames', prores: 'prores_ks 4444 alpha_bits 16', vp9: 'libvpx-vp9' }[v.codec]
  return `${codec}${v.crf ? ` CRF ${v.crf}` : ''} ${v.pixFmt}, ${audio}, timestamps passed through`
}

/** ffmpeg arguments for a plan. Pure, for tests. */
export function compatibilityArgs(plan, probed, input, output) {
  const video = describeVideo(videoStreamOf(probed))
  const args = ['-nostdin', '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-copyts', '-start_at_zero']
  // AVI and MPEG-PS carry no B-frame timestamps; let the demuxer make them.
  if (plan.action === 'rewrap') args.push('-fflags', '+genpts')
  args.push('-i', input, '-map_metadata', '0', '-map', `0:${plan.videoIndex}`)
  args.push(...(plan.audioIndex === null ? ['-an'] : ['-map', `0:${plan.audioIndex}`]))
  if (plan.action === 'rewrap') {
    args.push('-c:v', 'copy')
    if (video.codec === 'hevc' && plan.format === 'mov') args.push('-tag:v', 'hvc1')
  } else {
    const { filter, tags } = colourArgs(plan, video)
    args.push('-vf', filter, ...ENCODERS[plan.video.codec](plan.video), ...tags)
  }
  if (plan.audio) args.push('-c:a', plan.audio.copy ? 'copy' : plan.audio.codec)
  args.push('-fps_mode', 'passthrough')
  if (plan.format === 'mov') {
    const timescale = Number(String(video.timeBase ?? '').split('/')[1])
    if (timescale > 0 && timescale < 2 ** 31) args.push('-video_track_timescale', String(timescale))
    args.push('-movflags', '+faststart')
  }
  return [...args, output]
}

/* ─────────────────────────────── Cache ───────────────────────────────── */

function identity(source) {
  const stat = fs.statSync(source)
  return { path: fs.realpathSync(source), size: stat.size, mtimeMs: stat.mtimeMs }
}

export function readManifest(mediaDir) {
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
export async function prepareCompatibleMedia(source, mediaDir, { force = false, signal, onProgress } = {}) {
  signal?.throwIfAborted()
  const key = path.resolve(mediaDir)
  while (active.has(key)) {
    await waitForSharedJob(active.get(key), signal)
    signal?.throwIfAborted()
    const cached = resolveCompatibleMedia(source, mediaDir)
    if (cached) return { file: cached, manifest: readManifest(mediaDir), cached: true }
  }
  const job = prepare(source, mediaDir, { force, signal, onProgress })
  active.set(key, job)
  try {
    return await job
  } finally {
    if (active.get(key) === job) active.delete(key)
  }
}

/* ───────────────────────────── Verification ──────────────────────────── */

async function countFrames(file, streamIndex, signal) {
  try {
    const out = JSON.parse(
      await run('ffprobe', ['-v', 'error', '-select_streams', String(streamIndex), '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'json', file], signal, 5 * 60_000),
    )
    return Number(out.streams?.[0]?.nb_read_packets) || null
  } catch (error) {
    if (error.code === 'ABORTED') throw error
    return null
  }
}

const round3 = (n) => Math.round(n * 1000) / 1000
const startOf = (s) => (Number.isFinite(Number(s?.start_time)) ? Number(s.start_time) : 0)
// Container duration: MPEG-PS/TS stream durations are unreliable.
const durationOf = (probed) => Number(probed?.format?.duration) || 0

/** True when the first decoded frames come out with increasing timestamps (display order). */
async function timestampsIncrease(file, streamIndex, signal) {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', String(streamIndex), '-read_intervals', '%+#300', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file], signal, 5 * 60_000)
  const times = String(out).split('\n').map((line) => Number.parseFloat(line)).filter(Number.isFinite)
  return times.every((t, i) => i === 0 || t > times[i - 1])
}

/**
 * Compare the derivative with the original: video frame count, video duration,
 * and the audio start relative to the video (A/V offset). Notes what moved.
 */
async function verify(input, inputProbe, output, outputProbe, plan, signal) {
  const sv = inputProbe.streams.find((s) => s.index === plan.videoIndex)
  const ov = videoStreamOf(outputProbe)
  const sa = plan.audioIndex === null ? null : inputProbe.streams.find((s) => s.index === plan.audioIndex)
  const oa = audioStreamOf(outputProbe)
  const frames = [await countFrames(input, plan.videoIndex, signal), await countFrames(output, ov.index, signal)]
  const duration = [round3(durationOf(inputProbe)), round3(durationOf(outputProbe))]
  const result = {
    frames,
    framesMatch: frames[0] !== null && frames[0] === frames[1],
    duration,
    durationDelta: round3(duration[1] - duration[0]),
    firstFrameDecoded: true,
  }
  if (sa && oa) {
    const offsetMs = Math.round((startOf(oa) - startOf(ov) - (startOf(sa) - startOf(sv))) * 1e4) / 10
    result.audioOffsetDeltaMs = offsetMs
    const why = plan.audio && !plan.audio.copy ? `${sa.codec_name} decoder priming` : 'the original\'s container start times'
    if (Math.abs(offsetMs) >= 1)
      plan.notes.push(`audio starts ${Math.abs(offsetMs)} ms ${offsetMs > 0 ? 'later' : 'earlier'} relative to video than in the original (${why})`)
  }
  const frameSeconds = 1 / (parseRate(sv?.avg_frame_rate) || 30)
  if (Math.abs(result.durationDelta) >= frameSeconds)
    plan.notes.push(`duration differs by ${result.durationDelta} s (${duration[0]} s original, ${duration[1]} s working copy)`)
  if (!result.framesMatch && frames[0] !== null && frames[1] !== null)
    plan.notes.push(`frame count differs: ${frames[0]} in the original, ${frames[1]} in the working copy`)
  return result
}

/** Encode `policy` into a temporary file in the cache dir; probe and decode-check it. */
async function encode(source, input, policy, dir, { signal, onProgress }) {
  const temporary = path.join(dir, `.${crypto.randomUUID()}.${policy.format}`)
  try {
    await runEncode(compatibilityArgs(policy, input, source, temporary), {
      signal,
      timeout: 30 * 60_000,
      duration: Number(input.format?.duration) || 0,
      onProgress,
    })
    const output = await probeCompatibility(temporary, signal)
    const video = videoStreamOf(output)
    if (!video || !(Number(output.format?.duration) > 0))
      throw new CompatibilityError('INVALID_OUTPUT', 'Preparation produced no usable video stream')
    // A valid header is insufficient: exercise the produced decoder before publish.
    // ffmpeg's native VP9 decoder ignores alpha; libvpx reads it.
    const decoder = policy.action === 'vp9-alpha' ? ['-c:v', 'libvpx-vp9'] : []
    await run('ffmpeg', ['-v', 'error', '-xerror', ...decoder, '-i', temporary, '-frames:v', '1', '-f', 'null', '-'], signal)
    const outOfOrder = policy.action === 'rewrap' && !(await timestampsIncrease(temporary, video.index, signal))
    return { temporary, output, outOfOrder }
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

/** Stream copy came out with decode-order timestamps: re-encode instead. */
function reencodePlan(input, rewrap) {
  const plan = { ...compatibilityPolicy(input, true), reason: rewrap.reason, detail: rewrap.detail }
  plan.notes.push('stream copy had out-of-order frame timestamps (packed B-frames), so the video was re-encoded')
  return plan
}

async function prepare(source, mediaDir, { force, signal, onProgress }) {
  const cached = resolveCompatibleMedia(source, mediaDir)
  if (cached) return { file: cached, manifest: readManifest(mediaDir), cached: true }
  await acquire(signal)
  let temporary
  try {
    signal?.throwIfAborted()
    const sourceIdentity = identity(source)
    const input = await probeCompatibility(source, signal)
    let policy = compatibilityPolicy(input, force)
    if (!policy) return null
    const dir = path.join(mediaDir, ...CACHE)
    fs.mkdirSync(dir, { recursive: true })
    const startedAt = Date.now()
    let encoded = await encode(source, input, policy, dir, { signal, onProgress })
    temporary = encoded.temporary
    if (encoded.outOfOrder) {
      fs.rmSync(temporary, { force: true })
      policy = reencodePlan(input, policy)
      encoded = await encode(source, input, policy, dir, { signal, onProgress })
      temporary = encoded.temporary
    }
    const verification = await verify(source, input, temporary, encoded.output, policy, signal)
    if (JSON.stringify(identity(source)) !== JSON.stringify(sourceIdentity))
      throw new CompatibilityError('SOURCE_CHANGED', 'Source changed during media preparation; retry.')
    const hash = crypto.createHash('sha256').update(JSON.stringify({ sourceIdentity, policy })).digest('hex')
    const file = `${hash}.${policy.format}`
    const manifest = {
      version: VERSION,
      file,
      source: sourceIdentity,
      outputSize: fs.statSync(temporary).size,
      policy,
      probe: encoded.output,
      original: describeMedia(input),
      derivative: describeMedia(encoded.output),
      settings: describeSettings(policy),
      notes: policy.notes,
      verification,
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
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
