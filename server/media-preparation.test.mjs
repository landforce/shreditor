import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { importMediaByPath } from './media-bridge.mjs'
import { readMetadata, retryPreparation, startPreparation, waitForPreparation } from './media-preparation.mjs'
import { collectAddClipMedia, resolveMediaFile } from '../headless/lib/workspace.mjs'

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { timeout: 60_000 })
const hash = (file, ...select) => String(ffmpeg('-i', file, ...select, '-f', 'hash', '-hash', 'md5', '-')).trim()
const VIDEO = ['-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10:d=1']
const AUDIO = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1']

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-prep-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('container/audio-only problems are rewrapped: video copied bit for bit, audio made PCM', async (t) => {
  const root = workspace(t)
  const source = path.join(root, 'camera.mp4')
  ffmpeg(...VIDEO, ...AUDIO, '-c:v', 'libx264', '-c:a', 'ac3', source)
  const before = fs.readFileSync(source)
  const [result] = await importMediaByPath(root, [source], { mode: 'link', prepare: 'wait' })
  const c = result.metadata.compatibility
  assert.equal(c.status, 'ready')
  assert.equal(c.action, 'rewrap')
  assert.equal(c.reason, 'audio-codec')
  assert.equal(c.derivative.audio.codec, 'pcm_f32le')
  assert.equal(c.derivative.audio.sampleRate, 48000)
  assert.match(c.settings, /video h264 copied/)
  const copy = resolveMediaFile(root, result.id)
  assert.notEqual(copy, source)
  assert.equal(hash(copy, '-map', '0:v:0', '-c', 'copy'), hash(source, '-map', '0:v:0', '-c', 'copy'))
  assert.equal(typeof c.verification.audioOffsetDeltaMs, 'number')
  assert.deepEqual(fs.readFileSync(source), before, 'original untouched')
})

test('AVI with packed B-frames is re-encoded instead of copied with decode-order timestamps', async (t) => {
  const root = workspace(t)
  const source = path.join(root, 'old.avi')
  ffmpeg(...VIDEO, '-c:v', 'libx264', '-bf', '2', source)
  const [result] = await importMediaByPath(root, [source], { mode: 'link', prepare: 'wait' })
  const c = result.metadata.compatibility
  assert.equal(c.status, 'ready')
  assert.equal(c.action, 'h264')
  assert.ok(c.notes.some((n) => /out-of-order/.test(n)), c.notes.join('; '))
  const times = String(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', resolveMediaFile(root, result.id)]),
  ).trim().split('\n').map((line) => Number.parseFloat(line))
  assert.ok(times.every((v, i) => i === 0 || v > times[i - 1]), `display order: ${times}`)
})

test('background import reports preparing with progress, then ready; addClip waits for it', async (t) => {
  const root = workspace(t)
  const source = path.join(root, 'legacy.mov')
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=4', '-c:v', 'mpeg4', '-q:v', '2', source)
  const [result] = await importMediaByPath(root, [source], { mode: 'link' })
  assert.equal(result.metadata.compatibility.status, 'preparing')
  assert.equal(result.metadata.videoCodecSupported, false)
  assert.throws(() => collectAddClipMedia(root, [{ op: 'addClip', mediaId: result.id }]), (e) => e.code === 'MEDIA_NOT_READY' && e.statusCode === 409)
  const seen = []
  const [state] = await waitForPreparation(root, [result.id], { detached: false, intervalMs: 50, onChange: (s) => seen.push(s[0]) })
  assert.equal(state.status, 'ready')
  assert.equal(seen[0].status, 'preparing')
  const metadata = readMetadata(root, result.id)
  assert.equal(metadata.codec, 'avc')
  assert.equal(metadata.mimeType, 'video/quicktime')
  assert.equal(metadata.compatibility.originalMimeType, 'video/quicktime')
  assert.equal(metadata.compatibility.progress, 1)
  assert.equal(collectAddClipMedia(root, [{ op: 'addClip', mediaId: result.id }])[0].metadata.id, result.id)
  assert.equal(fs.existsSync(path.join(root, 'media', result.id, 'cache', 'compatibility', 'job.json')), false, 'lock released')
})

test('a detached worker prepares media the command line imported with --no-wait', async (t) => {
  const root = workspace(t)
  const source = path.join(root, 'overlay.mov')
  ffmpeg('-f', 'lavfi', '-i', 'color=red@0.25:s=64x48:r=10:d=0.5,format=rgba', '-c:v', 'png', source)
  const [result] = await importMediaByPath(root, [source], { mode: 'link', prepare: 'detached' })
  assert.equal(result.metadata.compatibility.status, 'preparing')
  const [state] = await waitForPreparation(root, [result.id], { intervalMs: 100 })
  assert.equal(state.status, 'ready')
  assert.equal(readMetadata(root, result.id).compatibility.action, 'prores-alpha')
})

test('a failed preparation is recorded and can be retried', async (t) => {
  const root = workspace(t)
  const id = 'media-retry'
  const dir = path.join(root, 'media', id)
  fs.mkdirSync(dir, { recursive: true })
  const original = path.join(root, 'elsewhere.mov')
  fs.writeFileSync(path.join(dir, 'source.link.json'), JSON.stringify({ path: original, fileName: 'clip.mov' }))
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ id, fileName: 'clip.mov', mimeType: 'video/quicktime', compatibility: { status: 'preparing', progress: 0 } }))
  assert.equal((await startPreparation(root, id)).status, 'failed')
  const failed = readMetadata(root, id)
  assert.equal(failed.compatibility.status, 'failed')
  assert.match(failed.compatibility.error, /original file is missing/)
  assert.throws(() => collectAddClipMedia(root, [{ op: 'addClip', mediaId: id }]), (e) => e.code === 'MEDIA_NOT_READY' && /--retry/.test(e.message))
  ffmpeg(...VIDEO, '-c:v', 'mpeg4', original)
  assert.equal((await retryPreparation(root, id)).status, 'ready')
  assert.equal(readMetadata(root, id).compatibility.status, 'ready')
  assert.equal(readMetadata(root, id).compatibility.error, undefined)
})
