import assert from 'node:assert/strict'
import test from 'node:test'
import { STALE_MS, createEditorStateStore } from './editor-state.mjs'

function clock() {
  let t = 1_000_000
  return { now: () => t, advance: (ms) => (t += ms) }
}

test('a dirty tab makes the project dirty until it reports clean', () => {
  const c = clock()
  const store = createEditorStateStore(c)
  assert.equal(store.query('p1').open, false)
  store.report({ projectId: 'p1', tabId: 'a', dirty: true, lastEditAt: c.now() - 2000, revision: 'sha256:1' })
  let q = store.query('p1')
  assert.equal(q.open, true)
  assert.equal(q.dirty, true)
  assert.equal(q.lastEditAt, c.now() - 2000)
  store.report({ projectId: 'p1', tabId: 'a', dirty: false, revision: 'sha256:2' })
  q = store.query('p1')
  assert.equal(q.dirty, false)
  assert.equal(q.editors[0].revision, 'sha256:2')
})

test('tabs that stop reporting expire', () => {
  const c = clock()
  const store = createEditorStateStore(c)
  store.report({ projectId: 'p1', tabId: 'a', dirty: true })
  c.advance(STALE_MS + 1)
  assert.equal(store.query('p1').open, false)
})

test('closing a tab removes it at once', () => {
  const store = createEditorStateStore(clock())
  store.report({ projectId: 'p1', tabId: 'a', dirty: true })
  store.report({ projectId: 'p1', tabId: 'a', closed: true })
  assert.equal(store.query('p1').open, false)
})

test('a save request is handed to tabs and cleared once every tab is clean', () => {
  const c = clock()
  const store = createEditorStateStore(c)
  store.report({ projectId: 'p1', tabId: 'a', dirty: true })
  store.report({ projectId: 'p1', tabId: 'b', dirty: false })
  const { saveRequest, editors } = store.requestSave('p1')
  assert.equal(editors, 2)
  c.advance(10)
  assert.equal(store.report({ projectId: 'p1', tabId: 'a', dirty: true }).saveRequest, saveRequest)
  assert.equal(store.report({ projectId: 'p2', tabId: 'z', dirty: true }).saveRequest, null)
  c.advance(10)
  // b is clean but a is not: still pending.
  assert.equal(store.report({ projectId: 'p1', tabId: 'b', dirty: false }).saveRequest, saveRequest)
  c.advance(10)
  assert.equal(store.report({ projectId: 'p1', tabId: 'a', dirty: false }).saveRequest, null)
  assert.equal(store.query('p1').saveRequest, null)
})

test('reports without ids are rejected', () => {
  const store = createEditorStateStore(clock())
  assert.throws(() => store.report({ projectId: 'p1' }), /required/)
})
