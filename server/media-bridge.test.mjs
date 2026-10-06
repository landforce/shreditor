import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { importMediaByPath, projectMediaVersion, setMediaCategories } from './media-bridge.mjs'
import { createWorkspaceBridge } from './workspace-bridge.mjs'

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

/** Serve the workspace bridge for `root`; resolves to its http://127.0.0.1:<port> origin. */
async function startBridge(t, root) {
  const previous = process.env.SHREDITOR_WORKSPACE
  process.env.SHREDITOR_WORKSPACE = root
  const server = http.createServer(createWorkspaceBridge())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.close()
    if (previous === undefined) delete process.env.SHREDITOR_WORKSPACE
    else process.env.SHREDITOR_WORKSPACE = previous
  })
  return `http://127.0.0.1:${server.address().port}`
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
    { mediaId: 'a', from: null, to: 'speaker' },
    { mediaId: 'b', from: 'music', to: null },
  ])
  assert.deepEqual(result.unchanged, [{ mediaId: 'c', category: 'sfx' }])
  assert.equal(ws.read('a').category, 'speaker')
  assert.ok(!('category' in ws.read('b')))
  assert.equal(ws.read('a').fileName, 'a.mp4', 'other fields are kept')
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
  // Importing the same file again with another category updates the existing media.
  const [again] = await importMediaByPath(ws.root, [file], { projectId: 'p1', category: 'overlay', mode: 'link' })
  assert.equal(again.duplicate, true)
  assert.equal(ws.read(imported.id).category, 'overlay')
})

test('bridge routes: POST media/category and GET media/version', async (t) => {
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
  assert.deepEqual((await ok.json()).changed, [{ mediaId: 'a', from: null, to: 'voiceover' }])
  assert.equal(ws.read('a').category, 'voiceover')

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
