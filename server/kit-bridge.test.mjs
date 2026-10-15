import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createKitRoutes } from './kit-bridge.mjs'
import { kitHash } from '../formats/kit/node.mjs'

const PROJECT = '11111111-2222-3333-4444-555555555555'
const stock = () =>
  JSON.parse(
    fs.readFileSync(new URL('../formats/kit-fixtures/stock-kit.v3.json', import.meta.url), 'utf8'),
  )

function makeWorkspace(t, { kit = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-kit-bridge-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'kit.json')
  fs.writeFileSync(file, JSON.stringify(stock()))
  fs.mkdirSync(path.join(root, 'projects', PROJECT), { recursive: true })
  const record = { path: file, kitVersion: stock().kitVersion, hash: kitHash(stock()) }
  fs.writeFileSync(
    path.join(root, 'projects', PROJECT, 'project.json'),
    JSON.stringify(kit ? { kit: record } : {}),
  )
  return { root, file }
}

async function call(root, { method = 'GET', route, query = {}, body, runShred }) {
  let sent
  const handler = createKitRoutes({
    sendJson: (_res, status, payload) => (sent = { status, payload }),
    readBody: async () => Buffer.from(JSON.stringify(body ?? {})),
    runShred,
  })
  try {
    const handled = await handler(
      {},
      {},
      {
        route: `${method} ${route}`,
        root,
        query: new URLSearchParams(query),
      },
    )
    return { handled, ...sent }
  } catch (error) {
    return { handled: true, status: error.status ?? 500, payload: { message: error.message } }
  }
}

test('GET kit reads the kit file and says when it drifted', async (t) => {
  const { root, file } = makeWorkspace(t)
  const res = await call(root, { route: 'kit', query: { project: PROJECT } })
  assert.equal(res.status, 200)
  assert.equal(res.payload.path, file)
  assert.equal(res.payload.drift, false)
  assert.equal(res.payload.kit.titles.style.size, 88)

  const changed = stock()
  changed.titles.style.size = 90
  fs.writeFileSync(file, JSON.stringify(changed))
  assert.equal(
    (await call(root, { route: 'kit', query: { project: PROJECT } })).payload.drift,
    true,
  )

  fs.writeFileSync(file, '{nope')
  assert.match(
    (await call(root, { route: 'kit', query: { project: PROJECT } })).payload.error,
    /not valid JSON/,
  )
})

test('GET kit on a project without a kit, or no project', async (t) => {
  const { root } = makeWorkspace(t, { kit: false })
  assert.deepEqual((await call(root, { route: 'kit', query: { project: PROJECT } })).payload, {
    record: null,
  })
  const missing = await call(root, {
    route: 'kit',
    query: { project: 'ffffffff-0000-0000-0000-000000000000' },
  })
  assert.equal(missing.status, 404)
})

test('POST kit/set runs the agent command with path=value pairs', async (t) => {
  const { root } = makeWorkspace(t)
  const runs = []
  const res = await call(root, {
    method: 'POST',
    route: 'kit/set',
    body: {
      project: PROJECT,
      values: { 'titles.style.size': '104', 'titles.style.letterSpacing': '-2' },
    },
    runShred: async (args, opts) => {
      runs.push({ args, opts })
      return { code: 0, output: 'Saved to kit.json: v3.0.0 -> v3.0.1\n' }
    },
  })
  assert.equal(res.status, 200)
  assert.deepEqual(runs[0].args, [
    'kit',
    'set',
    PROJECT,
    'titles.style.size=104',
    'titles.style.letterSpacing=-2',
    '--why',
    'from the Style tab',
  ])
  assert.equal(runs[0].opts.root, root)
})

test('POST kit/set refuses bad input and reports a refused set', async (t) => {
  const { root } = makeWorkspace(t)
  const post = (body, runShred) => call(root, { method: 'POST', route: 'kit/set', body, runShred })
  assert.equal((await post({ project: PROJECT, values: {} })).status, 400)
  assert.equal((await post({ project: PROJECT, values: { '--force': 'x' } })).status, 400)
  assert.equal((await post({ project: PROJECT, values: { 'titles.style.size': 104 } })).status, 400)
  const refused = await post(
    { project: PROJECT, values: { 'titles.style.size': 'big' } },
    async () => ({
      code: 1,
      output: 'shred: titles.style.size is a number (88), not a string',
    }),
  )
  assert.equal(refused.status, 422)
  assert.match(refused.payload.message, /is a number/)
})
