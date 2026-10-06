import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  compatibilityArgs,
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

const probeOf = (codec, pix_fmt = 'yuv420p', extra = {}, format = 'mov,mp4,m4a,3gp,3g2,mj2', audio) => ({
  format: { format_name: format, duration: '1' },
  streams: [
    { index: 0, codec_type: 'video', codec_name: codec, pix_fmt, width: 64, height: 48, ...extra },
    ...(audio ? [{ index: 1, codec_type: 'audio', codec_name: audio, sample_fmt: 'fltp', sample_rate: '48000', channels: 2 }] : []),
  ],
})

test('policy keeps what Chrome decodes and classifies the rest', () => {
  const plan = (...args) => compatibilityPolicy(probeOf(...args), false, { platform: 'darwin' })
  for (const [codec, pix] of [['h264', 'yuv444p'], ['h264', 'yuv422p10le'], ['hevc', 'yuv420p10le'], ['hevc', 'yuv444p10le'], ['vp9', 'yuv444p'], ['av1', 'yuv420p10le'], ['prores', 'yuva444p12le']])
    assert.equal(plan(codec, pix), null, `${codec} ${pix} plays as is`)
  assert.equal(plan('hevc', 'yuv420p10le', { color_transfer: 'smpte2084', color_primaries: 'bt2020' }), null, 'HDR HEVC plays as is')
  assert.equal(plan('png', 'rgba').action, 'prores-alpha')
  assert.equal(plan('mpeg4').action, 'h264')
  assert.deepEqual(plan('png', 'rgb24').video, { codec: 'h264', pixFmt: 'yuv444p', crf: 12 })
  assert.deepEqual(plan('dnxhd', 'yuv422p10le').video, { codec: 'hevc', pixFmt: 'yuv422p10le', crf: 12 })
  const hdr = plan('dnxhd', 'yuv422p10le', { color_transfer: 'arib-std-b67', color_primaries: 'bt2020' })
  assert.equal(hdr.action, 'hevc', 'HDR that needs conversion stays HDR (HEVC Main10)')
  const audio = plan('h264', 'yuv420p', {}, 'mov,mp4,m4a,3gp,3g2,mj2', 'ac3')
  assert.equal(audio.action, 'rewrap')
  assert.deepEqual(audio.audio, { codec: 'pcm_f32le', copy: false, from: 'ac3' })
  assert.equal(plan('h264', 'yuv420p', {}, 'avi').action, 'rewrap')
  assert.equal(plan('vp9', 'yuv420p', {}, 'mpegts').format, 'mkv')
  assert.equal(plan('prores', 'yuv422p10le', {}, 'mov,mp4,m4a,3gp,3g2,mj2', 'ac3').action, 'rewrap')
  assert.equal(compatibilityPolicy(probeOf('h264'), true, { platform: 'darwin' }).reason, 'decode-failed')
  assert.equal(compatibilityPolicy(probeOf('prores', 'yuva444p12le'), true, { platform: 'darwin' }).action, 'vp9-alpha')
  assert.throws(
    () => compatibilityPolicy(probeOf('dnxhd', 'yuv422p10le', { color_transfer: 'smpte2084' }), false, { platform: 'linux' }),
    (e) => e.code === 'HDR_POLICY_REQUIRED',
  )
  assert.equal(compatibilityPolicy(probeOf('hevc', 'yuv420p10le'), false, { platform: 'linux' }).action, 'h264')
})

test('conversion arguments carry colour faithfully and never invent tags', () => {
  const rgb = probeOf('png', 'rgb24', { color_primaries: 'smpte432', color_transfer: 'iec61966-2-1', color_space: 'gbr', color_range: 'pc', time_base: '1/15360' })
  const args = compatibilityArgs(compatibilityPolicy(rgb, false, { platform: 'darwin' }), rgb, 'in.mov', 'out.mov').join(' ')
  assert.match(args, /out_color_matrix=bt709:out_range=tv/, 'RGB->YUV uses BT.709, not swscale BT.601')
  assert.match(args, /-color_primaries smpte432 -color_trc iec61966-2-1 -colorspace bt709 -color_range tv/)
  assert.match(args, /-crf 12/)
  assert.match(args, /-fps_mode passthrough/)
  assert.match(args, /-video_track_timescale 15360/)
  const untagged = probeOf('mpeg4')
  const plain = compatibilityArgs(compatibilityPolicy(untagged, false, { platform: 'darwin' }), untagged, 'in.mov', 'out.mov').join(' ')
  assert.doesNotMatch(plain, /-color_primaries|-color_trc|-colorspace/)
  const hlg = probeOf('dnxhd', 'yuv422p10le', { color_primaries: 'bt2020', color_transfer: 'arib-std-b67', color_space: 'bt2020nc', color_range: 'tv' })
  const hlgArgs = compatibilityArgs(compatibilityPolicy(hlg, false, { platform: 'darwin' }), hlg, 'i', 'o.mov').join(' ')
  assert.match(hlgArgs, /libx265.*-color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc/)
  // Frames are relabelled with the stream's tags first, so no matrix conversion happens.
  assert.match(hlgArgs, /-vf setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv,scale=/)
  assert.doesNotMatch(hlgArgs, /out_color_matrix/)
  const avi = probeOf('h264', 'yuv420p', {}, 'avi', 'ac3')
  const rewrap = compatibilityArgs(compatibilityPolicy(avi, false, { platform: 'darwin' }), avi, 'i', 'o.mov').join(' ')
  assert.match(rewrap, /-c:v copy/)
  assert.match(rewrap, /-c:a pcm_f32le/)
  assert.doesNotMatch(rewrap, /-vf/)
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
  const [result] = await importMediaByPath(root, [source], { mode: 'link', prepare: 'wait' })
  assert.equal(result.error, undefined)
  assert.equal(result.metadata.codec, 'avc')
  assert.equal(result.metadata.compatibility.backend, 'native')
  assert.equal(result.metadata.compatibility.status, 'ready')
  assert.equal(result.metadata.compatibility.original.video.codec, 'mpeg4')
  assert.equal(result.metadata.compatibility.derivative.video.codec, 'h264')
  assert.deepEqual(result.metadata.compatibility.verification.frames, [5, 5])
  assert.equal(result.metadata.compatibility.verification.durationDelta, 0)
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
  assert.equal(result.manifest.verification.durationDelta, 0, 'no B-frame reordering shortens VFR clips')
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
