// Background removal end to end with the real model (docs/background-removal.md).
//
//   SHRED_CUTOUT_E2E=1 node headless/cutout-e2e.mjs        (needs `npm run build`, ffmpeg, network)
//
// Skipped unless SHRED_CUTOUT_E2E=1: it downloads the MODNet weights (26 MB)
// and SlimSAM-77 (encoder and decoder, 14-40 MB), all SHA-256 checked, and a
// portrait test image from the Transformers.js docs dataset (pinned revision
// and hash). In a scratch workspace it makes a short talking-head clip that
// pans across the image, starts the agent service on a free port, puts the
// clip over a solid green plate, runs `shred cutout --wait`, renders a frame
// and checks the room around the subject is green (cut out) while the face is
// not, then exports natively and checks the same on the exported file. Then
// the smart brush: a smart-eraser stroke over the subject's cardigan on one
// frame; its region must be tracked through the clip, the cardigan must show
// the plate on rendered frames before and after the painted one (where the
// pan has moved it), and the face must stay.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.SHRED_CUTOUT_E2E !== '1') {
  console.log('cutout e2e: skipped (set SHRED_CUTOUT_E2E=1 to download the model and run it)')
  process.exit(0)
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHRED = path.join(ROOT, 'skills/shreditor-edit/scripts/shred.mjs')
const IMAGE = {
  url: 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/542437c29cc5273cfd29e25c77696f2b349badd7/selfie_segmentation_landscape.png',
  sha256: '7b50f5ca48025bf0c5ea2d982b88f2ff2ecdf30c2529bf8c0ebaa4b29a95dc3a',
}
const GREEN = [30, 125, 58]

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutout-e2e-'))
const ws = path.join(dir, 'ws')
fs.mkdirSync(ws)
const port = await freePort()
const env = {
  ...process.env,
  SHRED_WORKSPACE: ws,
  SHRED_SERVICE: `http://127.0.0.1:${port}`,
  // Nothing listens here: no editor is started or touched.
  SHRED_EDITOR: `http://localhost:${await freePort()}`,
}
const shred = (...args) => execFileSync(process.execPath, [SHRED, ...args], { env, encoding: 'utf8' })

/** RGB of one pixel of an image file, via ffmpeg (x, y as fractions of the frame). */
function pixel(file, fx, fy) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' })
    .trim()
    .split(',')
    .map(Number)
  const x = Math.round(fx * (w - 1))
  const y = Math.round(fy * (h - 1))
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return [...raw.subarray(0, 3)]
}
const near = (rgb, target, tol = 40) => rgb.every((v, i) => Math.abs(v - target[i]) <= tol)

let service
try {
  // A 3 s talking head in a real room, from a pinned portrait image.
  const png = Buffer.from(await (await fetch(IMAGE.url)).arrayBuffer())
  assert.equal(crypto.createHash('sha256').update(png).digest('hex'), IMAGE.sha256, 'test image hash')
  fs.writeFileSync(path.join(dir, 'person.png'), png)
  const clipFile = path.join(dir, 'person.mp4')
  // The 772x435 image scaled to 1600x900; a 1280x720 window pans right at 70 px/s.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-i', path.join(dir, 'person.png'), '-vf', "scale=1600:900,setsar=1,crop=1280:720:'100+70*t':90,format=yuv420p", '-t', '3', '-c:v', 'libx264', '-crf', '18', '-an', clipFile])

  service = spawn(process.execPath, [path.join(ROOT, 'headless/serve.mjs'), '--workspace', ws, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  service.stdout.on('data', (d) => (log += d))
  service.stderr.on('data', (d) => (log += d))
  for (let i = 0; ; i++) {
    if (i > 60) throw new Error(`service did not start:\n${log}`)
    if (await fetch(`${env.SHRED_SERVICE}/health`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 1000))
  }

  const projectId = shred('new', '--name', 'Cutout e2e').trim().split('\n')[0]
  const imported = shred('import', clipFile, '--project', projectId, '--category', 'speaker')
  const mediaId = /([0-9a-f-]{36})/.exec(imported)[1]
  const ops = {
    ops: [
      { callerId: 'bg', op: 'addItem', item: { type: 'shape', shapeType: 'rectangle', trackId: 'track-1', from: 0, durationInFrames: 90, label: 'Plate', fillColor: '#1e7d3a', transform: { x: 0, y: 0, width: 1080, height: 1920 } } },
      { callerId: 'top', op: 'addTrack', kind: 'video' },
      // Contained in the 1080x1920 canvas: the 16:9 clip spans y 0.342..0.658.
      { callerId: 'clip', op: 'addClip', mediaId, trackId: { $ref: 'top#/detail/trackId' }, from: 0, durationInFrames: 90 },
    ],
  }
  fs.writeFileSync(path.join(dir, 'ops.json'), JSON.stringify(ops))
  shred('apply', projectId, path.join(dir, 'ops.json'))
  const project = JSON.parse(fs.readFileSync(path.join(ws, 'projects', projectId, 'project.json'), 'utf8'))
  const clipId = project.timeline.items.find((item) => item.type === 'video').id

  const status = shred('cutout', projectId, clipId, '--subject', 'person', '--wait')
  console.log(status.trim())
  assert.match(status, /ready/, 'every needed mask is stored')
  const index = JSON.parse(fs.readFileSync(path.join(ws, 'media', mediaId, 'cache/cutout/index.json'), 'utf8'))
  const entry = Object.values(index.entries)[0]
  assert.equal(entry.model, 'modnet')

  // The face (source x 0.48, y 0.3) stays; the wall beside it (x 0.85) goes.
  const canvasY = 0.342 + 0.3 * 0.316
  const checkFrame = (file, label) => {
    const face = pixel(file, 0.48, canvasY)
    const room = pixel(file, 0.85, canvasY)
    console.log(`${label}: face ${face} room ${room}`)
    assert.ok(near(room, GREEN), `${label}: the room is cut out (shows the plate), got ${room}`)
    assert.ok(!near(face, GREEN, 60), `${label}: the subject is opaque, got ${face}`)
  }
  const frame = path.join(dir, 'frame.png')
  const res = await fetch(`${env.SHRED_SERVICE}/frame`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: projectId, frame: 45 }),
  })
  assert.equal(res.status, 200)
  fs.writeFileSync(frame, Buffer.from(await res.arrayBuffer()))
  checkFrame(frame, 'frame 45')

  const exported = await (
    await fetch(`${env.SHRED_SERVICE}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: projectId, engine: 'native', codec: 'h264', quality: 'high', out: 'cutout' }),
    })
  ).json()
  assert.equal(exported.engine, 'native', JSON.stringify(exported))
  assert.ok(exported.summary.some((line) => /background removal/.test(line)), exported.summary.join('\n'))
  const still = path.join(dir, 'export.png')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.5', '-i', exported.output, '-frames:v', '1', still])
  checkFrame(still, 'export 1.5 s')

  // Smart brush. Image fractions → source-frame fractions at time t (the pan), → canvas fractions.
  const toSource = ([ix, iy], t) => [(ix * 1600 - (100 + 70 * t)) / 1280, (iy * 900 - 90) / 720]
  const toCanvas = ([fx, fy]) => [fx, 0.342 + fy * 0.316]
  const renderFrame = async (frameNo) => {
    const out = path.join(dir, `smart-${frameNo}.png`)
    const r = await fetch(`${env.SHRED_SERVICE}/frame`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: projectId, frame: frameNo }),
    })
    assert.equal(r.status, 200)
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()))
    return out
  }
  const cardigan = [0.45, 0.82]
  const face = [0.5, 0.3]
  const before = pixel(frame, ...toCanvas(toSource(cardigan, 1.5)))
  assert.ok(!near(before, GREEN, 60), `before the stroke the cardigan is opaque, got ${before}`)
  const stroke = [[0.33, 0.85], [0.42, 0.8], [0.55, 0.8], [0.64, 0.85]]
    .map((p) => toSource(p, 1.5).map((v) => v.toFixed(4)).join(','))
    .join(';')
  const painted = shred('cutout', projectId, clipId, '--stroke', `smartEraser:${stroke}`, '--at', '1.5', '--size', '0.04', '--wait')
  console.log(painted.trim())
  assert.match(painted, /1 strokes \(1\/1 smart tracked\)/)
  const tracked = JSON.parse(fs.readFileSync(path.join(ws, 'media', mediaId, 'cache/cutout/index.json'), 'utf8'))
  const region = Object.values(tracked.regions ?? {})[0]
  assert.ok(region, 'the region is listed in the index')
  const samples = Object.keys(region.stats).map(Number).sort((a, b) => a - b)
  console.log(`region tracked over samples ${samples[0]}..${samples.at(-1)} (${samples.length}), painted on ${region.start}`)
  assert.ok(samples.length >= 25, `the region follows most of the clip, got ${samples.length} samples`)
  const cx = (i) => region.stats[i][0]
  assert.ok(cx(samples[0]) - cx(samples.at(-1)) > 0.1, 'the region moves left with the pan')
  for (const frameNo of [9, 45, 81]) {
    const t = frameNo / 30
    const file = await renderFrame(frameNo)
    const erased = pixel(file, ...toCanvas(toSource(cardigan, t)))
    const kept = pixel(file, ...toCanvas(toSource(face, t)))
    console.log(`smart erase frame ${frameNo}: cardigan ${erased} face ${kept}`)
    assert.ok(near(erased, GREEN), `frame ${frameNo}: the erased cardigan shows the plate, got ${erased}`)
    assert.ok(!near(kept, GREEN, 60), `frame ${frameNo}: the face stays, got ${kept}`)
  }
  console.log('cutout e2e: ok')
} finally {
  service?.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 1500))
  // SHRED_CUTOUT_E2E_KEEP=1 keeps the scratch folder (rendered frames, workspace) to look at.
  if (process.env.SHRED_CUTOUT_E2E_KEEP === '1') console.log(`kept ${dir}`)
  else fs.rmSync(dir, { recursive: true, force: true })
}
