import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { importMediaByPath, projectMediaCategories, projectMediaVersion, setMediaCategories } from './media-bridge.mjs'
import { startBridge } from './bridge-test-server.mjs'

function makeWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-media-bridge-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const project = (id) => {
    fs.mkdirSync(path.join(root, 'projects', id), { recursive: true })
    fs.writeFileSync(path.join(root, 'projects', id, 'project.json'), '{}')
  }
  const media = (id, extra = {}) => {
    fs.mkdirSync(path.join(root, 'media', id), { recursive: true })
    const metadata = { id, fileName: `${id}.mp4`, tags: [], createdAt: 1, updatedAt: 1, ...extra }
    fs.writeFileSync(path.join(root, 'media', id, 'metadata.json'), JSON.stringify(metadata))
  }
  const read = (id) => JSON.parse(fs.readFileSync(path.join(root, 'media', id, 'metadata.json'), 'utf8'))
  const link = (projectId, ids) =>
    fs.writeFileSync(
      path.join(root, 'projects', projectId, 'media-links.json'),
      JSON.stringify({ version: '1.0', mediaIds: ids.map((id) => ({ id, addedAt: 1 })) }),
    )
  return { root, project, media, read, link }
}

test('setMediaCategories sets, clears and reports what changed', (t) => {
  const ws = makeWorkspace(t)
  ws.media('a')
  ws.media('b', { category: 'music' })
  ws.media('c', { category: 'sfx' })
  const result = setMediaCategories(ws.root, [
    { mediaId: 'a', category: 'speaker' },
    { mediaId: 'b', category: null },
    { mediaId: 'c', category: 'sfx' },
  ])
  assert.deepEqual(result.changed, [
    { mediaId: 'a', from: null, fromSource: null, to: 'speaker', source: 'agent' },
    { mediaId: 'b', from: 'music', fromSource: null, to: null, source: 'agent' },
  ])
  // A category with no source is already explicit: re-setting it is a no-op.
  assert.deepEqual(result.unchanged, [{ mediaId: 'c', category: 'sfx', source: null }])
  assert.deepEqual(result.kept, [])
  assert.equal(ws.read('a').category, 'speaker')
  assert.equal(ws.read('a').categorySource, 'agent')
  assert.ok(!('category' in ws.read('b')))
  assert.equal(ws.read('b').categorySource, 'agent', 'cleared on purpose: auto leaves it')
  assert.equal(ws.read('a').fileName, 'a.mp4', 'other fields are kept')
})

test('setMediaCategories: an auto suggestion never replaces an explicit category', (t) => {
  const ws = makeWorkspace(t)
  ws.media('legacy', { category: 'b-roll' })
  ws.media('user', { category: 'graphics', categorySource: 'user' })
  ws.media('agent', { category: 'b-roll', categorySource: 'agent' })
  ws.media('cleared', { categorySource: 'agent' })
  ws.media('empty')
  ws.media('auto', { category: 'speaker', categorySource: 'auto' })
  const items = ['legacy', 'user', 'agent', 'cleared', 'empty', 'auto'].map((mediaId) => ({ mediaId, category: 'b-roll' }))
  items[2].category = 'speaker'
  const result = setMediaCategories(ws.root, items, { source: 'auto' })
  assert.deepEqual(result.kept, [
    { mediaId: 'legacy', category: 'b-roll', source: null },
    { mediaId: 'user', category: 'graphics', source: 'user' },
    { mediaId: 'agent', category: 'b-roll', source: 'agent' },
    { mediaId: 'cleared', category: null, source: 'agent' },
  ])
  assert.deepEqual(result.changed.map((c) => [c.mediaId, c.to, c.source]), [
    ['empty', 'b-roll', 'auto'],
    ['auto', 'b-roll', 'auto'],
  ])
  assert.equal(ws.read('user').category, 'graphics')
  assert.equal(ws.read('agent').category, 'b-roll')
  assert.ok(!('category' in ws.read('cleared')))
  assert.deepEqual([ws.read('empty').category, ws.read('empty').categorySource], ['b-roll', 'auto'])
  // The same suggestion again changes nothing; auto can't clear.
  assert.deepEqual(setMediaCategories(ws.root, [{ mediaId: 'empty', category: 'b-roll' }], { source: 'auto' }).unchanged, [
    { mediaId: 'empty', category: 'b-roll', source: 'auto' },
  ])
  assert.throws(() => setMediaCategories(ws.root, [{ mediaId: 'empty', category: null }], { source: 'auto' }), (error) => error.status === 400)
  assert.throws(() => setMediaCategories(ws.root, [{ mediaId: 'empty', category: 'sfx' }], { source: 'robot' }), (error) => error.status === 400)
})

test('setMediaCategories: the agent confirms or corrects a suggestion', (t) => {
  const ws = makeWorkspace(t)
  ws.media('a', { category: 'speaker', categorySource: 'auto' })
  ws.media('b', { category: 'speaker', categorySource: 'auto' })
  const result = setMediaCategories(ws.root, [
    { mediaId: 'a', category: 'speaker' },
    { mediaId: 'b', category: 'b-roll' },
  ])
  assert.deepEqual(result.changed, [
    { mediaId: 'a', from: 'speaker', fromSource: 'auto', to: 'speaker', source: 'agent' },
    { mediaId: 'b', from: 'speaker', fromSource: 'auto', to: 'b-roll', source: 'agent' },
  ])
  // Now explicit: a later suggestion (e.g. after the project is reopened) is kept out.
  assert.equal(setMediaCategories(ws.root, [{ mediaId: 'a', category: 'b-roll' }], { source: 'auto' }).kept.length, 1)
  assert.deepEqual([ws.read('a').category, ws.read('a').categorySource], ['speaker', 'agent'])
})

test('projectMediaCategories lists category, source and transcription state', (t) => {
  const ws = makeWorkspace(t)
  ws.project('p1')
  ws.media('a', { category: 'speaker', categorySource: 'auto', mimeType: 'video/mp4', transcription: { status: 'done' } })
  ws.media('b', { category: 'music', mimeType: 'audio/wav' })
  ws.media('c', { mimeType: 'image/png' })
  ws.link('p1', ['a', 'b', 'c', 'gone'])
  assert.deepEqual(projectMediaCategories(ws.root, 'p1'), [
    { mediaId: 'a', fileName: 'a.mp4', mimeType: 'video/mp4', category: 'speaker', categorySource: 'auto', transcription: 'done' },
    { mediaId: 'b', fileName: 'b.mp4', mimeType: 'audio/wav', category: 'music', categorySource: 'explicit', transcription: null },
    { mediaId: 'c', fileName: 'c.mp4', mimeType: 'image/png', category: null, categorySource: null, transcription: null },
  ])
})

test('setMediaCategories validates every item before writing any', (t) => {
  const ws = makeWorkspace(t)
  ws.media('a')
  assert.throws(
    () => setMediaCategories(ws.root, [{ mediaId: 'a', category: 'speaker' }, { mediaId: 'a', category: 'broll' }]),
    (error) => error.status === 400 && /must be one of/.test(error.message),
  )
  assert.throws(
    () => setMediaCategories(ws.root, [{ mediaId: 'a', category: 'speaker' }, { mediaId: 'missing', category: 'music' }]),
    (error) => error.status === 404,
  )
  assert.throws(() => setMediaCategories(ws.root, [{ mediaId: '../a', category: 'music' }]), (error) => error.status === 400)
  assert.throws(() => setMediaCategories(ws.root, []), (error) => error.status === 400)
  assert.ok(!('category' in ws.read('a')))
})

test('projectMediaVersion moves on new links and metadata writes', async (t) => {
  const ws = makeWorkspace(t)
  ws.project('p1')
  ws.media('a')
  const empty = projectMediaVersion(ws.root, 'p1')
  ws.link('p1', ['a'])
  const linked = projectMediaVersion(ws.root, 'p1')
  assert.notEqual(linked, empty)
  await new Promise((resolve) => setTimeout(resolve, 20))
  setMediaCategories(ws.root, [{ mediaId: 'a', category: 'b-roll' }])
  assert.notEqual(projectMediaVersion(ws.root, 'p1'), linked)
  assert.throws(() => projectMediaVersion(ws.root, 'nope'), (error) => error.status === 404)
})

test('importMediaByPath writes the category, and rejects an unknown one', async (t) => {
  const ws = makeWorkspace(t)
  ws.project('p1')
  const file = path.join(ws.root, 'clip.png')
  fs.writeFileSync(file, 'not really a png')
  await assert.rejects(importMediaByPath(ws.root, [file], { category: 'nope', mode: 'link' }), (error) => error.status === 400)
  const [imported] = await importMediaByPath(ws.root, [file], { projectId: 'p1', category: 'graphics', mode: 'link' })
  assert.equal(imported.error, undefined)
  assert.equal(ws.read(imported.id).category, 'graphics')
  assert.equal(ws.read(imported.id).categorySource, 'agent')
  // Importing the same file again with another category updates the existing media.
  const [again] = await importMediaByPath(ws.root, [file], { projectId: 'p1', category: 'overlay', mode: 'link' })
  assert.equal(again.duplicate, true)
  assert.equal(ws.read(imported.id).category, 'overlay')
})

test('importMediaByPath records where a made file came from (shred tts)', async (t) => {
  const ws = makeWorkspace(t)
  ws.project('p1')
  const file = path.join(ws.root, 'scratch-vo.wav')
  fs.writeFileSync(file, 'not really a wav')
  const generated = { kind: 'tts', scratch: true, engine: 'supertonic', voice: 'M3', text: 'Hi.' }
  const [imported] = await importMediaByPath(ws.root, [file], {
    projectId: 'p1',
    category: 'voiceover',
    mode: 'link',
    generated,
    tags: ['scratch-tts', 7],
  })
  const metadata = ws.read(imported.id)
  assert.deepEqual(metadata.generated, generated)
  assert.deepEqual(metadata.tags, ['scratch-tts'])
  assert.equal(metadata.category, 'voiceover')
})

test('bridge routes: POST media/category, GET media/categories and GET media/version', async (t) => {
  const ws = makeWorkspace(t)
  ws.project('p1')
  ws.media('a')
  ws.link('p1', ['a'])
  const base = `${await startBridge(t, ws.root)}/__shreditor`
  const post = (items) =>
    fetch(`${base}/media/category`, { method: 'POST', body: JSON.stringify({ items }) })

  const before = await (await fetch(`${base}/media/version?projectId=p1`)).json()
  assert.equal(typeof before.version, 'string')

  const bad = await post([{ mediaId: 'a', category: 'vlog' }])
  assert.equal(bad.status, 400)

  await new Promise((resolve) => setTimeout(resolve, 20))
  const ok = await post([{ mediaId: 'a', category: 'voiceover' }])
  assert.equal(ok.status, 200)
  assert.deepEqual((await ok.json()).changed, [{ mediaId: 'a', from: null, fromSource: null, to: 'voiceover', source: 'agent' }])
  assert.equal(ws.read('a').category, 'voiceover')
  const suggestion = await fetch(`${base}/media/category`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ mediaId: 'a', category: 'speaker' }], source: 'auto' }),
  })
  assert.deepEqual((await suggestion.json()).kept, [{ mediaId: 'a', category: 'voiceover', source: 'agent' }])
  const listed = await (await fetch(`${base}/media/categories?projectId=p1`)).json()
  assert.deepEqual(listed.media.map((m) => [m.mediaId, m.category, m.categorySource]), [['a', 'voiceover', 'agent']])

  const after = await (await fetch(`${base}/media/version?projectId=p1`)).json()
  assert.notEqual(after.version, before.version)
  assert.equal((await fetch(`${base}/media/version`)).status, 400)
})

test('native preparation route validates media IDs and returns a workspace derivative', async (t) => {
  const { execFileSync } = await import('node:child_process')
  const ws = makeWorkspace(t)
  const source = path.join(ws.root, 'legacy.mov')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=64x48:r=10:d=0.2', '-c:v', 'mpeg4', source])
  const [imported] = await importMediaByPath(ws.root, [source], { mode: 'link', prepare: 'wait' })
  const base = await startBridge(t, ws.root)
  const prepare = (mediaId) => fetch(`${base}/__shreditor/media/prepare`, { method: 'POST', body: JSON.stringify({ mediaId }) })
  assert.equal((await prepare('../outside')).status, 400)
  assert.equal((await prepare('missing')).status, 404)
  const response = await prepare(imported.id)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.cached, true)
  assert.equal(body.prepared, true)
  const file = await fetch(`${base}${body.url}`)
  assert.equal(file.status, 200)
  assert.ok((await file.arrayBuffer()).byteLength > 0)
  assert.equal(ws.read(imported.id).codec, 'avc')
})

test('in-place ingest route reports, then starts, a working copy for a placed file', async (t) => {
  const { execFileSync } = await import('node:child_process')
  const { waitForPreparation } = await import('./media-preparation.mjs')
  const ws = makeWorkspace(t)
  ws.project('p1')
  const original = path.join(ws.root, 'outside', 'card.mov')
  fs.mkdirSync(path.dirname(original))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=64x48:r=10:d=0.2', '-c:v', 'mpeg4', original])
  const playable = path.join(ws.root, 'outside', 'phone.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=64x48:r=10:d=0.2', '-c:v', 'libx264', playable])
  // What media/choose leaves behind for a linked placement.
  for (const [id, file] of [['placed', original], ['plays', playable]]) {
    fs.mkdirSync(path.join(ws.root, 'media', id), { recursive: true })
    fs.writeFileSync(path.join(ws.root, 'media', id, 'source.link.json'), JSON.stringify({ version: 1, path: file, fileName: path.basename(file) }))
  }
  const base = await startBridge(t, ws.root)
  const ingest = async (body) => (await fetch(`${base}/__shreditor/media/ingest`, { method: 'POST', body: JSON.stringify(body) })).json()
  assert.deepEqual(await ingest({ mediaId: 'plays', fileName: 'phone.mp4' }), { prepare: false })
  const check = await ingest({ mediaId: 'placed', fileName: 'card.mov' })
  assert.equal(check.prepare, true)
  assert.equal(check.action, 'h264')
  assert.equal(fs.existsSync(path.join(ws.root, 'media', 'placed', 'metadata.json')), false, 'a check writes nothing')
  const started = await ingest({ mediaId: 'placed', fileName: 'card.mov', projectId: 'p1', start: true })
  assert.equal(started.metadata.compatibility.status, 'preparing')
  assert.equal(started.metadata.fileName, 'card.mov')
  const links = JSON.parse(fs.readFileSync(path.join(ws.root, 'projects', 'p1', 'media-links.json'), 'utf8'))
  assert.deepEqual(links.mediaIds.map((m) => m.id), ['placed'])
  const [state] = await waitForPreparation(ws.root, ['placed'], { detached: false, intervalMs: 50 })
  assert.equal(state.status, 'ready')
  assert.equal(ws.read('placed').codec, 'avc')
})
