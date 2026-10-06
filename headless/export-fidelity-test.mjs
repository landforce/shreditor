// Browser-export fidelity against ffmpeg-made fixtures: A/V sync and the
// decode colour of full-range BT.601 H.264. Needs ffmpeg/ffprobe (skips
// without them) and a built harness (npm run build).
//
// - A/V: white flash frames and 2 ms clicks at the same instants, cut at a
//   source time that is not on an AAC packet boundary. Every click must land
//   within 5 ms of its flash (it was 44-60 ms late: an uncompensated AAC
//   encoder delay plus range decodes starting at the packet before the cut).
// - Colour: SMPTE bars as full-range BT.601 without a `colr` box (phone
//   footage). The export must match the source decoded by its tags (it was
//   decoded as BT.709, visibly yellow-green).
//
// Run: npm run headless:test:fidelity
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createHarnessServer } from './server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FPS = 30
const W = 360
const H = 640
const FLASH_FRAMES = [15, 50, 95]

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...options })

function makeFixtures(dir) {
  const flashes = FLASH_FRAMES.map((f) => `eq(n\\,${f})`).join('+')
  const clicks = FLASH_FRAMES.map((f) => `between(t,${f / FPS},${f / FPS + 0.002})`).join('+')
  const av = path.join(dir, 'av.mp4')
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=black:s=${W}x${H}:r=${FPS}:d=4`,
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=exprs='0.8*(${clicks})|0.8*(${clicks})':s=48000:d=4`,
    '-vf',
    `drawbox=c=white:t=fill:enable='${flashes}',format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-g',
    '30',
    '-colorspace',
    'bt709',
    '-color_range',
    'tv',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    av,
  ])
  const bars = path.join(dir, 'bars-601-full.mp4')
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `smptehdbars=s=${W}x${H}:r=${FPS}:d=1`,
    '-vf',
    'scale=out_color_matrix=bt601:out_range=full,format=yuvj420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '10',
    '-colorspace',
    'bt470bg',
    '-color_range',
    'pc',
    bars,
  ])
  return { av, bars }
}

const media = (mediaId, url, extra) => ({
  mediaId,
  url,
  metadata: {
    id: mediaId,
    mimeType: 'video/mp4',
    width: W,
    height: H,
    fps: FPS,
    codec: 'avc',
    videoCodecSupported: true,
    ...extra,
  },
})

function clip(id, type, trackId, mediaId, from, sourceStart, duration, sourceDuration) {
  return {
    id,
    type,
    trackId,
    mediaId,
    from,
    durationInFrames: duration,
    label: id,
    src: '',
    sourceStart,
    sourceEnd: sourceStart + duration,
    sourceDuration,
    sourceFps: FPS,
    speed: 1,
    volume: 0,
    ...(type === 'video' ? { sourceWidth: W, sourceHeight: H } : {}),
    linkedGroupId: id.replace(/-(v|a)$/, ''),
  }
}

const track = (id, kind, order) => ({
  id,
  name: id,
  kind,
  order,
  height: 60,
  locked: false,
  syncLock: true,
  visible: true,
  muted: false,
  solo: false,
  volume: 0,
  items: [],
})

function timeline(server) {
  // Cut B starts at source frame 47 (75200 samples, 448 into an AAC packet).
  return {
    tracks: [track('v1', 'video', 0), track('a1', 'audio', 1)],
    items: [
      clip('a-v', 'video', 'v1', 'av', 0, 0, 40, 120),
      clip('a-a', 'audio', 'a1', 'av', 0, 0, 40, 120),
      clip('b-v', 'video', 'v1', 'av', 40, 47, 60, 120),
      clip('b-a', 'audio', 'a1', 'av', 40, 47, 60, 120),
      { ...clip('bars', 'video', 'v1', 'bars', 100, 0, 30, 30), linkedGroupId: undefined },
    ],
    transitions: [],
    fps: FPS,
    width: W,
    height: H,
    backgroundColor: '#000000',
    media: [
      media('av', server.mediaUrl('av'), {
        fileName: 'av.mp4',
        duration: 4,
        audioCodec: 'aac',
        audioCodecSupported: true,
      }),
      media('bars', server.mediaUrl('bars'), { fileName: 'bars-601-full.mp4', duration: 1 }),
    ],
    settings: {
      mode: 'video',
      codec: 'avc',
      container: 'mp4',
      quality: 'high',
      resolution: { width: W, height: H },
      fps: FPS,
      videoBitrate: 8_000_000,
      audioBitrate: 192_000,
    },
    outputFileName: 'fidelity.mp4',
  }
}

/** Times of flash onsets (video) and click onsets (audio), as a player decodes them. */
// Test measurement script, run end to end by npm run headless:test:fidelity
// fallow-ignore-next-line complexity
function measureAvSync(file) {
  const probe = JSON.parse(
    run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'frame=best_effort_timestamp_time',
      '-of',
      'json',
      file,
    ]).toString(),
  )
  const pts = probe.frames.map((f) => Number(f.best_effort_timestamp_time))
  const luma = run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-vf',
    'scale=1:1:flags=area,format=gray',
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-',
  ])
  const flashes = []
  for (let i = 0; i < luma.length && i < 100; i++) {
    if (luma[i] > 128 && !(luma[i - 1] > 128)) flashes.push(pts[i])
  }
  const pcm = run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-map',
    '0:a:0',
    '-af',
    'aresample=async=1:first_pts=0',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-f',
    'f32le',
    '-',
  ])
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4)
  const clicks = []
  let last = -Infinity
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) < 0.25) continue
    if (i - last > 4800) clicks.push(i / 48_000)
    last = i
  }
  return { flashes, clicks }
}

const rgb = (file, startFrame, frames) =>
  run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-vf',
    `trim=start_frame=${startFrame}:end_frame=${startFrame + frames},setpts=PTS-STARTPTS,format=rgb24`,
    '-f',
    'rawvideo',
    '-',
  ])

// Centres of the seven top SMPTE HD bars (grey, white... blue), as fractions of the width.
const BAR_CENTRES = [0.063, 0.285, 0.393, 0.502, 0.61, 0.715, 0.823]

/** Mean RGB of each top bar's centre over all frames. */
function barColours(frames) {
  const frameBytes = W * H * 3
  // fallow-ignore-next-line complexity
  return BAR_CENTRES.map((fraction) => {
    const cx = Math.round(fraction * W)
    const sum = [0, 0, 0]
    let count = 0
    for (let f = 0; f + frameBytes <= frames.length; f += frameBytes) {
      for (let y = Math.round(H * 0.15); y < Math.round(H * 0.35); y++) {
        for (let x = cx - 4; x <= cx + 4; x++) {
          const at = f + (y * W + x) * 3
          for (let c = 0; c < 3; c++) sum[c] += frames[at + c]
          count++
        }
      }
    }
    return sum.map((v) => v / count)
  })
}

// fallow-ignore-next-line complexity
async function main() {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    if (spawnSync(tool, ['-version']).status !== 0) {
      process.stdout.write(`Export fidelity skipped: ${tool} not found\n`)
      return
    }
  }
  const distDir = path.join(ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    throw new Error('dist/headless.html is missing; run npm run build first')
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-fidelity-'))
  const fixtures = makeFixtures(tempDir)
  const server = await createHarnessServer({
    distDir,
    resolveMedia: (id) => ({ av: fixtures.av, bars: fixtures.bars })[id] ?? null,
  })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: chromeLaunchArgs(),
  })
  try {
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage()
    await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
    const download = page.waitForEvent('download', { timeout: 120_000 })
    const summary = await page.evaluate(
      (input) => window.freecut.renderTimeline(input),
      timeline(server),
    )
    const output = path.join(tempDir, 'fidelity.mp4')
    await (await download).saveAs(output)
    assert.equal(summary.ok, true)

    const { flashes, clicks } = measureAvSync(output)
    const expected = [15, 43, 88].map((f) => f / FPS)
    assert.deepEqual(
      flashes.map((t) => Math.round(t * FPS)),
      [15, 43, 88],
      `flashes ${flashes}`,
    )
    const offsets = expected.map((t) => {
      const click = clicks.reduce(
        (best, c) => (Math.abs(c - t) < Math.abs(best - t) ? c : best),
        Infinity,
      )
      return (click - t) * 1000
    })
    for (const offset of offsets)
      assert.ok(Math.abs(offset) < 5, `click minus flash ${offsets.map((o) => o.toFixed(2))} ms`)

    // Decoded as BT.709 the yellow bar's green is 15 levels low and cyan's red 15
    // off. Decoded by its tags every bar is within ~5 (the hardware decoder's
    // full-to-limited range step loses a few levels on saturated colours).
    const exported = barColours(rgb(output, 105, 20))
    const source = barColours(rgb(fixtures.bars, 5, 20))
    const colour = Math.max(
      ...exported.flatMap((bar, i) => bar.map((v, c) => Math.abs(v - source[i][c]))),
    )
    assert.ok(
      colour < 8,
      `full-range BT.601 bar colours differ from the source by up to ${colour.toFixed(1)} levels`,
    )

    process.stdout.write(
      `Export fidelity passed: click-flash ${offsets.map((o) => o.toFixed(2)).join(', ')} ms; ` +
        `BT.601 full-range bar colours within ${colour.toFixed(1)} levels of the source\n`,
    )
  } finally {
    await browser.close()
    await server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`Export fidelity failed: ${error.stack ?? error}\n`)
  process.exitCode = 1
})
