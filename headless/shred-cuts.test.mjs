// Cuts (docs/cuts.md): the re-fit math for a new canvas, grouping and order,
// the contract, the service's trash, and the real `shred cut` CLI against a
// stand-in service built on the lifecycle store (no browser): creation shares
// media and keeps revisions independent, list/rename/remove guard what they
// should, and a draft of a cut publishes back into that cut only.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startBridge } from '../server/bridge-test-server.mjs'
import {
  coverTransform,
  cutGroupName,
  cutLabelError,
  cutProjectName,
  cutsInGroup,
  nextCutOrder,
  refitTimeline,
} from '../src/shared/projects/cuts.mjs'
import { restyleOps } from '../skills/shreditor-edit/scripts/cuts.mjs'
import {
  projectCreateRequestSchema,
  projectSaveRequestSchema,
  projectTrashRequestSchema,
  projectUpdateRequestSchema,
  validate,
} from './lib/contract.mjs'
import {
  createProjectResource,
  getProjectResource,
  listProjectResources,
  saveProjectResource,
  trashProjectResource,
} from './lib/lifecycle-store.mjs'

const SHRED = fileURLToPath(new URL('../skills/shreditor-edit/scripts/shred.mjs', import.meta.url))
const PORTRAIT = { width: 1080, height: 1920 }
const LANDSCAPE = { width: 1920, height: 1080 }

// ── Re-fit math ─────────────────────────────────────────────────────────────

test('full-bleed media covers the new canvas, keeping punch-in and offset (clamped)', () => {
  // A 9:16 clip filling a 9:16 canvas, no transform: covers 16:9 at full width.
  assert.deepEqual(coverTransform({ x: 0, y: 0, ...PORTRAIT }, PORTRAIT, LANDSCAPE), {
    x: 0,
    y: 0,
    width: 1920,
    height: 3413.33,
  })
  // A 16:9 clip covering a 9:16 canvas (3413x1920) fits 16:9 exactly.
  assert.deepEqual(
    coverTransform({ x: 0, y: 0, width: 3413.33, height: 1920 }, PORTRAIT, LANDSCAPE),
    { x: 0, y: 0, width: 1920, height: 1080 },
  )
  // A 1.2x punch-in, offset right: still 1.2x past cover, offset scaled, and
  // clamped so the left edge never shows.
  const punched = coverTransform(
    { x: 300, y: -100, width: 1296, height: 2304 },
    PORTRAIT,
    LANDSCAPE,
  )
  assert.equal(punched.width, 2304)
  assert.equal(punched.height, 4096)
  assert.equal(punched.x, 192) // (2304 - 1920) / 2: clamped from 533
  assert.equal(punched.y, -177.78)
})

test('refit: cover for full-bleed, nearest edge for the rest, review list by reason', () => {
  const timeline = {
    tracks: [{ id: 't1' }],
    items: [
      { id: 'v1', type: 'video', mediaId: 'm9x16', trackId: 't1', from: 0, durationInFrames: 30 },
      {
        id: 'v2',
        type: 'video',
        mediaId: 'm16x9',
        trackId: 't1',
        from: 30,
        durationInFrames: 30,
        transform: { x: 0, y: 0, width: 3413.33, height: 1920, opacity: 0.8 },
      },
      {
        id: 'pip',
        type: 'image',
        mediaId: 'm9x16',
        trackId: 't1',
        from: 60,
        durationInFrames: 30,
        transform: { x: 300, y: 700, width: 270, height: 480 },
      },
      // A lower title: 60 px above the bottom edge stays 60 px above it.
      {
        id: 'txt',
        type: 'text',
        text: 'Lower title',
        trackId: 't1',
        from: 0,
        durationInFrames: 30,
        transform: { x: 0, y: 800, width: 900, height: 200 },
      },
      { id: 'styled', type: 'text', text: 'Hook', textStyleId: 's1', trackId: 't1', from: 0 },
      { id: 'tpl', type: 'composition', compositionId: 'c1', trackId: 't1', from: 0 },
    ],
    compositions: [{ id: 'c1', templateId: 'lower-third', items: [] }],
  }
  const sizes = { m9x16: PORTRAIT, m16x9: LANDSCAPE }
  const {
    timeline: next,
    covered,
    review,
  } = refitTimeline(timeline, PORTRAIT, LANDSCAPE, {
    mediaSize: (id) => sizes[id],
  })
  const byId = Object.fromEntries(next.items.map((item) => [item.id, item]))
  assert.deepEqual(covered, ['v1', 'v2'])
  assert.deepEqual(byId.v1.transform, { x: 0, y: 0, width: 1920, height: 3413.33 })
  assert.equal(byId.v2.transform.width, 1920)
  assert.equal(byId.v2.transform.opacity, 0.8, 'other transform fields are kept')
  // Bottom edge: 1920/2 - (800 + 100) = 60 px; on 1080 high: 540 - 60 - 100 = 380.
  assert.equal(byId.txt.transform.y, 380)
  assert.equal(byId.txt.transform.width, 900, 'same short side: same size')
  assert.equal(byId.styled.transform, undefined, 'styled text is left to its style')
  assert.deepEqual(
    review.map((r) => `${r.id}:${r.reason}`),
    ['v1:framing', 'pip:reanchored', 'txt:reanchored', 'tpl:template'],
  )
  assert.equal(timeline.items[0].transform, undefined, 'the source timeline is not mutated')
})

test('styled text takes its style look for the new aspect, keeping non-position overrides', () => {
  const timeline = {
    items: [
      {
        id: 'a',
        type: 'text',
        textStyleId: 's1',
        color: '#ff0000',
        textStyleOverrides: ['color', 'transform.y'],
      },
      { id: 'b', type: 'text', textStyleId: 's1' },
      { id: 'c', type: 'text', textStyleId: 'vertical-only' },
    ],
    textStyles: [
      {
        id: 's1',
        name: 'Title',
        role: 'title',
        variants: [
          { aspect: '9:16', style: {} },
          { aspect: '16:9', style: {} },
        ],
      },
      {
        id: 'vertical-only',
        name: 'Tall',
        role: 'title',
        variants: [{ aspect: '9:16', style: {} }],
      },
    ],
  }
  const { ops, missing } = restyleOps(timeline, '16:9', '9:16')
  assert.deepEqual(ops, [
    { op: 'applyTextStyle', ids: ['a', 'b'], styleId: 's1' },
    {
      op: 'updateItem',
      id: 'a',
      updates: { color: '#ff0000', textStyleOverrides: ['color'] },
    },
  ])
  assert.deepEqual(
    missing.map((m) => m.name),
    ['Tall'],
  )
})

test('groups sort Main first, then by order; labels and names', () => {
  const cuts = cutsInGroup(
    [
      { id: 'b', cut: { group: 'm', label: 'B', order: 2 } },
      { id: 'other', cut: { group: 'x', label: 'X', order: 1 } },
      { id: 'a', cut: { group: 'm', label: 'A', order: 1 } },
      { id: 'm' },
      { id: 'draft' },
    ],
    'm',
  )
  assert.deepEqual(
    cuts.map((c) => c.id),
    ['m', 'a', 'b'],
  )
  assert.equal(nextCutOrder(cuts), 3)
  assert.equal(nextCutOrder([{ id: 'm' }]), 1)
  assert.equal(cutProjectName('Warehouse', ' Hook B '), 'Warehouse · Hook B')
  assert.equal(cutProjectName('x'.repeat(100), 'Hook B').length, 100)
  assert.equal(
    cutGroupName(null, { name: 'Warehouse · 16:9', cut: { label: '16:9' } }),
    'Warehouse',
  )
  assert.equal(cutLabelError('  '), 'A cut needs a label')
  assert.match(cutLabelError('x'.repeat(61)), /at most 60/)
  assert.equal(cutLabelError('Hook B'), null)
})

// ── Contract and store ──────────────────────────────────────────────────────

const lifecycleProject = (id, extra = {}) => ({
  id,
  name: 'Warehouse',
  description: '',
  createdAt: 1,
  updatedAt: 1,
  duration: 0,
  metadata: { width: 1080, height: 1920, fps: 30 },
  timeline: { tracks: [], items: [] },
  ...extra,
})

test('the contract takes a cut on save and update, and a trash request', () => {
  const cut = { group: 'main1', label: 'Hook B', order: 2 }
  const saved = validate(projectSaveRequestSchema, {
    project: lifecycleProject('c1', { cut }),
    expectedRevision: `sha256:${'a'.repeat(64)}`,
  })
  assert.deepEqual(saved.project.cut, cut)
  assert.throws(() =>
    validate(projectSaveRequestSchema, {
      project: lifecycleProject('c1', { cut: { group: 'main1', label: '' } }),
      force: true,
    }),
  )
  assert.throws(() =>
    validate(projectSaveRequestSchema, {
      project: lifecycleProject('c1', { cut: { ...cut, extra: 1 } }),
      force: true,
    }),
  )
  const update = validate(projectUpdateRequestSchema, { updates: { cut }, force: true })
  assert.deepEqual(update.updates.cut, cut)
  assert.throws(() => validate(projectTrashRequestSchema, {}))
})

function scratch(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('trash: revision-checked, a marker (nothing deleted), media links parked', async (t) => {
  const ws = scratch(t, 'cuts-trash-')
  const created = await createProjectResource(ws, lifecycleProject('c1'))
  const dir = path.join(ws, 'projects', 'c1')
  fs.writeFileSync(path.join(dir, 'media-links.json'), '{"version":"1.0","mediaIds":[]}')
  await assert.rejects(
    trashProjectResource(ws, 'c1', { expectedRevision: `sha256:${'0'.repeat(64)}` }),
    /revision does not match/,
  )
  await trashProjectResource(ws, 'c1', { expectedRevision: created.revision })
  assert.ok(fs.existsSync(path.join(dir, 'project.json')), 'the project stays on disk')
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, '.freecut-trashed.json'))).originalName,
    'Warehouse',
  )
  assert.ok(fs.existsSync(path.join(dir, 'media-links.cut-removed.json')))
  assert.ok(!fs.existsSync(path.join(dir, 'media-links.json')))
  assert.equal((await listProjectResources(ws))[0].trashed, true)
  const index = JSON.parse(fs.readFileSync(path.join(ws, 'index.json'), 'utf8'))
  assert.deepEqual(index.projects, [], 'the index leaves trashed projects out, like the editor')
})

// ── The CLI against a stand-in service ──────────────────────────────────────

/** The lifecycle routes shred uses, on the real store; the browser steps are skipped. */
async function startService(t, ws) {
  let n = 0
  const edits = []
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const body = (req) =>
    new Promise((resolve) => {
      let text = ''
      req.on('data', (d) => (text += d))
      req.on('end', () => resolve(text ? JSON.parse(text) : {}))
    })
  // [matches(request), handle(request) => [status, body]], tried in order.
  const routes = [
    [(r) => r.pathname === '/health', async () => [200, { ok: true, workspace: ws }]],
    [
      (r) => r.project && !r.id && r.method === 'GET',
      async () => [200, { ok: true, projects: await listProjectResources(ws) }],
    ],
    [
      (r) => r.project && !r.id && r.method === 'POST',
      async ({ req }) => {
        const input = validate(projectCreateRequestSchema, await body(req))
        const project = lifecycleProject(`p${++n}`, {
          name: input.name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          metadata: {
            width: input.width ?? 1080,
            height: input.height ?? 1920,
            fps: input.fps ?? 30,
          },
        })
        return [201, { ok: true, ...(await createProjectResource(ws, project)) }]
      },
    ],
    [
      (r) => r.project && !r.action && r.method === 'GET',
      async ({ id }) => [200, { ok: true, ...(await getProjectResource(ws, id)) }],
    ],
    [
      (r) => r.project && !r.action && r.method === 'PUT',
      async ({ req, id }) => {
        const input = validate(projectSaveRequestSchema, await body(req))
        return [200, { ok: true, ...(await saveProjectResource(ws, id, input.project, input)) }]
      },
    ],
    [
      (r) => r.project && !r.action && r.method === 'PATCH',
      async ({ req, id }) => {
        const input = validate(projectUpdateRequestSchema, await body(req))
        const current = await getProjectResource(ws, id)
        const project = { ...current.project, ...input.updates }
        return [200, { ok: true, ...(await saveProjectResource(ws, id, project, input)) }]
      },
    ],
    [
      (r) => r.project && r.action === 'trash',
      async ({ req, id }) => [
        200,
        { ok: true, ...(await trashProjectResource(ws, id, await body(req))) },
      ],
    ],
    [
      (r) => r.project && r.action === 'edit',
      async ({ req, id }) => {
        // Records the ops; persists the project unchanged (no browser here).
        const input = await body(req)
        edits.push({ id, ops: input.ops })
        const current = await getProjectResource(ws, id)
        const saved = await saveProjectResource(ws, id, current.project, input)
        return [200, { ok: true, applied: input.ops.length, ...saved }]
      },
    ],
  ]
  const requestOf = (req) => {
    const url = new URL(req.url, 'http://x')
    const [, v1, projects, id, action] = url.pathname.split('/')
    const project = v1 === 'v1' && projects === 'projects'
    return { req, method: req.method, pathname: url.pathname, project, id, action }
  }
  const sendError = (res, error) =>
    send(res, error.statusCode ?? 500, {
      ok: false,
      error: { code: error.code ?? 'ERROR', message: error.message, fields: error.fields ?? [] },
    })
  const server = http.createServer(async (req, res) => {
    const request = requestOf(req)
    try {
      const route = routes.find(([matches]) => matches(request))
      if (!route) return send(res, 404, { error: 'no route' })
      return send(res, ...(await route[1](request)))
    } catch (error) {
      sendError(res, error)
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return { url: `http://127.0.0.1:${server.address().port}`, edits }
}

async function setupCli(t) {
  const home = scratch(t, 'cuts-home-')
  const ws = scratch(t, 'cuts-ws-')
  const service = await startService(t, ws)
  const editor = await startBridge(t, ws)
  const shred = (...args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [SHRED, ...args], {
        env: {
          ...process.env,
          HOME: home,
          SHRED_WORKSPACE: ws,
          SHRED_EDITOR: editor,
          SHRED_SERVICE: service.url,
          SHRED_AUTOSTART: '0',
        },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('close', (code) => resolve({ code, stdout, stderr }))
    })
  // Main: a 9:16 project with one full-frame 9:16 clip and its media on disk.
  fs.mkdirSync(path.join(ws, 'media', 'm1'), { recursive: true })
  fs.writeFileSync(
    path.join(ws, 'media', 'm1', 'metadata.json'),
    JSON.stringify({ id: 'm1', fileName: 'beach.mov', width: 1080, height: 1920 }),
  )
  fs.writeFileSync(path.join(ws, 'media', 'm1', 'beach.mov'), 'not really a movie')
  const main = await createProjectResource(
    ws,
    lifecycleProject('main1', {
      format: { id: 'ten-shot', variant: 'even' },
      timeline: {
        tracks: [{ id: 'track-1', name: 'Shots', order: 0 }],
        items: [
          {
            id: 'v1',
            type: 'video',
            mediaId: 'm1',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 90,
          },
        ],
      },
    }),
  )
  fs.mkdirSync(path.join(ws, 'projects', 'main1', 'agent'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'projects', 'main1', 'agent', 'brief.yaml'), 'goal: test\n')
  const read = (id) => JSON.parse(fs.readFileSync(path.join(ws, 'projects', id, 'project.json')))
  return { ws, shred, service, main, read }
}

test('shred cut: new shares media and keeps revisions apart; list, rename, remove guard', async (t) => {
  const s = await setupCli(t)
  const wide = await s.shred('cut', 'new', 'main1', '--label', '16:9', '--size', '1920x1080')
  assert.equal(wide.code, 0, wide.stderr)
  const wideId = wide.stdout.split('\n')[0]
  assert.match(wide.stdout, new RegExp(`/editor/${wideId}`))
  assert.match(wide.stdout, /1 full-bleed clip\(s\) set to cover/)
  const cut = s.read(wideId)
  assert.deepEqual(cut.cut, { group: 'main1', label: '16:9', order: 1 })
  assert.equal(cut.name, 'Warehouse · 16:9')
  assert.deepEqual(cut.metadata, { width: 1920, height: 1080, fps: 30 })
  assert.deepEqual(cut.format, { id: 'ten-shot', variant: 'even' })
  assert.equal(cut.timeline.items[0].mediaId, 'm1', 'the same media, by id')
  assert.equal(cut.timeline.items[0].transform.width, 1920)
  assert.deepEqual(fs.readdirSync(path.join(s.ws, 'media')), ['m1'], 'no media copied')
  assert.equal(
    (await getProjectResource(s.ws, 'main1')).revision,
    s.main.revision,
    'making a cut never writes the source',
  )
  assert.equal(s.read('main1').cut, undefined)
  const agent = path.join(s.ws, 'projects', wideId, 'agent')
  assert.equal(fs.readFileSync(path.join(agent, 'brief.yaml'), 'utf8'), 'goal: test\n')
  const first = JSON.parse(fs.readFileSync(path.join(agent, 'passes', '001.json')))
  assert.equal(first.label, 'New cut "16:9" from Main')
  assert.equal(first.resultRevision, (await getProjectResource(s.ws, wideId)).revision)
  assert.ok(first.scorecard?.summary, 'the first record carries the scorecard')

  const hook = await s.shred('cut', 'new', 'main1', '--label', 'Hook B')
  assert.equal(hook.code, 0, hook.stderr)
  const hookId = hook.stdout.split('\n')[0]
  assert.equal(s.read(hookId).cut.order, 2)
  assert.deepEqual(s.read(hookId).metadata, { width: 1080, height: 1920, fps: 30 })
  const dup = await s.shred('cut', 'new', 'main1', '--label', 'hook b')
  assert.equal(dup.code, 1)
  assert.match(dup.stderr, /already has a cut "Hook B"/)
  const fromCut = await s.shred('cut', 'new', 'main1', '--label', 'Hook B wide', '--from', wideId)
  assert.equal(fromCut.code, 0, fromCut.stderr)
  const fromCutId = fromCut.stdout.split('\n')[0]
  assert.equal(s.read(fromCutId).cut.group, 'main1', 'a cut of a cut joins the same group')
  assert.equal(s.read(fromCutId).metadata.width, 1920)

  const list = JSON.parse((await s.shred('cut', 'list', hookId, '--json')).stdout)
  assert.equal(list.group, 'main1')
  assert.deepEqual(
    list.cuts.map((c) => `${c.label} ${c.width}x${c.height}`),
    ['Main 1080x1920', '16:9 1920x1080', 'Hook B 1080x1920', 'Hook B wide 1920x1080'],
  )
  assert.equal(list.cuts[1].lastPass.label, 'New cut "16:9" from Main')
  const listed = await s.shred('cut', 'list', 'main1')
  assert.match(listed.stdout, /4 cuts in group main1/)

  assert.equal((await s.shred('cut', 'rename', hookId, 'Hook C')).code, 0)
  assert.equal(s.read(hookId).name, 'Warehouse · Hook C')
  assert.equal(s.read(hookId).cut.label, 'Hook C')
  assert.equal((await s.shred('cut', 'rename', 'main1', 'Vertical')).code, 0)
  assert.deepEqual(s.read('main1').cut, { group: 'main1', label: 'Vertical', order: 0 })
  assert.equal(s.read('main1').name, 'Warehouse', 'renaming Main keeps the project name')
  assert.match((await s.shred('cut', 'rename', hookId, '16:9')).stderr, /already has a cut/)

  const noFlag = await s.shred('cut', 'remove', hookId)
  assert.equal(noFlag.code, 1)
  assert.match(noFlag.stderr, /--yes/)
  assert.ok(!fs.existsSync(path.join(s.ws, 'projects', hookId, '.freecut-trashed.json')))
  const mainRemove = await s.shred('cut', 'remove', 'main1', '--yes')
  assert.equal(mainRemove.code, 1)
  assert.match(mainRemove.stderr, /main cut; it can't be removed/)
  const removed = await s.shred('cut', 'remove', hookId, '--yes')
  assert.equal(removed.code, 0, removed.stderr)
  assert.match(removed.stdout, /Trash/)
  assert.ok(fs.existsSync(path.join(s.ws, 'media', 'm1', 'beach.mov')), 'media stays')
  const after = JSON.parse((await s.shred('cut', 'list', 'main1', '--json')).stdout)
  assert.deepEqual(
    after.cuts.map((c) => c.label),
    ['Vertical', '16:9', 'Hook B wide'],
  )
  const project = await s.shred('project', wideId)
  assert.match(project.stdout, /cut {6}"16:9" \(2 of 3 in group main1: Vertical, 16:9, Hook B wide/)
  assert.match((await s.shred('status')).stdout, /cuts {7}main1: Vertical, 16:9, Hook B wide/)
})

test('a draft of a cut stays in that cut: publish lands there and nowhere else', async (t) => {
  const s = await setupCli(t)
  const made = await s.shred('cut', 'new', 'main1', '--label', 'Hook B')
  const cutId = made.stdout.split('\n')[0]
  const mainRevision = (await getProjectResource(s.ws, 'main1')).revision
  // The cut's first record makes this a later pass: no plan needed.
  const draft = await s.shred('draft', cutId, '--label', 'New opening')
  assert.equal(draft.code, 0, draft.stderr)
  const draftId = draft.stdout.trim().split('\n').at(-1)
  assert.equal(s.read(draftId).cut, undefined, 'a draft is not a cut')
  const list = JSON.parse((await s.shred('cut', 'list', 'main1', '--json')).stdout)
  assert.deepEqual(
    list.cuts.map((c) => c.id),
    ['main1', cutId],
  )

  const summary = path.join(s.ws, 'summary.md')
  fs.writeFileSync(summary, 'A new opening.')
  const published = await s.shred(
    'publish',
    draftId,
    cutId,
    '--label',
    'New opening',
    '--summary',
    summary,
  )
  assert.equal(published.code, 0, published.stderr)
  assert.match(published.stdout, /cut {6}"Hook B" \(2 of 2 in group main1/)
  assert.ok(fs.existsSync(path.join(s.ws, 'projects', cutId, 'agent', 'passes', '002.json')))
  assert.deepEqual(s.read(cutId).cut, { group: 'main1', label: 'Hook B', order: 1 })
  assert.equal((await getProjectResource(s.ws, 'main1')).revision, mainRevision)
  assert.ok(!fs.existsSync(path.join(s.ws, 'projects', 'main1', 'agent', 'passes')))
  const wrong = await s.shred('publish', draftId, 'main1', '--label', 'x')
  assert.match(wrong.stderr, /is not a draft of main1/)
})
