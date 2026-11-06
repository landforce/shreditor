import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildTranscriptEnvelope,
  canAutoWrite,
  canTransition,
  dtwPreset,
  groupTokens,
  isPhantomPhrase,
  isPhantomSegment,
  segmentsFromWhisperJson,
  timeWords,
  tokensToWords,
} from './transcription-core.mjs'

const tok = (text, from, to, extra = {}) => ({ text, offsets: { from, to }, p: 0.9, t_dtw: -1, ...extra })

test('tokens merge into words: contractions, split names, punctuation, special tokens', () => {
  const groups = groupTokens([
    tok('[_BEG_]', 0, 0),
    tok(' I', 100, 150),
    tok("'m", 150, 270),
    tok(' asked', 300, 500),
    tok(' Chat', 500, 600),
    tok('G', 600, 650),
    tok('P', 650, 700),
    tok('T', 700, 760),
    tok(',', 760, 780),
    tok(' -', 780, 790),
    tok('[_TT_42]', 800, 800),
  ])
  assert.deepEqual(groups.map((g) => g.text), ["I'm", 'asked', 'ChatGPT,-'])
  assert.equal(groups[2].from, 0.5)
  assert.equal(groups[2].to, 0.79)
})

test('word times are clamped into the segment and the media, and never overlap', () => {
  // Token offsets drift past the segment end (2.0 s) and the media end (1.8 s).
  const words = tokensToWords([tok(' one', 900, 1200), tok(' two', 1100, 2600), tok(' three', 3000, 3500)], 1.0, 2.0, { duration: 1.8 })
  assert.deepEqual(words.map((w) => w.text), ['one', 'two'], 'a word placed past the end of the media is dropped')
  assert.equal(words[0].start, 1.0, 'clamped up to the segment start')
  for (const [i, w] of words.entries()) {
    assert.ok(w.start >= 1.0 && w.end <= 1.8, `word ${i} inside [1.0, 1.8]`)
    assert.ok(w.end > w.start)
    if (i) assert.ok(w.start >= words[i - 1].end, 'no overlap')
  }
})

test('DTW onsets time words, led by the measured lag and capped in length', () => {
  const groups = groupTokens([
    tok(' So', 0, 0, { t_dtw: 120 }),
    tok(' it', 0, 0, { t_dtw: 140 }),
    tok(' made', 0, 0, { t_dtw: 400 }),
  ])
  const words = timeWords(groups, 0, 5, { maxWordSeconds: 0.6, dtwLeadSeconds: 0.1 })
  assert.deepEqual(words.map((w) => [w.start, w.end]), [[1.1, 1.3], [1.3, 1.9], [3.9, 4.5]])
})

test('degenerate offsets still give each word a positive span', () => {
  const words = tokensToWords([tok(' a', 500, 500), tok(' b', 500, 500), tok(' c', 500, 500)], 0.5, 0.52)
  assert.equal(words.length, 2, 'what cannot fit in the segment is dropped, not stacked')
  assert.ok(words.every((w) => w.end > w.start))
})

test('dtw presets follow the model file name', () => {
  assert.equal(dtwPreset('/m/ggml-large-v3-turbo.bin'), 'large.v3.turbo')
  assert.equal(dtwPreset('ggml-large-v3-turbo-q5_0.bin'), 'large.v3.turbo')
  assert.equal(dtwPreset('ggml-base.en.bin'), 'base.en')
  assert.equal(dtwPreset('custom.bin'), null)
})

const seg = (text, from, to, tokens) => ({ text, offsets: { from, to }, tokens: tokens ?? text.trim().split(' ').map((w, i, all) => tok(` ${w}`, from + ((to - from) * i) / all.length, from + ((to - from) * (i + 1)) / all.length)) })

test('phantom speech: stock phrases on non-speech audio become no speech', () => {
  // Typing SFX, 5.3 s: whisper says "Thank you." over its whole 30 s window.
  assert.equal(segmentsFromWhisperJson({ transcription: [seg(' Thank you.', 0, 29980)] }, { duration: 5.33 }).segments.length, 0)
  // Sign-off squeezed into the last 70 ms of the file.
  const crammed = seg(" We'll see you next time.", 0, 29980, [" We'll", ' see', ' you', ' next', ' time.'].map((w, i) => tok(w, 0, 0, { t_dtw: 526 + i })))
  const out = segmentsFromWhisperJson({ transcription: [crammed] }, { duration: 5.33 })
  assert.equal(out.segments.length, 0)
  assert.deepEqual(out.dropped, ["We'll see you next time."])
  assert.ok(isPhantomPhrase('Thanks for watching!'))
  assert.ok(isPhantomPhrase("I'll see you next time."))
  assert.ok(!isPhantomPhrase('See you at the warehouse'))
})

test('phantom filter keeps real speech, including a real closing "thank you"', () => {
  const json = {
    result: { language: 'en' },
    transcription: [seg(' So I am buying a warehouse.', 0, 2400), seg(' Thank you.', 2600, 3300)],
  }
  const out = segmentsFromWhisperJson(json, { duration: 3.5 })
  assert.equal(out.language, 'en')
  assert.deepEqual(out.segments.map((s) => s.text), ['So I am buying a warehouse.', 'Thank you.'])
  assert.ok(isPhantomSegment({ text: 'you', start: 0, end: 4, words: [] }, { duration: 10 }), 'two words over seconds')
})

test('status transitions', () => {
  assert.ok(canTransition(undefined, 'queued'))
  assert.ok(!canTransition(undefined, 'done'))
  assert.ok(canTransition('queued', 'running'))
  assert.ok(canTransition('running', 'done'))
  assert.ok(canTransition('running', 'none'))
  assert.ok(canTransition('running', 'failed'))
  assert.ok(canTransition('failed', 'queued'), 'retry')
  assert.ok(!canTransition('done', 'running'), 'a finished job is queued again first')
  assert.ok(!canTransition('queued', 'bogus'))
})

test('provenance: only auto transcripts are replaced unless forced', () => {
  const auto = buildTranscriptEnvelope({ mediaId: 'm', segments: [], language: 'en', modelName: 'ggml-large-v3-turbo' })
  assert.ok(canAutoWrite(null))
  assert.ok(canAutoWrite(auto))
  assert.ok(!canAutoWrite({ service: 'whisper', params: {} }), 'made or edited in the app')
  assert.ok(canAutoWrite({ service: 'whisper', params: {} }, { force: true }))
  assert.equal(auto.data.modelVariant, 'whisper-large')
  assert.equal(auto.data.source, 'whisper.cpp')
  assert.equal(auto.kind, 'transcript')
})

/* ───────────── Runtime: queue, statuses and routes with a fake whisper-cli ───────────── */

function fakeWhisper(dir, transcription) {
  const fixture = path.join(dir, 'fixture.json')
  fs.writeFileSync(fixture, JSON.stringify({ result: { language: 'en' }, transcription }))
  const script = path.join(dir, 'whisper-cli')
  fs.writeFileSync(script, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('whisper.cpp version: 9.9.9'); process.exit(0) }
require('node:fs').appendFileSync(${JSON.stringify(path.join(dir, 'calls.log'))}, args.join(' ') + '\\n')
const out = args[args.indexOf('-of') + 1]
require('node:fs').copyFileSync(${JSON.stringify(fixture)}, out + '.json')
`)
  fs.chmodSync(script, 0o755)
  const model = path.join(dir, 'ggml-large-v3-turbo.bin')
  fs.writeFileSync(model, 'not a real model')
  return { script, model }
}

function workspaceWithMedia(t, { withAudio = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-transcribe-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const id = 'media-1'
  const dir = path.join(root, 'media', id)
  fs.mkdirSync(dir, { recursive: true })
  const source = path.join(dir, 'clip.mp4')
  const audio = withAudio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'] : []
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=64x48:d=2', ...audio, '-shortest', '-c:v', 'libx264', ...(withAudio ? ['-c:a', 'aac'] : []), source])
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ id, fileName: 'clip.mp4', mimeType: 'video/mp4', tags: [] }))
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'))
  return { root, id, dir, read }
}

function withEnv(t, vars) {
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  Object.assign(process.env, vars)
  t.after(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
}

async function serve(t, handler) {
  const server = http.createServer(handler)
  t.after(() => server.close())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

const SPEECH = [seg(' So I am buying a warehouse.', 0, 1500)]

test('transcribeMedia writes the FreeCut envelope and moves the status to done', async (t) => {
  const { transcribeMedia, transcriptFile } = await import('./transcription.mjs')
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-whisper-'))
  t.after(() => fs.rmSync(tools, { recursive: true, force: true }))
  const { script, model } = fakeWhisper(tools, SPEECH)
  withEnv(t, { SHREDITOR_WHISPER_CLI: script, SHREDITOR_WHISPER_MODEL: model, SHREDITOR_CONFIG: path.join(tools, 'none.json') })
  const ws = workspaceWithMedia(t)

  const result = await transcribeMedia(ws.root, ws.id)
  assert.equal(result.status, 'done')
  const envelope = JSON.parse(fs.readFileSync(transcriptFile(ws.root, ws.id), 'utf8'))
  assert.equal(envelope.service, 'whisper.cpp')
  assert.equal(envelope.params.auto, true)
  assert.equal(envelope.params.engineVersion, '9.9.9')
  assert.equal(envelope.data.modelVariant, 'whisper-large')
  assert.equal(envelope.data.text, 'So I am buying a warehouse.')
  assert.equal(envelope.data.segments[0].words.length, 6)
  const status = ws.read().transcription
  assert.equal(status.status, 'done')
  assert.equal(status.language, 'en')
  assert.equal(status.model, 'ggml-large-v3-turbo')
  assert.match(fs.readFileSync(path.join(tools, 'calls.log'), 'utf8'), /-ojf .*-dtw large\.v3\.turbo -nfa/)

  // An app-made transcript is kept unless forced.
  fs.writeFileSync(transcriptFile(ws.root, ws.id), JSON.stringify({ ...envelope, service: 'whisper', params: {} }))
  assert.equal((await transcribeMedia(ws.root, ws.id)).status, 'kept')
  assert.equal(JSON.parse(fs.readFileSync(transcriptFile(ws.root, ws.id), 'utf8')).service, 'whisper')
  assert.equal((await transcribeMedia(ws.root, ws.id, { force: true })).status, 'done')
})

test('no audio stream and phantom-only speech end as none', async (t) => {
  const { transcribeMedia } = await import('./transcription.mjs')
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-whisper-'))
  t.after(() => fs.rmSync(tools, { recursive: true, force: true }))
  const { script, model } = fakeWhisper(tools, [seg(' Thank you.', 0, 29980)])
  withEnv(t, { SHREDITOR_WHISPER_CLI: script, SHREDITOR_WHISPER_MODEL: model, SHREDITOR_CONFIG: path.join(tools, 'none.json') })

  const silent = workspaceWithMedia(t, { withAudio: false })
  assert.deepEqual(await transcribeMedia(silent.root, silent.id), { status: 'none', reason: 'no-audio' })
  const phantom = workspaceWithMedia(t)
  const result = await transcribeMedia(phantom.root, phantom.id)
  assert.equal(result.status, 'none')
  assert.equal(result.reason, 'no-speech')
  assert.equal(phantom.read().transcription.status, 'none')
  assert.ok(!fs.existsSync(path.join(phantom.dir, 'cache', 'ai', 'transcript.json')), 'no fake transcript')
})

test('a missing whisper-cli marks the media unavailable without throwing', async (t) => {
  const { transcribeMedia } = await import('./transcription.mjs')
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-whisper-'))
  t.after(() => fs.rmSync(tools, { recursive: true, force: true }))
  const config = path.join(tools, 'config.json')
  fs.writeFileSync(config, JSON.stringify({ transcription: { whisperCli: path.join(tools, 'nope', 'whisper-cli') } }))
  withEnv(t, { SHREDITOR_CONFIG: config, SHREDITOR_WHISPER_CLI: '', SHREDITOR_WHISPER_MODEL: path.join(tools, 'missing.bin') })
  const ws = workspaceWithMedia(t)
  const result = await transcribeMedia(ws.root, ws.id)
  assert.equal(result.status, 'unavailable')
  const status = ws.read().transcription
  assert.equal(status.status, 'unavailable')
  assert.match(status.hint, /shred setup/)
  assert.match(status.error, /whisper-cli/)
})

test('bridge: a new metadata.json PUT queues the media; POST media/transcribe validates and retries', async (t) => {
  const { createWorkspaceBridge } = await import('./workspace-bridge.mjs')
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-whisper-'))
  t.after(() => fs.rmSync(tools, { recursive: true, force: true }))
  const { script, model } = fakeWhisper(tools, SPEECH)
  const ws = workspaceWithMedia(t)
  const metadata = fs.readFileSync(path.join(ws.dir, 'metadata.json'))
  fs.rmSync(path.join(ws.dir, 'metadata.json'))
  withEnv(t, { SHREDITOR_WORKSPACE: ws.root, SHREDITOR_WHISPER_CLI: script, SHREDITOR_WHISPER_MODEL: model, SHREDITOR_CONFIG: path.join(tools, 'none.json') })
  const base = `${await serve(t, createWorkspaceBridge())}/__shreditor`

  // The editor's own import (Finder chooser / upload) writes metadata.json once.
  const put = await fetch(`${base}/fs/file?path=${encodeURIComponent(`media/${ws.id}/metadata.json`)}`, { method: 'PUT', body: metadata })
  assert.equal(put.status, 200)
  const seen = []
  for (let i = 0; i < 100 && ws.read().transcription?.status !== 'done'; i++) {
    seen.push(ws.read().transcription?.status)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(ws.read().transcription.status, 'done', `statuses seen: ${[...new Set(seen)].join(' -> ')}`)

  const status = await (await fetch(`${base}/media/transcription?mediaId=${ws.id}`)).json()
  assert.equal(status.transcript, true)
  assert.equal((await fetch(`${base}/media/transcribe`, { method: 'POST', body: JSON.stringify({ mediaId: '../x' }) })).status, 400)
  assert.equal((await fetch(`${base}/media/transcribe`, { method: 'POST', body: JSON.stringify({ mediaId: 'missing' }) })).status, 404)
  const again = await fetch(`${base}/media/transcribe`, { method: 'POST', body: JSON.stringify({ mediaId: ws.id }) })
  assert.equal(again.status, 202)
  assert.equal((await again.json()).transcription.status, 'queued')
  for (let i = 0; i < 100 && ws.read().transcription?.status !== 'done'; i++) await new Promise((resolve) => setTimeout(resolve, 100))
  const engine = await (await fetch(`${base}/transcription/engine`)).json()
  assert.equal(engine.available, true)
  assert.equal(engine.local, true)
})

test('model download is verified by size and sha256 before it is put in place', async (t) => {
  const crypto = await import('node:crypto')
  const { downloadModel } = await import('./transcription-setup.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-model-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const bytes = Buffer.from('ggml model bytes')
  const model = { url: 'https://example.invalid/m.bin', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
  const fetchImpl = async () => new Response(bytes)
  const target = path.join(dir, 'models', 'm.bin')
  assert.deepEqual(await downloadModel(target, { fetchImpl, model }), { bytes: bytes.length, sha256: model.sha256 })
  assert.deepEqual(fs.readFileSync(target), bytes)

  const bad = path.join(dir, 'bad.bin')
  await assert.rejects(downloadModel(bad, { fetchImpl, model: { ...model, sha256: '0'.repeat(64) } }), /sha256 mismatch/)
  await assert.rejects(downloadModel(bad, { fetchImpl, model: { ...model, size: 1 } }), /Size mismatch/)
  assert.ok(!fs.existsSync(bad) && !fs.existsSync(`${bad}.part`), 'nothing left behind')
})

test('an existing copy of the model is found by size and adopted only when its sha256 matches', async (t) => {
  const crypto = await import('node:crypto')
  const { adoptModel, findExistingModel } = await import('./transcription-setup.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-model-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const bytes = Buffer.from('ggml model bytes')
  const model = { file: 'm.bin', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
  const target = path.join(dir, 'shreditor', 'm.bin')
  const elsewhere = path.join(dir, 'whisper.cpp')
  fs.mkdirSync(elsewhere)
  fs.writeFileSync(path.join(dir, 'm.bin'), 'wrong size')
  fs.writeFileSync(path.join(elsewhere, 'm.bin'), bytes)
  const opts = { dirs: [dir, elsewhere], search: () => [], model }
  assert.equal(findExistingModel(target, opts), path.join(elsewhere, 'm.bin'))
  assert.equal(findExistingModel(target, { ...opts, dirs: [dir] }), null)
  assert.equal(findExistingModel(path.join(elsewhere, 'm.bin'), { ...opts, dirs: [elsewhere] }), null, 'the target itself is not a candidate')

  assert.ok(['clone', 'link'].includes(await adoptModel(path.join(elsewhere, 'm.bin'), target, { model })))
  assert.deepEqual(fs.readFileSync(target), bytes)

  fs.writeFileSync(path.join(dir, 'same-size.bin'), Buffer.alloc(bytes.length))
  await assert.rejects(adoptModel(path.join(dir, 'same-size.bin'), path.join(dir, 'other', 'm.bin'), { model }), /sha256/)
  assert.ok(!fs.existsSync(path.join(dir, 'other', 'm.bin')))
})
