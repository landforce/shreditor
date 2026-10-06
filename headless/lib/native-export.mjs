// Native export runtime: probes the ORIGINAL media, plans the export
// (native-plan.mjs), has the browser draw the overlay layers frame by frame on
// transparent (and the audio mix when it cannot be mirrored), composites
// everything with the system ffmpeg, verifies the result and publishes it to
// <workspace>/projects/<id>/exports/. Originals are only ever read.
//
// Exercised end to end by the native export checks in docs/native-export.md
// (no unit coverage, so complexity is not scored here).
// fallow-ignore-file complexity
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { buildFfmpegArgs, describePlan, planNativeExport } from './native-plan.mjs'
import { HttpError } from './http-security.mjs'
import { collectMediaIds, resolveMediaFile } from './workspace.mjs'

export class NativeExportRefused extends HttpError {
  constructor(refusals, { hdr = false } = {}) {
    super(422, 'NATIVE_EXPORT_REFUSED', `Native export refused: ${refusals.join('; ')}`)
    this.name = 'NativeExportRefused'
    this.refusals = refusals
    // HDR sources: no automatic browser fallback (it would convert to SDR).
    this.hdr = hdr
  }
}

function runTool(command, args, { timeout = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr })
        const what = error.code === 'ENOENT' ? `${command} is not installed` : `${command} failed`
        reject(new Error(`${what}: ${String(stderr || error.message).trim().slice(-2000)}`))
      },
    )
  })
}

async function probeFile(file) {
  const { stdout } = await runTool(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
    { timeout: 60_000 },
  )
  return JSON.parse(stdout)
}

/** Original file + ffprobe JSON for every media the project references. */
async function probeProjectMedia(workspace, project) {
  const media = {}
  for (const mediaId of collectMediaIds(project)) {
    const original = resolveMediaFile(workspace, mediaId, { original: true })
    if (!original) continue
    media[mediaId] = { original, probe: await probeFile(original) }
  }
  return media
}

// ---------------------------------------------------------------------------
// Frame sink: the page POSTs each overlay frame as an RGBA PNG (lossless,
// straight alpha); they land as one numbered image sequence per span, which the
// final ffmpeg reads directly. Requests may arrive out of order.
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_FRAME_BYTES = 256 * 1024 * 1024
const frameFile = (dir, frame) => path.join(dir, `${String(frame).padStart(7, '0')}.png`)

/** One overlay layer's frames: spans in, one PNG sequence directory per span out. */
class OverlayJob {
  constructor({ dir, layerId, spans, width, height }) {
    this.width = width
    this.height = height
    this.frameBytes = MAX_FRAME_BYTES
    this.spans = spans.map(([start, end]) => {
      const spanDir = path.join(dir, `${layerId}-${start}-${end}`)
      fs.mkdirSync(spanDir, { recursive: true })
      return { start, end, dir: spanDir }
    })
    this.seen = new Set()
    this.failure = null
  }

  async accept(frame, body) {
    if (this.failure) throw this.failure
    const span = this.spans.find((s) => frame >= s.start && frame < s.end)
    if (!span || this.seen.has(frame)) throw new Error(`unexpected overlay frame ${frame}`)
    if (body.length < 24 || !body.subarray(0, 8).equals(PNG_SIGNATURE))
      throw new Error(`overlay frame ${frame} is not a PNG`)
    const w = body.readUInt32BE(16)
    const h = body.readUInt32BE(20)
    if (w !== this.width || h !== this.height)
      throw new Error(`overlay frame ${frame} is ${w}x${h}, expected ${this.width}x${this.height}`)
    this.seen.add(frame)
    await fs.promises.writeFile(frameFile(span.dir, frame), body)
  }

  async finish() {
    for (const span of this.spans) {
      for (let frame = span.start; frame < span.end; frame++) {
        if (!this.seen.has(frame)) throw new Error(`overlay frame ${frame} never arrived`)
      }
    }
    return this.spans.map(({ start, end, dir }) => ({
      start,
      end,
      pattern: path.join(dir, '%07d.png'),
    }))
  }
}

/** Loopback HTTP endpoint the harness page posts overlay frames to (CORS-open, token-scoped). */
async function createFrameSink() {
  const jobs = new Map()
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST')
      res.setHeader('Access-Control-Allow-Headers', 'content-type')
      res.writeHead(204).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const job = jobs.get(url.pathname.slice(1))
    const frame = Number(url.searchParams.get('frame'))
    if (req.method !== 'POST' || !job || !Number.isInteger(frame)) {
      res.writeHead(404).end()
      return
    }
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > job.frameBytes) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      job
        .accept(frame, Buffer.concat(chunks))
        .then(() => res.writeHead(204).end())
        .catch((error) => {
          job.failure ??= error
          res.writeHead(422, { 'content-type': 'text/plain' }).end(String(error.message))
        })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    open(options) {
      const token = crypto.randomUUID()
      const job = new OverlayJob(options)
      jobs.set(token, job)
      return {
        url: `${base}/${token}`,
        job,
        close: () => jobs.delete(token),
      }
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verifyOutput(file, plan) {
  const { stdout } = await runTool('ffprobe', [
    '-v',
    'error',
    '-count_packets',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    file,
  ])
  const probe = JSON.parse(stdout)
  const video = probe.streams.find((s) => s.codec_type === 'video')
  const audio = probe.streams.find((s) => s.codec_type === 'audio')
  const problems = []
  const frames = Number(video?.nb_read_packets)
  if (!video) problems.push('no video stream')
  else if (frames !== plan.totalFrames)
    problems.push(`${frames} video frames, expected ${plan.totalFrames}`)
  if (video && (video.width !== plan.width || video.height !== plan.height))
    problems.push(`size ${video.width}x${video.height}, expected ${plan.width}x${plan.height}`)
  const wantAudio = plan.audio.route !== 'none'
  if (wantAudio && !audio) problems.push('no audio stream')
  if (!wantAudio && audio) problems.push('unexpected audio stream')
  const seconds = plan.totalFrames / plan.fps
  const audioSeconds = audio ? Number(audio.duration) : null
  // AAC adds at most one 1024-sample frame of padding at the end.
  if (audio && !(Math.abs(audioSeconds - seconds) <= 1024 / 48_000 + 0.001))
    problems.push(`audio lasts ${audioSeconds}s, video ${seconds}s`)
  if (problems.length) throw new Error(`Native export failed verification: ${problems.join('; ')}`)
  return {
    frames,
    seconds,
    videoCodec: video.codec_name,
    pixFmt: video.pix_fmt,
    color: {
      primaries: video.color_primaries,
      transfer: video.color_transfer,
      matrix: video.color_space,
      range: video.color_range,
    },
    audio: audio
      ? { codec: audio.codec_name, rate: Number(audio.sample_rate), seconds: audioSeconds }
      : null,
    bytes: Number(probe.format.size),
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const safeName = (name) => name.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'export'

export function exportsDir(workspace, projectId) {
  return path.join(workspace, 'projects', projectId, 'exports')
}

/** Plan only (no rendering): what would go native, what the browser draws, and why. */
async function planProjectExport({ workspace, project, options }) {
  const media = await probeProjectMedia(workspace, project)
  return planNativeExport({ project, media, options })
}

/**
 * Run a native export. `renderOverlay({ itemIds, spans, sinkUrl })` and
 * `renderBrowserAudio(outPath)` drive the harness page (the caller serializes
 * page work). Returns the published file and a report.
 */
export async function runNativeExport({
  workspace,
  projectId,
  project,
  options = {},
  renderOverlay,
  renderBrowserAudio,
  log = () => {},
}) {
  const started = Date.now()
  const plan = await planProjectExport({ workspace, project, options })
  if (!plan.ok) throw new NativeExportRefused(plan.refusals, { hdr: plan.hdrItems.length > 0 })
  for (const line of describePlan(plan)) log(`  ${line}`)

  const outDir = exportsDir(workspace, projectId)
  fs.mkdirSync(outDir, { recursive: true })
  const work = fs.mkdtempSync(path.join(outDir, '.native-'))
  const sink = await createFrameSink()
  const timings = {}
  try {
    const overlays = {}
    let t0 = Date.now()
    for (const layer of plan.layers.filter((l) => l.kind === 'overlay')) {
      const session = sink.open({
        dir: work,
        layerId: layer.id,
        spans: layer.spans,
        width: plan.width,
        height: plan.height,
      })
      try {
        await renderOverlay({ itemIds: layer.itemIds, spans: layer.spans, sinkUrl: session.url })
        overlays[layer.id] = await session.job.finish()
      } catch (error) {
        throw session.job.failure ?? error
      } finally {
        session.close()
      }
    }
    timings.overlaySeconds = (Date.now() - t0) / 1000

    let browserAudio = null
    if (plan.audio.route === 'browser') {
      t0 = Date.now()
      browserAudio = await renderBrowserAudio(path.join(work, 'browser-mix.wav'))
      timings.browserAudioSeconds = (Date.now() - t0) / 1000
    }

    const name = safeName(options.out ? path.parse(options.out).name : `${project.name ?? projectId}-native`)
    const finalPath = path.join(outDir, `${name}.${plan.output.container}`)
    const staged = path.join(work, `${name}.${plan.output.container}`)
    const args = buildFfmpegArgs(plan, { overlays, browserAudio, outPath: staged })
    t0 = Date.now()
    await runTool('ffmpeg', args)
    timings.encodeSeconds = (Date.now() - t0) / 1000
    const verification = await verifyOutput(staged, plan)
    fs.renameSync(staged, finalPath)
    const report = {
      engine: 'native',
      projectId,
      output: finalPath,
      codec: plan.output.codec,
      decisions: plan.decisions,
      layers: plan.layers.map((l) =>
        l.kind === 'native'
          ? { kind: l.kind, itemId: l.itemId, label: l.label, from: l.from, frames: l.frames, snapErrorPx: Number(l.geometry.snapError.toFixed(3)) }
          : { kind: l.kind, id: l.id, itemIds: l.itemIds, spans: l.spans },
      ),
      audio: { route: plan.audio.route, reasons: plan.audio.reasons, segments: plan.audio.segments.length },
      sources: plan.sources,
      summary: describePlan(plan),
      verification,
      timings: { ...timings, totalSeconds: (Date.now() - started) / 1000 },
    }
    fs.writeFileSync(`${finalPath}.export.json`, `${JSON.stringify(report, null, 2)}\n`)
    return report
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(500, 'NATIVE_EXPORT_FAILED', String(error.message ?? error))
  } finally {
    await sink.close()
    fs.rmSync(work, { recursive: true, force: true })
  }
}
