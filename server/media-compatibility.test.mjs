import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  compatibilityPolicy,
  prepareCompatibleMedia,
  resolveCompatibleMedia,
  probeCompatibility,
} from './media-compatibility.mjs'
import { importMediaByPath } from './media-bridge.mjs'
import { resolveMediaFile } from '../headless/lib/workspace.mjs'

const ffmpeg = (...args) =>
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { timeout: 30_000 })
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-compat-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const mediaDir = path.join(root, 'media', 'test')
  fs.mkdirSync(mediaDir, { recursive: true })
  return { root, mediaDir }
}
function fixture(file, alpha = false) {
  ffmpeg(
    '-f',
    'lavfi',
    '-i',
    alpha ? 'color=red@0.25:s=64x48:r=10:d=0.5,format=rgba' : 'testsrc2=s=64x48:r=10:d=0.5',
    '-c:v',
    alpha ? 'png' : 'mpeg4',
    file,
  )
}

test('policy distinguishes compatible, alpha, unsupported, and HDR inputs', () => {
  const probe = (codec, pix_fmt = 'yuv420p', extra = {}) => ({
    streams: [{ codec_type: 'video', codec_name: codec, pix_fmt, ...extra }],
  })
  assert.equal(compatibilityPolicy(probe('h264')), null)
  assert.equal(compatibilityPolicy(probe('prores', 'yuva444p12le')), null)
  assert.equal(compatibilityPolicy(probe('png', 'rgba')).alpha, true)
  assert.equal(compatibilityPolicy(probe('mpeg4')).format, 'mp4')
  assert.equal(compatibilityPolicy(probe('h264'), true).reason, 'decode-failed')
  assert.throws(
    () => compatibilityPolicy(probe('hevc', 'yuv420p10le', { color_transfer: 'smpte2084' }), true),
    (e) => e.code === 'HDR_POLICY_REQUIRED',
  )
})

test('opaque derivative is decodable, cached, shared by headless export, and invalidated by source changes', async (t) => {
  const { root, mediaDir } = setup(t)
  const source = path.join(mediaDir, 'source.mov')
  fixture(source)
  const original = fs.readFileSync(source)
  const [a, b] = await Promise.all([
    prepareCompatibleMedia(source, mediaDir),
    prepareCompatibleMedia(source, mediaDir),
  ])
  assert.equal(a.file, b.file)
  assert.equal(b.cached, true)
  assert.equal(a.manifest.probe.streams[0].codec_name, 'h264')
  assert.equal(a.manifest.probe.streams[0].pix_fmt, 'yuv420p')
  assert.equal(resolveMediaFile(root, 'test'), fs.realpathSync(a.file))
  assert.equal(resolveMediaFile(root, 'test', { original: true }), fs.realpathSync(source))
  assert.deepEqual(fs.readFileSync(source), original)
  const future = new Date(Date.now() + 5000)
  fs.utimesSync(source, future, future)
  assert.equal(resolveCompatibleMedia(source, mediaDir), null)
})

test('PNG MOV fallback preserves fractional alpha through ProRes 4444', async (t) => {
  const { mediaDir } = setup(t)
  const source = path.join(mediaDir, 'overlay.mov')
  fixture(source, true)
  const result = await prepareCompatibleMedia(source, mediaDir)
  assert.equal(result.manifest.policy.alpha, true)
  assert.equal(result.manifest.probe.streams[0].codec_name, 'prores')
  const pixels = ffmpeg(
    '-i',
    result.file,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-',
  )
  assert.ok(pixels[3] >= 55 && pixels[3] <= 75, `alpha ${pixels[3]} should remain ~25%`)
})

test('path import writes effective metadata and preserves original identity', async (t) => {
  const { root } = setup(t)
  const source = path.join(root, 'legacy.mov')
  fixture(source)
  const [result] = await importMediaByPath(root, [source], { mode: 'link' })
  assert.equal(result.error, undefined)
  assert.equal(result.metadata.codec, 'avc')
  assert.equal(result.metadata.compatibility.backend, 'native')
  assert.equal(result.metadata.fileName, 'legacy.mov')
  assert.equal(result.metadata.fileSize, fs.statSync(source).size)
  assert.notEqual(resolveMediaFile(root, result.id), source)
  const info = await probeCompatibility(resolveMediaFile(root, result.id))
  assert.equal(info.streams[0].codec_name, 'h264')
})

test('failed and cancelled jobs publish no manifest and release their slot', async (t) => {
  const { mediaDir } = setup(t)
  const source = path.join(mediaDir, 'broken.mov')
  fs.writeFileSync(source, 'invalid')
  await assert.rejects(prepareCompatibleMedia(source, mediaDir), (e) => e.code === 'MEDIA_FAILED')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(prepareCompatibleMedia(source, mediaDir, { signal: controller.signal }))
  assert.equal(fs.existsSync(path.join(mediaDir, 'cache', 'compatibility', 'manifest.json')), false)
  fixture(source)
  assert.ok(await prepareCompatibleMedia(source, mediaDir))
})

test('preparation retains variable video timestamps and delayed audio timing', async (t) => {
  const { mediaDir } = setup(t)
  const source = path.join(mediaDir, 'variable.mov')
  ffmpeg(
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=64x48:r=10:d=1',
    '-itsoffset',
    '0.2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=0.7',
    '-filter:v',
    "setpts='if(lt(N,5),N/(10*TB),(5/(10*TB)+(N-5)/(5*TB)))'",
    '-fps_mode',
    'vfr',
    '-c:v',
    'mpeg4',
    '-c:a',
    'pcm_s16le',
    source,
  )
  const result = await prepareCompatibleMedia(source, mediaDir)
  const timestamps = (file) =>
    JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_frames',
        '-show_entries',
        'frame=best_effort_timestamp_time',
        '-of',
        'json',
        file,
      ]),
    ).frames.map((f) => Number(f.best_effort_timestamp_time))
  const original = timestamps(source),
    prepared = timestamps(result.file)
  assert.equal(prepared.length, original.length)
  prepared.forEach((pts, i) =>
    assert.ok(Math.abs(pts - original[i]) < 0.002, `frame ${i}: ${pts} vs ${original[i]}`),
  )
  const firstSignal = (file) => {
    const bytes = ffmpeg(
      '-i',
      file,
      '-map',
      '0:a:0',
      '-af',
      'aresample=48000:async=1:first_pts=0',
      '-ac',
      '1',
      '-f',
      's16le',
      '-',
    )
    for (let i = 0; i < bytes.length / 2; i++)
      if (Math.abs(bytes.readInt16LE(i * 2)) > 1000) return i / 48000
    throw new Error('Missing audio signal')
  }
  assert.ok(Math.abs(firstSignal(source) - firstSignal(result.file)) < 0.025)
})

test('cancelling a waiter does not cancel the active preparation', async (t) => {
  const { mediaDir } = setup(t)
  const source = path.join(mediaDir, 'shared.mov')
  fixture(source)
  const owner = prepareCompatibleMedia(source, mediaDir)
  const controller = new AbortController()
  const waiter = prepareCompatibleMedia(source, mediaDir, { signal: controller.signal })
  controller.abort()
  await assert.rejects(waiter, (e) => e.code === 'ABORTED')
  assert.ok(await owner)
})
