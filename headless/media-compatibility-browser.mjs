// Real native import -> browser compositor -> export regression. Requires a build,
// local ffmpeg/ffprobe, and Chrome (always headless). All fixtures and browser
// processes are cleaned up.
//
// Covers each working-copy class Chrome must decode in the export path
// (renderFrame / renderTimeline through mediabunny + WebCodecs or the ProRes
// WASM decoder), the <video> element the editor previews with, and variable
// frame rate: frames rendered around a timestamp gap must be the source frames
// shown at those times.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { importMediaByPath } from '../server/media-bridge.mjs'
import { resolveMediaFile } from './lib/workspace.mjs'
import { createHarnessServer } from './server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-compat-browser-'))
const ffmpeg = (...args) =>
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { timeout: 60_000 })
const RED = 'color=red:s=64x48:r=10:d=0.5'
const AC3 = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5']
const cases = [
  { name: 'opaque', file: 'opaque.mov', action: 'h264', args: ['-f', 'lavfi', '-i', RED, '-c:v', 'mpeg4'] },
  { name: 'alpha', file: 'alpha.mov', action: 'prores-alpha', alpha: true, args: ['-f', 'lavfi', '-i', 'color=red@0.25:s=64x48:r=10:d=0.5,format=rgba', '-c:v', 'png'] },
  { name: 'hevc10', file: 'dnx.mov', action: 'hevc', args: ['-f', 'lavfi', '-i', `${RED.replace('64x48', '256x128')},format=yuv422p10le`, '-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx'], size: [256, 128] },
  { name: 'rewrap-mkv', file: 'vp9-ac3.mkv', action: 'rewrap', args: ['-f', 'lavfi', '-i', RED, ...AC3, '-c:v', 'libvpx-vp9', '-c:a', 'ac3'] },
]

function project(id, mediaId, { width = 64, height = 48, fps = 10, frames = 5 } = {}) {
  const item = { id: `clip-${id}`, type: 'video', trackId: 'v1', from: 0, durationInFrames: frames, label: id, mediaId, src: '', sourceStart: 0, sourceEnd: frames, sourceDuration: frames, sourceFps: fps, speed: 1, volume: 0 }
  const track = { id: 'v1', name: 'V1', kind: 'video', height: 60, locked: false, visible: true, muted: false, solo: false, order: 0, items: [] }
  return {
    item,
    track,
    project: {
      id: `p-${id}`, name: id, schemaVersion: 10, createdAt: 1, updatedAt: 1, duration: frames,
      metadata: { width, height, fps, backgroundColor: '#0000ff' },
      timeline: { tracks: [track], items: [item], transitions: [], keyframes: [], compositions: [], masterBusDb: 0 },
    },
  }
}

const rgbAt = (file, x, y, width) => {
  const pixels = ffmpeg('-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-')
  return [...pixels.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)]
}

let server, browser
try {
  server = await createHarnessServer({ distDir: path.join(repo, 'dist'), resolveMedia: (id) => resolveMediaFile(root, id) })
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: chromeLaunchArgs() })
  const context = await browser.newContext({ acceptDownloads: true })
  // A fresh tab per case: Chrome stops automatic downloads after several from one tab.
  let page
  const freshPage = async () => {
    await page?.close()
    page = await context.newPage()
    page.setDefaultTimeout(60_000)
    await page.goto(server.harnessUrl)
    await page.waitForFunction(() => window.freecut?.ready)
  }

  const renderFrame = async (input, out) => {
    const download = page.waitForEvent('download')
    const summary = await page.evaluate((value) => window.freecut.renderFrame(value), input)
    assert.equal(summary.ok, true)
    await (await download).saveAs(out)
    return out
  }
  // The editor previews with a <video> element: seek it and read a pixel.
  const videoPixel = (url, t, x, y) =>
    page.evaluate(
      async ({ url, t, x, y }) => {
        const v = document.createElement('video')
        v.muted = true
        v.src = url
        await new Promise((resolve, reject) => {
          v.onloadeddata = resolve
          v.onerror = () => reject(new Error(v.error?.message ?? 'video error'))
        })
        v.currentTime = t
        await new Promise((resolve) => (v.onseeked = resolve))
        const c = document.createElement('canvas')
        c.width = v.videoWidth
        c.height = v.videoHeight
        const g = c.getContext('2d')
        g.drawImage(v, 0, 0)
        return [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]
      },
      { url, t, x, y },
    )

  for (const spec of cases) {
    await freshPage()
    const source = path.join(root, spec.file)
    ffmpeg(...spec.args, '-t', '0.5', source)
    const before = fs.readFileSync(source)
    const [imported] = await importMediaByPath(root, [source], { mode: 'link', prepare: 'wait' })
    assert.equal(imported.error, undefined)
    assert.equal(imported.metadata.compatibility.status, 'ready', JSON.stringify(imported.metadata.compatibility))
    assert.equal(imported.metadata.compatibility.action, spec.action)
    const [width, height] = spec.size ?? [64, 48]
    const { project: p, item, track } = project(spec.name, imported.id, { width, height })
    const media = [{ mediaId: imported.id, url: server.mediaUrl(imported.id), metadata: imported.metadata }]
    const [cx, cy] = [width / 2, height / 2]
    for (const atSeconds of [0, 0.3, 0.1]) {
      const frame = await renderFrame({ project: p, media, atSeconds }, path.join(root, `${spec.name}-${atSeconds}.png`))
      const pixel = rgbAt(frame, cx, cy, width)
      if (spec.alpha) assert.ok(pixel[0] > 45 && pixel[0] < 90 && pixel[2] > 160, `transparent overlay over blue: ${pixel}`)
      else assert.ok(pixel[0] > 200 && pixel[2] < 35, `${spec.name} red: ${pixel}`)
    }
    if (!spec.alpha) {
      const pixel = await videoPixel(server.mediaUrl(imported.id), 0.2, cx, cy)
      assert.ok(pixel[0] > 200 && pixel[2] < 35, `${spec.name} <video> red: ${pixel}`)
    }
    const download = page.waitForEvent('download')
    const summary = await page.evaluate((input) => window.freecut.renderTimeline(input), {
      tracks: [track], items: [item], transitions: [], media, fps: 10, width, height, backgroundColor: '#0000ff',
      settings: { mode: 'video', codec: 'vp9', container: 'webm', quality: 'high', resolution: { width, height }, fps: 10, videoBitrate: 300_000 },
      outputFileName: `${spec.name}.webm`,
    })
    const output = path.join(root, `${spec.name}.webm`)
    await (await download).saveAs(output)
    assert.ok(summary.sizeBytes > 0 || fs.statSync(output).size > 100)
    const pixel = ffmpeg('-i', output, '-frames:v', '1', '-vf', `crop=2:2:${cx}:${cy}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-')
    if (spec.alpha) assert.ok(pixel[0] > 40 && pixel[0] < 95 && pixel[2] > 150, `export alpha composite: ${[...pixel.subarray(0, 3)]}`)
    else assert.ok(pixel[0] > 195 && pixel[2] < 40, `${spec.name} export: ${[...pixel.subarray(0, 3)]}`)
    assert.deepEqual(fs.readFileSync(source), before, 'original untouched')
    console.log(`PASS ${spec.name} (${spec.action}): native import, frame requests, <video>, composite, export pixels`)
  }

  // VFR: 10 fps for frames 0-4, then one frame every 0.4 s (0.8, 1.2, 1.6; ends at 1.7). Each frame has its
  // own grey level; frames rendered around the gap must be the ones the source
  // shows at those times (what ffmpeg decodes from the original).
  await freshPage()
  const vfr = path.join(root, 'vfr.mov')
  ffmpeg(
    '-f', 'lavfi', '-i', "color=black:s=64x48:r=10:d=0.8,geq=lum='16+N*25':cb=128:cr=128",
    '-vf', "setpts='if(lt(N,5),N/(10*TB),(0.4+(N-4)*0.4)/TB)'", '-fps_mode', 'vfr', '-c:v', 'mpeg4', '-q:v', '1', vfr,
  )
  const [imported] = await importMediaByPath(root, [vfr], { mode: 'link', prepare: 'wait' })
  assert.equal(imported.metadata.compatibility.status, 'ready')
  assert.equal(imported.metadata.compatibility.verification.durationDelta, 0, 'working copy keeps the last frame duration')
  assert.equal(imported.metadata.duration, 1.7)
  const { project: p } = project('vfr', imported.id, { fps: 20, frames: 40 })
  const media = [{ mediaId: imported.id, url: server.mediaUrl(imported.id), metadata: imported.metadata }]
  const grey = (file) => rgbAt(file, 32, 24, 64)[1]
  // The frame on screen at t is the last one whose timestamp is <= t.
  const pts = String(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', vfr]),
  ).trim().split('\n').map((line) => Number.parseFloat(line))
  assert.deepEqual(pts.map((v) => Math.round(v * 10) / 10), [0, 0.1, 0.2, 0.3, 0.4, 0.8, 1.2, 1.6])
  for (const t of [0.35, 0.45, 0.65, 0.95, 1.35, 1.65]) {
    const index = pts.findLastIndex((v) => v <= t + 1e-6)
    const reference = path.join(root, `vfr-ref-${t}.png`)
    ffmpeg('-i', vfr, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', reference)
    const expected = grey(reference)
    const exported = grey(await renderFrame({ project: p, media, atSeconds: t }, path.join(root, `vfr-${t}.png`)))
    const previewed = (await videoPixel(server.mediaUrl(imported.id), t, 32, 24))[1]
    assert.ok(Math.abs(exported - expected) <= 6, `VFR export at ${t}s: grey ${exported}, source shows ${expected}`)
    assert.ok(Math.abs(previewed - expected) <= 6, `VFR <video> at ${t}s: grey ${previewed}, source shows ${expected}`)
  }
  console.log('PASS vfr: export and <video> frames around a 0.4 s timestamp gap match the source timing')
} finally {
  await browser?.close()
  await server?.close()
  fs.rmSync(root, { recursive: true, force: true })
}
