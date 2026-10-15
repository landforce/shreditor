import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMotionRoutes } from './motion-bridge.mjs'
import { starterComposition } from '../skills/shreditor-edit/scripts/motion.mjs'

const PROJECT = '11111111-2222-3333-4444-555555555555'
const CLIP = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function makeWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-motion-bridge-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'projects', PROJECT, 'motion', 'hole-title')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    starterComposition({ width: 1080, height: 1920, fps: 30, duration: 2, title: "Colin's title" }),
  )
  fs.writeFileSync(
    path.join(dir, 'shreditor-renders.json'),
    JSON.stringify([
      { clipId: 'older', renderedAt: '2026-10-01T00:00:00Z' },
      { clipId: CLIP, variables: { title: 'Hole 1' }, renderedAt: '2026-10-02T00:00:00Z' },
    ]),
  )
  return { root, dir }
}

function call(routes, root, { method = 'GET', route, query = {}, body }) {
  let sent
  const sendJson = (_res, status, payload) => (sent = { status, payload })
  const handler = routes({ sendJson })
  return handler(
    { body },
    {},
    { route: `${method} ${route}`, root, query: new URLSearchParams(query) },
  )
    .then((handled) => ({ handled, ...sent }))
    .catch((error) => ({
      handled: true,
      status: error.status ?? 500,
      payload: { message: error.message },
    }))
}

const routesWith =
  (runShred) =>
  ({ sendJson }) =>
    createMotionRoutes({
      sendJson,
      readBody: async (req) => Buffer.from(JSON.stringify(req.body ?? {})),
      runShred,
    })

test('GET motion/clip gives the controls and the values the render used', async (t) => {
  const { root, dir } = makeWorkspace(t)
  const res = await call(routesWith(), root, {
    route: 'motion/clip',
    query: { project: PROJECT, item: CLIP },
  })
  assert.equal(res.status, 200)
  assert.equal(res.payload.source, dir)
  assert.deepEqual(
    res.payload.variables.map((v) => v.id),
    ['title', 'accent'],
  )
  assert.deepEqual(res.payload.values, { title: 'Hole 1', accent: '#f59e0b' })

  const missing = await call(routesWith(), root, {
    route: 'motion/clip',
    query: { project: PROJECT, item: 'ffffffff-0000-0000-0000-000000000000' },
  })
  assert.equal(missing.status, 404)
  const bad = await call(routesWith(), root, {
    route: 'motion/clip',
    query: { project: '../x', item: CLIP },
  })
  assert.equal(bad.status, 400)
})

test('POST motion/rerender runs the agent swap with the new values', async (t) => {
  const { root, dir } = makeWorkspace(t)
  const runs = []
  const runShred = async (args, opts) => {
    runs.push({ args, opts })
    return {
      code: 0,
      output: `rendering…\nreplaced  Motion: hole-title  frames 30-90  [${'9'.repeat(8)}-0000-0000-0000-000000000000]\n`,
    }
  }
  const res = await call(routesWith(runShred), root, {
    method: 'POST',
    route: 'motion/rerender',
    body: { project: PROJECT, item: CLIP, variables: { title: 'Hole 2' } },
  })
  assert.equal(res.status, 200)
  assert.equal(res.payload.clipId, '99999999-0000-0000-0000-000000000000')
  assert.deepEqual(runs[0].args, [
    'motion',
    'add',
    PROJECT,
    dir,
    '--item',
    CLIP,
    '--variables',
    '{"title":"Hole 2"}',
  ])
  assert.equal(runs[0].opts.root, root)
})

test('POST motion/rerender refuses unknown controls and reports a failed render', async (t) => {
  const { root } = makeWorkspace(t)
  const unknown = await call(routesWith(), root, {
    method: 'POST',
    route: 'motion/rerender',
    body: { project: PROJECT, item: CLIP, variables: { titel: 'x' } },
  })
  assert.equal(unknown.status, 400)
  assert.match(unknown.payload.message, /titel/)

  const failed = await call(
    routesWith(async () => ({ code: 1, output: 'shred: HyperFrames render failed:\nboom' })),
    root,
    {
      method: 'POST',
      route: 'motion/rerender',
      body: { project: PROJECT, item: CLIP, variables: {} },
    },
  )
  assert.equal(failed.status, 422)
  assert.match(failed.payload.message, /boom/)
})

test('one re-render per project at a time', async (t) => {
  const { root } = makeWorkspace(t)
  let release
  const slow = () => new Promise((resolve) => (release = () => resolve({ code: 1, output: 'x' })))
  const routes = routesWith(slow)
  let sent = []
  const handler = routes({ sendJson: (_r, status) => sent.push(status) })
  const body = { project: PROJECT, item: CLIP, variables: {} }
  const ctx = { route: 'POST motion/rerender', root, query: new URLSearchParams() }
  const first = handler({ body }, {}, ctx)
  await new Promise((r) => setImmediate(r))
  await handler({ body }, {}, ctx)
  assert.deepEqual(sent, [409])
  release()
  await first
  assert.deepEqual(sent, [409, 422])
})

test('other routes pass through', async (t) => {
  const { root } = makeWorkspace(t)
  const res = await call(routesWith(), root, { route: 'templates/version' })
  assert.equal(res.handled, false)
})
