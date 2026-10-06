import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  STALE_AFTER_MS,
  activityFile,
  applyActivity,
  effectiveActivity,
  readActivity,
  transition,
} from './agent-activity.mjs'
import { startBridge } from './bridge-test-server.mjs'

const T0 = Date.parse('2026-10-06T12:00:00.000Z')

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-agent-activity-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('a pass goes working -> idle (published), and the label rides along', () => {
  const working = transition(null, 'start', { draftId: 'd1', label: 'Tighten the opening' }, T0)
  assert.equal(working.state, 'working')
  assert.equal(working.draftId, 'd1')
  assert.equal(working.label, 'Tighten the opening')
  assert.equal(working.by, 'agent')
  assert.equal(working.heartbeatAt, working.startedAt)

  const beat = transition(working, 'heartbeat', { draftId: 'd1' }, T0 + 60_000)
  assert.equal(beat.heartbeatAt, new Date(T0 + 60_000).toISOString())
  assert.equal(beat.startedAt, working.startedAt)

  const done = transition(
    beat,
    'finish',
    { ended: 'published', draftId: 'd1', label: 'Pass 2' },
    T0 + 90_000,
  )
  assert.deepEqual(
    { state: done.state, ended: done.ended, label: done.label, draftId: done.draftId },
    { state: 'idle', ended: 'published', label: 'Pass 2', draftId: 'd1' },
  )
})

test('no label is stored as null (the editor shows its default line)', () => {
  assert.equal(transition(null, 'start', { draftId: 'd1' }, T0).label, null)
  assert.throws(() => transition(null, 'start', {}, T0), /draftId is required/)
})

test('the user can stop or take over only a live working pass', () => {
  const working = transition(null, 'start', { draftId: 'd1' }, T0)
  const cancelled = transition(working, 'cancel', {}, T0 + 1000)
  assert.equal(cancelled.state, 'cancelled')
  assert.equal(cancelled.cancelledBy, 'user')
  const released = transition(working, 'release', {}, T0 + 1000)
  assert.equal(released.state, 'released')
  assert.equal(released.releasedBy, 'user')
  // Neither applies once the pass is over.
  const idle = transition(working, 'finish', { ended: 'done' }, T0 + 2000)
  assert.equal(transition(idle, 'cancel', {}, T0 + 3000), idle)
  assert.equal(transition(idle, 'release', {}, T0 + 3000), idle)
})

test('a heartbeat never revives a stopped, released or other draft pass', () => {
  const working = transition(null, 'start', { draftId: 'd1' }, T0)
  const cancelled = transition(working, 'cancel', {}, T0 + 1000)
  assert.equal(transition(cancelled, 'heartbeat', { draftId: 'd1' }, T0 + 2000), cancelled)
  const released = transition(working, 'release', {}, T0 + 1000)
  assert.equal(transition(released, 'heartbeat', {}, T0 + 2000), released)
  assert.equal(transition(working, 'heartbeat', { draftId: 'other' }, T0 + 2000), working)
  assert.equal(transition(null, 'heartbeat', {}, T0), null)
})

test('finishing an older draft leaves a newer pass alone', () => {
  const working = transition(null, 'start', { draftId: 'new' }, T0)
  assert.equal(
    transition(working, 'finish', { ended: 'refused', draftId: 'old' }, T0 + 1000),
    working,
  )
  assert.equal(transition(working, 'finish', { ended: 'done' }, T0 + 1000).state, 'idle')
})

test('a working pass with no heartbeat for 10 minutes reads as idle (and stays dead)', () => {
  const working = transition(null, 'start', { draftId: 'd1' }, T0)
  assert.equal(effectiveActivity(working, T0 + STALE_AFTER_MS).state, 'working')
  const stale = effectiveActivity(working, T0 + STALE_AFTER_MS + 1)
  assert.equal(stale.state, 'idle')
  assert.equal(stale.ended, 'stale')
  // A late heartbeat does not lock the user out again, and Stop no longer applies.
  assert.equal(
    transition(working, 'heartbeat', { draftId: 'd1' }, T0 + STALE_AFTER_MS + 1),
    working,
  )
  assert.equal(transition(working, 'cancel', {}, T0 + STALE_AFTER_MS + 1), working)
})

test('a stop request lapses 10 minutes after the user pressed Stop', () => {
  const working = transition(null, 'start', { draftId: 'd1' }, T0)
  const cancelled = transition(working, 'cancel', {}, T0 + 9 * 60_000)
  assert.equal(effectiveActivity(cancelled, T0 + 15 * 60_000).state, 'cancelled')
  assert.equal(effectiveActivity(cancelled, T0 + 9 * 60_000 + STALE_AFTER_MS + 1).state, 'idle')
})

test('records are written atomically under projects/<id>/agent and read back', (t) => {
  const root = workspace(t)
  assert.equal(readActivity(root, 'p1'), null)
  assert.deepEqual(applyActivity(root, 'p1', 'heartbeat', {}, T0), { state: 'idle' })
  assert.equal(fs.existsSync(activityFile(root, 'p1')), false, 'a no-op writes nothing')
  applyActivity(root, 'p1', 'start', { draftId: 'd1', label: 'x' }, T0)
  assert.equal(readActivity(root, 'p1').state, 'working')
  const dir = path.join(root, 'projects', 'p1', 'agent')
  assert.deepEqual(fs.readdirSync(dir), ['activity.json'])
  assert.throws(() => activityFile(root, '../etc'), /Invalid project id/)
  assert.throws(() => activityFile(root, 'a/b'), /Invalid project id/)
})

test('the bridge serves the record, applies the editor buttons and reports it in editor-state', async (t) => {
  const root = workspace(t)
  const base = `${await startBridge(t, root)}/__shreditor`
  const post = async (route, body) =>
    (await fetch(`${base}/${route}`, { method: 'POST', body: JSON.stringify(body) })).json()

  assert.equal((await (await fetch(`${base}/agent-activity?project=p1`)).json()).state, 'idle')
  const started = await post('agent-activity?project=p1', {
    action: 'start',
    draftId: 'd1',
    label: 'Tighten the opening',
  })
  assert.equal(started.state, 'working')

  const report = await post('editor-state', { projectId: 'p1', tabId: 'tab', dirty: false })
  assert.equal(report.agentActivity.state, 'working')
  assert.equal(report.agentActivity.label, 'Tighten the opening')
  const query = await (await fetch(`${base}/editor-state?project=p1`)).json()
  assert.equal(query.agentActivity.state, 'working')

  assert.equal((await post('agent-activity?project=p1', { action: 'cancel' })).state, 'cancelled')
  assert.equal(readActivity(root, 'p1').state, 'cancelled')

  const bad = await fetch(`${base}/agent-activity?project=p1`, {
    method: 'POST',
    body: JSON.stringify({ action: 'nope' }),
  })
  assert.equal(bad.status, 400)
})
