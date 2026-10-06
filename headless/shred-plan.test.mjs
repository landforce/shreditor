// shred draft's plan gate and shred check's Plan section, on files in a
// scratch workspace. The plan model itself: formats/plan/plan.test.ts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { draftPlanGate, planCheck } from '../skills/shreditor-edit/scripts/plan.mjs'

const tenShotPlan = () => ({
  schemaVersion: 2,
  fps: 30,
  durationFrames: 60,
  request: 'Two seconds of red',
  story: { arc: 'One red wall.', structure: ['hook'] },
  beats: [
    {
      id: 'b01',
      role: 'hook',
      edit: [0, 60],
      source: { mediaId: 'red', in: 0, unit: 's' },
      takeaway: 'red',
      why: 'it is red',
    },
  ],
})

// ---------------------------------------------------------------------------
// The draft gate and the check section (files in a scratch workspace)
// ---------------------------------------------------------------------------

function workspaceWith({ plan, state, passes = 0 } = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-plan-'))
  const dir = path.join(ws, 'projects', 'p1', 'agent')
  fs.mkdirSync(path.join(dir, 'passes'), { recursive: true })
  for (let i = 1; i <= passes; i += 1)
    fs.writeFileSync(path.join(dir, 'passes', `00${i}.json`), '{}')
  if (plan) fs.writeFileSync(path.join(dir, 'plan.json'), plan)
  if (state)
    fs.writeFileSync(
      path.join(dir, 'plan.state.json'),
      JSON.stringify(state(path.join(dir, 'plan.json'))),
    )
  return ws
}
const sha = async (text) =>
  `sha256:${(await import('node:crypto')).createHash('sha256').update(text).digest('hex')}`
const gate = (ws, { noPlan = false, items = [] } = {}) => {
  const said = []
  const result = draftPlanGate(
    { say: (line) => said.push(line), opt: { 'no-plan': noPlan }, workspace: () => ws },
    'p1',
    { timeline: { items } },
  )
  return { result, said }
}

test('draft gate: the first pass needs a plan that validated clean at its current hash', async () => {
  assert.throws(
    () => gate(workspaceWith()),
    /first edit of a project is built from a plan, and p1 has none yet\. Catalog the footage.*shred plan p1/,
  )
  const text = JSON.stringify(tenShotPlan())
  assert.throws(
    () => gate(workspaceWith({ plan: text })),
    /changed since it was last validated \(or never was\)\. Run: shred plan p1/,
  )
  const hash = await sha(text)
  assert.throws(
    () => gate(workspaceWith({ plan: text, state: (file) => ({ file, hash, errors: 2 }) })),
    /had 2 error\(s\)/,
  )
  const stale = workspaceWith({
    plan: text,
    state: (file) => ({ file, hash: 'sha256:old', errors: 0 }),
  })
  assert.throws(() => gate(stale), /changed since it was last validated/)
  const ok = workspaceWith({ plan: text, state: (file) => ({ file, hash, errors: 0 }) })
  assert.deepEqual(gate(ok).result, {
    mode: 'plan',
    file: path.join(ok, 'projects/p1/agent/plan.json'),
    hash,
  })
})

test('draft gate: later passes go ahead with a reminder; --no-plan only over a hand-built timeline', () => {
  const later = gate(workspaceWith({ passes: 1 }))
  assert.deepEqual(later.result, { mode: 'later' })
  assert.match(later.said.join('\n'), /restructure .* starts by updating the plan/)
  assert.throws(
    () => gate(workspaceWith(), { noPlan: true }),
    /--no-plan is only for a timeline the user built by hand, and p1's is empty/,
  )
  const hand = gate(workspaceWith(), { noPlan: true, items: [{ id: 'x' }] })
  assert.equal(hand.result.mode, 'no-plan')
  assert.match(hand.said.join('\n'), /logged with the pass/)
})

test("check's Plan section reads the target project's plan for a draft, and says when it changed", async () => {
  const ws = workspaceWith({ plan: JSON.stringify(tenShotPlan()) })
  // No imported media in this workspace: every beat is reported as an error and skipped.
  const project = { metadata: { fps: 30 }, format: { id: 'ten-shot' }, timeline: { items: [] } }
  const report = planCheck(
    { workspace: () => ws, readDrafts: () => ({ d1: { targetId: 'p1' } }) },
    'd1',
    project,
  )
  assert.equal(report.validated, false)
  assert.equal(report.skipped, 0)
  assert.equal(report.checked, 0)
  assert.ok(report.planErrors > 0)
  assert.equal(planCheck({ workspace: () => ws, readDrafts: () => ({}) }, 'nobody', project), null)
})
