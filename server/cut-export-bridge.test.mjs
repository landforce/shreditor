// "All cuts" from the export dialog (cut-export-bridge.mjs): the group comes
// from `shred cut list`, each cut runs `shred export` in order with its own
// "<project> - <cut label>" name, and the job reports progress per cut.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createCutExportRoutes,
  exportFlags,
  parseCutList,
  readExport,
  runCutExport,
} from './cut-export-bridge.mjs'

const LIST = {
  group: 'main1',
  cuts: [
    { id: 'main1', name: 'Warehouse', label: 'Main', main: true },
    { id: 'wide', name: 'Warehouse · 16:9', label: '16:9', main: false },
  ],
}

test('the group, the flags and what an export printed', () => {
  assert.deepEqual(parseCutList(`note: editor not running\n${JSON.stringify(LIST)}\n`), [
    { id: 'main1', label: 'Main', name: 'Warehouse - Main', status: 'queued' },
    { id: 'wide', label: '16:9', name: 'Warehouse - 16:9', status: 'queued' },
  ])
  assert.deepEqual(exportFlags({ codec: 'hevc', quality: 'high' }), [
    '--codec',
    'hevc',
    '--quality',
    'high',
  ])
  assert.deepEqual(exportFlags({ codec: 'rm -rf', quality: 'best' }), [], 'unknown values dropped')
  assert.deepEqual(
    readExport('engine   native (h264; ffmpeg from the original media)\n/ws/a.mp4\n'),
    { engine: 'native', path: '/ws/a.mp4' },
  )
})

test('runs each cut in order; a failed cut does not stop the rest', async () => {
  const calls = []
  const runShred = async (args) => {
    calls.push(args)
    return args[1] === 'main1'
      ? { code: 1, output: 'shred: the service is not running' }
      : { code: 0, output: 'engine   browser (native export not possible):\n/ws/w.mp4' }
  }
  const job = { id: 'j', done: false, cuts: parseCutList(JSON.stringify(LIST)) }
  await runCutExport(job, { runShred, root: '/ws', flags: ['--codec', 'h264'] })
  assert.deepEqual(calls, [
    ['export', 'main1', '--out', 'Warehouse - Main', '--codec', 'h264'],
    ['export', 'wide', '--out', 'Warehouse - 16:9', '--codec', 'h264'],
  ])
  assert.equal(job.done, true)
  assert.equal(job.cuts[0].status, 'failed')
  assert.match(job.cuts[0].error, /service is not running/)
  assert.deepEqual(
    [job.cuts[1].status, job.cuts[1].engine, job.cuts[1].path],
    ['done', 'browser', '/ws/w.mp4'],
  )
})

test('routes: start replies with the job, status follows it, one export at a time', async () => {
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const runShred = async (args) =>
    args[0] === 'cut'
      ? { code: 0, output: JSON.stringify(LIST) }
      : (await gate, { code: 0, output: 'engine   native (h264)\n/ws/out.mp4' })
  const sent = []
  const routes = createCutExportRoutes({
    sendJson: (_res, status, body) => sent.push([status, structuredClone(body)]),
    readBody: async (req) => Buffer.from(JSON.stringify(req.body)),
    runShred,
  })
  const call = (route, body, query = new URLSearchParams()) =>
    routes({ body }, {}, { route, root: '/ws', query })

  await assert.rejects(call('POST cuts/export', {}), /project is required/)
  assert.equal(await call('GET kit'), false, 'other routes pass through')
  await call('POST cuts/export', { project: 'wide', codec: 'h264' })
  const [status, job] = sent.at(-1)
  assert.equal(status, 202)
  assert.deepEqual(
    job.cuts.map((c) => [c.label, c.status]),
    [
      ['Main', 'exporting'],
      ['16:9', 'queued'],
    ],
  )
  await assert.rejects(call('POST cuts/export', { project: 'wide' }), /already being exported/)
  release()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await call('GET cuts/export', undefined, new URLSearchParams({ job: job.id }))
  const [, done] = sent.at(-1)
  assert.equal(done.done, true)
  assert.deepEqual(
    done.cuts.map((c) => [c.status, c.engine]),
    [
      ['done', 'native'],
      ['done', 'native'],
    ],
  )
  await assert.rejects(
    call('GET cuts/export', undefined, new URLSearchParams({ job: 'nope' })),
    /No cut export nope/,
  )
})
