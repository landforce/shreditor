// shred kit: apply's three-way style plan (idempotent re-apply, kit changes
// flowing to project styles, project tweaks kept), the layout frame sampler
// `shred check` uses, and the service contract for project.kit.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { layoutFrames, planStyles, sameAsMapped } from '../skills/shreditor-edit/scripts/kit.mjs'
import { kitTextStyles } from '../formats/kit/mapping.mjs'
import { projectSaveRequestSchema, projectUpdateRequestSchema } from './lib/contract.mjs'

const kit = () =>
  JSON.parse(
    fs.readFileSync(new URL('../formats/kit-fixtures/stock-kit.v3.json', import.meta.url), 'utf8'),
  )
const familyFor = () => 'Figtree'
const mapped = (k) => kitTextStyles(k, { familyFor })
/** A project copy as the service stores it: version and time added. */
const stored = (styles) => styles.map((style, i) => ({ ...style, version: 3, updatedAt: 100 + i }))
const actions = (plan) => Object.fromEntries(plan.map((entry) => [entry.style.id, entry.action]))

test('first apply adds every kit style', () => {
  const plan = planStyles(mapped(kit()), null, [], false)
  assert.deepEqual(new Set(Object.values(actions(plan))), new Set(['add']))
  assert.equal(plan.length, 6)
})

test('applying the same kit again changes nothing', () => {
  const styles = mapped(kit())
  const plan = planStyles(styles, styles, stored(styles), false)
  assert.deepEqual(new Set(Object.values(actions(plan))), new Set(['same']))
  // Extra versions the project made itself (a 1:1 look) don't count as a change.
  const withSquare = stored(styles).map((s) => ({
    ...s,
    variants: [...s.variants, { ...s.variants[0], aspect: '1:1' }],
  }))
  assert.ok(sameAsMapped(withSquare[0], styles[0]))
})

test('a changed kit updates the styles it changed, and only those', () => {
  const before = kit()
  const after = kit()
  after.titles.style.size = 92
  const plan = planStyles(mapped(after), mapped(before), stored(mapped(before)), false)
  const result = actions(plan)
  assert.equal(result['kit:title'], 'update')
  assert.equal(result['kit:emphasis'], 'update')
  assert.equal(result['kit:caption'], 'same')
  assert.equal(plan.find((e) => e.style.id === 'kit:title').style.variants[0].style.fontSize, 92)
})

test('a project tweak is kept unless the kit changed that style too (or --force)', () => {
  const styles = mapped(kit())
  const project = stored(styles)
  project[0] = structuredClone(project[0])
  project[0].variants[0].style.fontSize = 120
  assert.equal(actions(planStyles(styles, styles, project, false))['kit:title'], 'keep')
  assert.equal(actions(planStyles(styles, styles, project, true))['kit:title'], 'reset')
  const changed = kit()
  changed.titles.style.color = '#111111'
  assert.equal(actions(planStyles(mapped(changed), styles, project, false))['kit:title'], 'replace')
})

test('layout frames put every item on screen with as few renders as possible', () => {
  const items = [
    { id: 'title', from: 0, durationInFrames: 90 },
    { id: 'c1', from: 6, durationInFrames: 33 },
    { id: 'c2', from: 39, durationInFrames: 24 },
    { id: 'c3', from: 120, durationInFrames: 20 },
  ]
  const frames = layoutFrames(items)
  assert.deepEqual(frames, [38, 62, 139])
  for (const item of items)
    assert.ok(
      frames.some((f) => f >= item.from && f < item.from + item.durationInFrames),
      item.id,
    )
})

const lifecycleProject = (extra = {}) => ({
  id: 'p1',
  name: 'Kit',
  description: '',
  createdAt: 1,
  updatedAt: 1,
  duration: 0,
  metadata: { width: 1080, height: 1920, fps: 30 },
  ...extra,
})

const record = {
  path: '/k/kit.json',
  kitVersion: '0.3.0',
  hash: 'sha256:x',
  appliedAt: '2026-10-06T00:00:00Z',
}

test('the service stores and patches project.kit', () => {
  assert.equal(
    projectSaveRequestSchema.safeParse({ project: lifecycleProject({ kit: record }), force: true })
      .success,
    true,
  )
  assert.equal(
    projectSaveRequestSchema.safeParse({
      project: lifecycleProject({ kit: { path: '/k/kit.json' } }),
      force: true,
    }).success,
    false,
  )
  assert.equal(
    projectUpdateRequestSchema.safeParse({ updates: { kit: record }, force: true }).success,
    true,
  )
  assert.equal(
    projectUpdateRequestSchema.safeParse({ updates: { kit: null }, force: true }).success,
    true,
  )
})

test('kit set writes the kit, logs it, and restyles the project from it', async (t) => {
  const os = await import('node:os')
  const path = await import('node:path')
  const { kitCommands } = await import('../skills/shreditor-edit/scripts/kit.mjs')
  const { kitHash } = await import('../formats/kit/node.mjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-kit-set-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'kit.json')
  const original = kit()
  fs.writeFileSync(file, JSON.stringify(original))
  const project = {
    metadata: { width: 1080, height: 1920, fps: 30 },
    timeline: { textStyles: [] },
    kit: { path: file, kitVersion: original.kitVersion, hash: kitHash(original) },
  }
  const batches = []
  const lines = []
  const commands = kitCommands({
    say: (line) => lines.push(line),
    opt: { why: 'bigger titles' },
    workspace: () => root,
    getProject: async () => ({ project, revision: 'r1' }),
    applyBatch: async (_id, ops) => {
      batches.push(ops)
      return {
        revision: 'r2',
        results: ops.map((op) => ({
          detail: { styleId: op.style.id, version: 1, updatedItems: [] },
        })),
      }
    },
    call: async () => ({}),
    key: (name) => name,
  })
  await commands.set(['p1', 'titles.style.size', '104', 'titles.style.letterSpacing=-2'])
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.titles.style.size, 104)
  assert.equal(saved.titles.style.letterSpacing, -2)
  assert.notEqual(saved.kitVersion, original.kitVersion)
  assert.equal(saved.changelog.at(-1).why, 'bigger titles')
  assert.match(saved.changelog.at(-1).change, /titles\.style\.size 88 -> 104/)
  const title = batches.flat().find((op) => op.style.id === 'kit:title')
  assert.ok(title, 'kit:title restyled from the new kit')

  // This fake service keeps the old kit record, so the file reads as changed since apply.
  await assert.rejects(
    commands.set(['p1', 'titles.style.size', '96']),
    /changed since it was applied/,
  )
})
