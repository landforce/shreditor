import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { editorProjectId, injectProjectMeta, readProjectCard } from './project-page-meta.mjs'

const HTML = '<html><head><title>Shreditor</title></head><body></body></html>'

test('editor links name their project id; other paths do not', () => {
  assert.equal(editorProjectId('/editor/55f7599b-8887'), '55f7599b-8887')
  assert.equal(editorProjectId('/editor/abc/'), 'abc')
  assert.equal(editorProjectId('/projects'), null)
  assert.equal(editorProjectId('/editor/../etc'), null)
})

test('an editor page carries the project name and cover', (t) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'page-meta-'))
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }))
  const dir = path.join(ws, 'projects', 'p1')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'project.json'),
    JSON.stringify({
      name: 'Bandon <Golf>',
      metadata: { width: 1080, height: 1920 },
      format: { id: 'ten-shot' },
    }),
  )
  assert.equal(
    injectProjectMeta(HTML, readProjectCard(ws, 'p1'), 'http://localhost:5273').includes(
      'og:image',
    ),
    false,
  )

  fs.writeFileSync(path.join(dir, 'thumbnail.jpg'), 'jpg')
  const html = injectProjectMeta(HTML, readProjectCard(ws, 'p1'), 'http://localhost:5273')
  assert.match(html, /<title>Bandon &lt;Golf&gt; · Shreditor<\/title>/)
  assert.match(html, /og:image" content="http:\/\/localhost:5273\/project-cover\/p1\.jpg\?v=\d+"/)
  assert.match(html, /og:description" content="1080×1920 · ten-shot · Shreditor"/)
  assert.equal(readProjectCard(ws, 'missing'), null)
  assert.equal(injectProjectMeta(HTML, null, 'x'), HTML)
})

test('the preview route answers HTML requests for a project page and passes the rest on', async (t) => {
  const { createProjectPageRoute } = await import('./project-page-meta.mjs')
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'page-route-'))
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }))
  fs.mkdirSync(path.join(ws, 'projects', 'p1'), { recursive: true })
  fs.writeFileSync(
    path.join(ws, 'projects', 'p1', 'project.json'),
    JSON.stringify({ name: 'Reel' }),
  )
  const indexFile = path.join(ws, 'index.html')
  fs.writeFileSync(indexFile, HTML)
  const route = createProjectPageRoute({
    workspace: () => ws,
    indexFile,
    headers: { 'x-test': '1' },
  })
  const run = (url, accept = 'text/html') => {
    const sent = {}
    let passed = false
    route(
      { method: 'GET', url, headers: { accept, host: 'localhost:5273' } },
      {
        writeHead: (status, headers) => Object.assign(sent, { status, headers }),
        end: (body) => (sent.body = body),
      },
      () => (passed = true),
    )
    return { sent, passed }
  }
  const page = run('/editor/p1')
  assert.equal(page.sent.status, 200)
  assert.equal(page.sent.headers['x-test'], '1')
  assert.match(page.sent.body, /<title>Reel · Shreditor<\/title>/)
  assert.equal(run('/editor/p1', 'application/json').passed, true)
  assert.equal(run('/editor/missing').passed, true)
  assert.equal(run('/projects').passed, true)
})
