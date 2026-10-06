// Real native import -> browser compositor -> export regression. Requires a build,
// local ffmpeg/ffprobe, and Chrome. All fixtures and browser processes are cleaned up.
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
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { timeout: 30_000 })
let server, browser
try {
  server = await createHarnessServer({
    distDir: path.join(repo, 'dist'),
    resolveMedia: (id) => resolveMediaFile(root, id),
  })
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: chromeLaunchArgs() })
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  await page.goto(server.harnessUrl)
  await page.waitForFunction(() => window.freecut?.ready)
  for (const alpha of [false, true]) {
    const name = alpha ? 'alpha' : 'opaque'
    const source = path.join(root, `${name}.mov`)
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      alpha ? 'color=red@0.25:s=64x48:r=10:d=0.5,format=rgba' : 'color=red:s=64x48:r=10:d=0.5',
      '-c:v',
      alpha ? 'png' : 'mpeg4',
      source,
    )
    const [imported] = await importMediaByPath(root, [source], { mode: 'link' })
    assert.equal(imported.error, undefined)
    const item = {
      id: 'clip',
      type: 'video',
      trackId: 'v1',
      from: 0,
      durationInFrames: 5,
      label: name,
      mediaId: imported.id,
      src: '',
      sourceStart: 0,
      sourceEnd: 5,
      sourceDuration: 5,
      sourceFps: 10,
      speed: 1,
      volume: 0,
    }
    const track = {
      id: 'v1',
      name: 'V1',
      kind: 'video',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    }
    const media = [
      { mediaId: imported.id, url: server.mediaUrl(imported.id), metadata: imported.metadata },
    ]
    const project = {
      id: `p-${name}`,
      name,
      schemaVersion: 10,
      createdAt: 1,
      updatedAt: 1,
      duration: 5,
      metadata: { width: 64, height: 48, fps: 10, backgroundColor: '#0000ff' },
      timeline: {
        tracks: [track],
        items: [item],
        transitions: [],
        keyframes: [],
        compositions: [],
        masterBusDb: 0,
      },
    }
    for (const atSeconds of [0, 0.3, 0.1]) {
      const download = page.waitForEvent('download')
      const summary = await page.evaluate((input) => window.freecut.renderFrame(input), {
        project,
        media,
        atSeconds,
      })
      assert.equal(summary.ok, true)
      const frame = path.join(root, `${name}-${atSeconds}.png`)
      await (await download).saveAs(frame)
      const pixels = ffmpeg(
        '-i',
        frame,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-',
      )
      const pixel = [...pixels.subarray((24 * 64 + 32) * 3, (24 * 64 + 32) * 3 + 3)]
      if (alpha)
        assert.ok(
          pixel[0] > 45 && pixel[0] < 90 && pixel[2] > 160,
          `transparent overlay over blue: ${pixel}`,
        )
      else assert.ok(pixel[0] > 200 && pixel[2] < 35, `opaque red: ${pixel}`)
    }
    const download = page.waitForEvent('download')
    const summary = await page.evaluate((input) => window.freecut.renderTimeline(input), {
      tracks: [track],
      items: [item],
      transitions: [],
      media,
      fps: 10,
      width: 64,
      height: 48,
      backgroundColor: '#0000ff',
      settings: {
        mode: 'video',
        codec: 'vp9',
        container: 'webm',
        quality: 'high',
        resolution: { width: 64, height: 48 },
        fps: 10,
        videoBitrate: 300_000,
      },
      outputFileName: `${name}.webm`,
    })
    const output = path.join(root, `${name}.webm`)
    await (await download).saveAs(output)
    assert.ok(summary.sizeBytes > 0 || fs.statSync(output).size > 100)
    const pixel = ffmpeg(
      '-i',
      output,
      '-frames:v',
      '1',
      '-vf',
      'crop=2:2:32:24',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    )
    if (alpha)
      assert.ok(
        pixel[0] > 40 && pixel[0] < 95 && pixel[2] > 150,
        `export alpha composite: ${[...pixel.subarray(0, 3)]}`,
      )
    else assert.ok(pixel[0] > 195 && pixel[2] < 40)
    console.log(
      `PASS ${name}: native import, first frame, forward/backward frame requests, browser composite, export pixels`,
    )
  }
} finally {
  await browser?.close()
  await server?.close()
  fs.rmSync(root, { recursive: true, force: true })
}
