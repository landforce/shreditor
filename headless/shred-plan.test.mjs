// shred draft's plan gate and shred check's Plan section, on files in a
// scratch workspace. The plan model itself: formats/plan/plan.test.ts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { draftPlanGate, planCheck, planCommands } from '../skills/shreditor-edit/scripts/plan.mjs'

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

// ---------------------------------------------------------------------------
// Performance plans through the commands: scaffold, plan, build, check
// ---------------------------------------------------------------------------

const WORDS = [
  ['Most', 0.5, 0.8],
  ['people', 0.8, 1.1],
  ['store', 1.1, 1.4],
  ['bread', 1.4, 1.8],
  ['wrong.', 1.8, 2.3],
  ['The', 3.8, 4.0],
  ['fridge', 4.0, 4.4],
  ['ruins', 4.4, 4.8],
  ['it.', 4.8, 5.2],
  ['The', 5.5, 5.7],
  ['fridge', 5.7, 6.1],
  ['ruins', 6.1, 6.5],
  ['it.', 6.5, 6.9],
  ['Freeze', 7.2, 7.6],
  ['it', 7.6, 7.8],
  ['instead.', 7.8, 8.3],
].map(([text, start, end]) => ({ text, start, end }))

function speakerWorkspace() {
  const ws = workspaceWith()
  const media = (id, meta) => {
    fs.mkdirSync(path.join(ws, 'media', id, 'cache', 'ai'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'media', id, 'metadata.json'), JSON.stringify({ id, ...meta }))
  }
  media('talk', {
    fileName: 'talk.mov',
    mimeType: 'video/quicktime',
    duration: 9,
    fps: 30,
    audioCodec: 'aac',
    category: 'speaker',
  })
  fs.writeFileSync(
    path.join(ws, 'media', 'talk', 'cache', 'ai', 'transcript.json'),
    JSON.stringify({ data: { segments: [{ text: 'x', start: 0.5, end: 8.3, words: WORDS }] } }),
  )
  media('loaf', { fileName: 'loaf.png', mimeType: 'image/png', duration: 0, category: 'graphics' })
  return ws
}

const yapProject = (items = []) => ({
  metadata: { fps: 30, width: 1080, height: 1920 },
  format: { id: 'graphic-yap' },
  timeline: {
    tracks: [
      { id: 't-images', name: 'Images', kind: 'video', formatRole: 'images', order: 2 },
      { id: 't-speaker', name: 'Speaker', kind: 'video', formatRole: 'speaker', order: 3 },
    ],
    items,
  },
})

function commands(ws, { opt = {}, drafts = {}, project = yapProject() } = {}) {
  const said = []
  const batches = []
  const run = planCommands({
    say: (line) => said.push(line),
    opt,
    workspace: () => ws,
    getProject: async () => ({ project, revision: 'r1' }),
    applyBatch: async (id, ops) => batches.push({ id, ops }),
    readDrafts: () => drafts,
    writeDrafts: () => {},
    warnUnsaved: async () => false,
  })
  return { run, said, batches }
}

test('performance: scaffold, annotate, plan, build and check through the commands', async () => {
  const ws = speakerWorkspace()
  const planFile = path.join(ws, 'projects/p1/agent/plan.json')
  const first = commands(ws, { opt: { scaffold: true } })
  await first.run.plan(['p1', 'talk'])
  const out = first.said.join('\n')
  assert.match(out, /Scaffold  .*agent\/plan\.json/)
  assert.match(out, /THIS IS A STARTING POINT, NOT AN EDIT/)
  // Graphic Yap cuts silences over 1 s; pad 3 frames (a tenth of that).
  assert.match(
    out,
    /5 lines, 3 kept; cut 1 retake\(s\), 0 false start\(s\), 1 pause\(s\)\. Silences of 1 s or more split lines and are cut; pad 3 frames/,
  )
  assert.match(out, /CUT \(retake of l04\)\s+l03/)
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  assert.equal(plan.mode, 'performance')
  // A second scaffold never overwrites the plan.
  const again = commands(ws, { opt: { scaffold: true } })
  await again.run.plan(['p1', 'talk'])
  assert.ok(fs.existsSync(path.join(ws, 'projects/p1/agent/plan.scaffold.json')))
  assert.match(again.said.join('\n'), /plan\.json exists: not overwritten/)

  // The agent annotates it: the ask, the arc, an image on the hook, one to source.
  plan.request = 'Bread rant as a Graphic Yap'
  plan.story.arc = 'Claim, why, fix.'
  plan.performance.lines[0].visuals = [{ asset: 'loaf', at: 'bread' }]
  plan.performance.lines[4].visuals = [{ toSource: 'a freezer full of bread' }]
  fs.writeFileSync(planFile, JSON.stringify(plan))
  const checked = commands(ws)
  await checked.run.plan(['p1'])
  const sheet = checked.said.join('\n')
  assert.equal(process.exitCode ?? 0, 0, sheet)
  assert.match(sheet, /v3 performance, 30 fps, 5 lines \(3 kept, 2 cut\)/)
  assert.match(sheet, /\+ images\s+loaf\.png/)
  assert.match(sheet, /To source \(1\)\n\s+l05-v1/)
  assert.match(sheet, /Estimated from the plan/)
  assert.match(sheet, /Valid\./)
  const state = JSON.parse(
    fs.readFileSync(path.join(ws, 'projects/p1/agent/plan.state.json'), 'utf8'),
  )
  assert.equal(state.errors, 0)
  assert.equal(state.schemaVersion, 3)

  // Build on a draft: the three kept lines, each its own clip (0.3 s apart or more), back to back.
  const draft = commands(ws, { drafts: { d1: { targetId: 'p1' } } })
  await draft.run.build(['d1'])
  const ops = draft.batches[0].ops
  assert.deepEqual(
    ops.filter((op) => op.op === 'addClip').map((op) => [op.mediaId, op.trackId, op.from]),
    [
      ['talk', 't-speaker', 0],
      ['talk', 't-speaker', 60],
      ['talk', 't-speaker', 108],
      ['loaf', 't-images', 30],
    ],
  )
  const built = draft.said.join('\n')
  assert.match(built, /To source: 1 placeholder marker\(s\)/)
  assert.match(built, /Next: shred frames d1 --at 1,61,109/)

  // check's Plan section: clean on the built cut, a warning when a kept line is gone.
  const clip = (id, from, length, sourceStart) => ({
    id,
    type: 'video',
    mediaId: 'talk',
    from,
    durationInFrames: length,
    sourceStart,
    sourceEnd: sourceStart + length,
    sourceFps: 30,
  })
  const windows = ops
    .filter((op) => op.op === 'updateItem' && op.id.$ref.startsWith('run'))
    .map((op) => op.updates)
  const adds = ops.filter((op) => op.op === 'addClip' && op.mediaId === 'talk')
  const items = adds.map((op, i) =>
    clip(`c${i}`, op.from, op.durationInFrames, windows[i].sourceStart),
  )
  const deps = { workspace: () => ws, readDrafts: () => ({ d1: { targetId: 'p1' } }) }
  const clean = planCheck(deps, 'd1', yapProject(items))
  assert.equal(clean.mode, 'performance')
  assert.deepEqual(clean.findings, [])
  assert.equal(clean.validated, true)
  const gone = planCheck(deps, 'd1', yapProject(items.slice(0, 2)))
  assert.match(
    gone.findings.map((f) => f.message).join('\n'),
    /l05 close "Freeze it instead\." is not on the timeline/,
  )
})
