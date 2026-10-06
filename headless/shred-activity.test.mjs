// shred and the editor's "agent is working" record: a pass the user stopped
// fails every later command and clears itself, a pass the user took over
// ("Edit anyway") is refused at publish, `shred done` ends a pass, and every
// command on the draft keeps a live pass alive. Runs the real CLI with the
// editor down (direct file writes) and up (through the workspace bridge).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readActivity, transition, writeActivity } from '../server/agent-activity.mjs'
import { startBridge } from '../server/bridge-test-server.mjs'
import { STOPPED_MESSAGE, USER_EDITED_MESSAGE } from '../skills/shreditor-edit/scripts/activity.mjs'

const SHRED = fileURLToPath(new URL('../skills/shreditor-edit/scripts/shred.mjs', import.meta.url))
// Nothing listens here: the service calls fail fast, after the activity checks ran.
const CLOSED = 'http://127.0.0.1:9'

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-activity-home-'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-activity-ws-'))
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(root, { recursive: true, force: true })
  })
  const drafts = (value) => {
    const file = path.join(home, '.shreditor', 'drafts.json')
    if (value === undefined) return JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
  }
  const ops = path.join(root, 'ops.json')
  fs.writeFileSync(ops, '[]')
  /** A pass on `target` from draft `draftId`, moved through `actions` (e.g. ['cancel']). */
  const pass = (target, draftId, actions = [], now = Date.now()) => {
    let record = transition(null, 'start', { draftId, label: 'Tighten the opening' }, now)
    for (const action of actions) record = transition(record, action, {}, now)
    writeActivity(root, target, record)
    return record
  }
  let editor = CLOSED
  const shred = (...args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [SHRED, ...args], {
        env: {
          ...process.env,
          HOME: home,
          SHRED_WORKSPACE: root,
          SHRED_EDITOR: editor,
          SHRED_SERVICE: CLOSED,
          SHRED_AUTOSTART: '0',
        },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('close', (code) => resolve({ code, stdout, stderr }))
    })
  const withBridge = async () => {
    editor = await startBridge(t, root)
  }
  return { root, drafts, ops, pass, shred, withBridge }
}

for (const mode of ['editor down', 'editor up']) {
  test(`${mode}: a stopped pass fails the next command, clears itself and kills the draft`, async (t) => {
    const s = setup(t)
    if (mode === 'editor up') await s.withBridge()
    s.drafts({ d1: { targetId: 'p1', baseRevision: 'sha256:a' } })
    s.pass('p1', 'd1', ['cancel'])

    const first = await s.shred('apply', 'd1', s.ops)
    assert.equal(first.code, 1)
    assert.match(first.stderr, new RegExp(STOPPED_MESSAGE.replace(/[.]/g, '\\.')))
    const record = readActivity(s.root, 'p1')
    assert.equal(record.state, 'idle')
    assert.equal(record.ended, 'cancelled')
    assert.ok(s.drafts().d1.cancelledAt, 'the draft remembers it was stopped')

    // The banner is gone, but the stopped draft stays dead, publish included.
    const again = await s.shred('frames', 'd1', '--at', '0')
    assert.match(again.stderr, /The user stopped this pass/)
    const publish = await s.shred('publish', 'd1', 'p1', '--label', 'x')
    assert.match(publish.stderr, /The user stopped this pass/)
  })

  test(`${mode}: publish after "Edit anyway" says the user chose to edit, and ends the pass`, async (t) => {
    const s = setup(t)
    if (mode === 'editor up') await s.withBridge()
    s.drafts({ d2: { targetId: 'p2', baseRevision: 'sha256:a' } })
    s.pass('p2', 'd2', ['release'])

    const apply = await s.shred('apply', 'd2', s.ops)
    assert.match(
      apply.stderr,
      /chose to edit the project themselves/,
      'other commands carry a note',
    )
    assert.doesNotMatch(apply.stderr, /stopped this pass/)

    const publish = await s.shred('publish', 'd2', 'p2', '--label', 'Pass 2')
    assert.equal(publish.code, 1)
    assert.ok(publish.stderr.includes(USER_EDITED_MESSAGE.split('\n')[0]))
    assert.match(publish.stderr, /take a new draft from their state/)
    const record = readActivity(s.root, 'p2')
    assert.equal(record.state, 'idle')
    assert.equal(record.ended, 'refused')
  })

  test(`${mode}: commands on the draft or its project keep a live pass alive; done ends it`, async (t) => {
    const s = setup(t)
    if (mode === 'editor up') await s.withBridge()
    s.drafts({ d3: { targetId: 'p3', baseRevision: 'sha256:a' } })
    const before = s.pass('p3', 'd3', [], Date.now() - 5 * 60_000)

    await s.shred('apply', 'd3', s.ops) // fails at the (closed) service, after the heartbeat
    const beat = readActivity(s.root, 'p3')
    assert.equal(beat.state, 'working')
    assert.ok(Date.parse(beat.heartbeatAt) > Date.parse(before.heartbeatAt))

    const status = await s.shred('status')
    assert.match(status.stdout, /p3 {2}working "Tighten the opening" \(draft d3/)

    const done = await s.shred('done', 'd3')
    assert.equal(done.code, 0, done.stderr)
    assert.equal(readActivity(s.root, 'p3').ended, 'done')
    assert.match((await s.shred('status')).stdout, /passes {5}none in progress/)
  })
}

test('a pass that went stale (no heartbeat for 10 minutes) is not revived by a late command', async (t) => {
  const s = setup(t)
  s.drafts({ d4: { targetId: 'p4', baseRevision: 'sha256:a' } })
  const stale = s.pass('p4', 'd4', [], Date.now() - 11 * 60_000)
  await s.shred('apply', 'd4', s.ops)
  assert.equal(readActivity(s.root, 'p4').heartbeatAt, stale.heartbeatAt)
})
