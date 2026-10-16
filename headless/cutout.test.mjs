// Background removal on the Node side: native export routing, the setCutout
// wire schema, the service's cutout store (path guard, verified model cache),
// per-clip status from the workspace, and `shred cutout`. No browser needed;
// the real-model check is headless/cutout-e2e.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planNativeExport } from './lib/native-plan.mjs'
import { capabilities, editRequestSchema, validate } from './lib/contract.mjs'
import { cutoutStorePath, ensureModelFile, modelForFileName } from './lib/cutout-store.mjs'
import { cutoutStatus } from './lib/cutout-service.mjs'
import { cutoutCommand, parseStroke } from '../skills/shreditor-edit/scripts/cutout.mjs'
import { cutoutStrokeHash } from '../src/shared/cutout/cutout-strokes.mjs'
import { CUTOUT_SAM_MODEL, samModelFileName } from '../src/shared/cutout/cutout-sam.mjs'
import {
  CUTOUT_MODELS,
  cutoutAnalysisKey,
  cutoutModelFileName,
  cutoutRegionKey,
  mediaFingerprint,
} from '../src/shared/cutout/cutout-core.mjs'

const probe = {
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      start_time: '0.000000',
      nb_frames: '300',
      duration: '10.000000',
      color_space: 'bt709',
      color_transfer: 'bt709',
      color_primaries: 'bt709',
      color_range: 'tv',
    },
  ],
  format: { start_time: '0.000000' },
}

const clip = (id, extra = {}) => ({
  id,
  trackId: 'v1',
  type: 'video',
  label: id,
  mediaId: 'm1',
  from: 0,
  durationInFrames: 60,
  sourceStart: 0,
  sourceFps: 30,
  sourceWidth: 1920,
  sourceHeight: 1080,
  ...extra,
})

test('a cut-out clip is drawn by the browser as an overlay; the rest stays native', () => {
  const plan = planNativeExport({
    project: {
      id: 'p',
      name: 'p',
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          { id: 'v2', name: 'v2', order: -1, visible: true, items: [] },
          { id: 'v1', name: 'v1', order: 0, visible: true, items: [] },
        ],
        items: [
          clip('bg', { trackId: 'v1' }),
          clip('cut', { trackId: 'v2', cutout: { enabled: true, subject: 'person' } }),
          clip('off', { trackId: 'v1', from: 60, cutout: { enabled: false, subject: 'person' } }),
        ],
      },
    },
    media: { m1: { original: '/orig/m1.mp4', probe } },
  })
  const route = (id) => plan.decisions.find((d) => d.id === id)
  assert.equal(route('cut').route, 'overlay')
  assert.match(route('cut').reasons.join(), /background removal/)
  assert.equal(route('bg').route, 'native')
  assert.equal(route('off').route, 'native')
})

test('setCutout is an edit op with the same ranges as the project schema', () => {
  const ok = validate(editRequestSchema, {
    project: 'p',
    ops: [{ op: 'setCutout', id: 'c', enabled: true, subject: 'person', feather: 4, sampleRate: 'full' }],
  })
  assert.equal(ok.ops[0].op, 'setCutout')
  assert.throws(() =>
    validate(editRequestSchema, { project: 'p', ops: [{ op: 'setCutout', id: 'c', enabled: true, subject: 'cat' }] }),
  )
  assert.throws(() =>
    validate(editRequestSchema, { project: 'p', ops: [{ op: 'setCutout', id: 'c', enabled: true, feather: 101 }] }),
  )
  assert.throws(() => validate(editRequestSchema, { project: 'p', ops: [{ op: 'setCutout', id: 'c' }] }))
  const caps = capabilities()
  assert.ok(caps.operations.includes('setCutout'))
  assert.ok(caps.lifecycle.routes.includes('POST /v1/cutout'))
})

test('the cutout store only serves cutout folders of media', () => {
  const ws = '/ws'
  assert.equal(
    cutoutStorePath(ws, 'media/abc/cache/cutout/index.json'),
    path.join(ws, 'media/abc/cache/cutout/index.json'),
  )
  assert.equal(
    cutoutStorePath(ws, 'media/abc/cache/cutout/fx-modnet-r10/s0000001.png'),
    path.join(ws, 'media/abc/cache/cutout/fx-modnet-r10/s0000001.png'),
  )
  for (const bad of [
    'projects/p/project.json',
    'media/abc/metadata.json',
    'media/../x/cache/cutout/a.png',
    'media/abc/cache/cutout/../../metadata.json',
    'media/abc/cache/cutout/a/b/c.png',
  ]) {
    assert.throws(() => cutoutStorePath(ws, bad), /cutout store path/, bad)
  }
  assert.equal(modelForFileName(cutoutModelFileName(CUTOUT_MODELS.modnet, 'wasm')).label, CUTOUT_MODELS.modnet.label)
  const decoder = modelForFileName(samModelFileName('decoder', 'wasm'))
  assert.match(decoder.url, /slimsam-77-uniform\/resolve\/5850ab45f587c112167512ffef949107115e26a0\//)
  assert.equal(decoder.sha256, CUTOUT_SAM_MODEL.files.decoder.wasm.sha256)
  assert.equal(modelForFileName('evil.onnx'), null)
})

test('models are cached once and refused when their SHA-256 does not match', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutout-models-'))
  const bytes = Buffer.from('not really a model')
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const download = { name: 'm-123.onnx', label: 'Test model', url: 'https://example.invalid/m.onnx', bytes: bytes.length, sha256 }
  let fetches = 0
  const fetchImpl = async () => {
    fetches++
    return new Response(bytes)
  }
  const file = await ensureModelFile(dir, download, { fetchImpl })
  assert.deepEqual(fs.readFileSync(file), bytes)
  await ensureModelFile(dir, download, { fetchImpl })
  assert.equal(fetches, 1)

  const tampered = { ...download, name: 'x.onnx', sha256: '0'.repeat(64) }
  await assert.rejects(ensureModelFile(dir, tampered, { fetchImpl }), /SHA-256 mismatch/)
  assert.equal(fs.existsSync(path.join(dir, 'x.onnx')), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

function workspaceWithAnalysis(done) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cutout-ws-'))
  const meta = { id: 'm1', fileSize: 10, fileLastModified: 1, width: 1920, height: 1080, duration: 10, fps: 30 }
  fs.mkdirSync(path.join(ws, 'media/m1/cache/cutout'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'media/m1/metadata.json'), JSON.stringify(meta))
  const fingerprint = mediaFingerprint(meta)
  const key = cutoutAnalysisKey({ fingerprint, model: 'modnet', rate: 10 })
  fs.writeFileSync(
    path.join(ws, 'media/m1/cache/cutout/index.json'),
    JSON.stringify({ version: 1, entries: { [key]: { key, model: 'modnet', done } }, auto: { [fingerprint]: 'person' } }),
  )
  const project = {
    id: 'p',
    metadata: { fps: 30 },
    timeline: { items: [clip('c', { cutout: { enabled: true, subject: 'auto', feather: 3 } }), clip('plain')] },
  }
  return { ws, project }
}

test('status says how much of each cut-out clip is analysed', () => {
  const partial = workspaceWithAnalysis([[0, 9]])
  const [item] = cutoutStatus(partial.ws, partial.project)
  assert.deepEqual(
    { ...item, label: undefined },
    {
      itemId: 'c',
      label: undefined,
      mediaId: 'm1',
      subject: 'auto',
      resolvedSubject: 'person',
      model: 'modnet',
      rate: 10,
      needed: 22,
      done: 10,
      state: 'partial',
      feather: 3,
      invert: false,
      strokes: 0,
      regions: 0,
      regionsTracked: 0,
    },
  )
  const full = workspaceWithAnalysis([[0, 30]])
  assert.equal(cutoutStatus(full.ws, full.project)[0].state, 'ready')
  for (const ws of [partial.ws, full.ws]) fs.rmSync(ws, { recursive: true, force: true })
})

test('a clip with smart strokes is ready once their regions are tracked over the clip', () => {
  const { ws, project } = workspaceWithAnalysis([[0, 30]])
  const smart = { tool: 'smartEraser', at: 1.5, size: 0.04, points: [[0.4, 0.8]] }
  const brush = { tool: 'brush', at: 1.5, size: 0.04, points: [[0.5, 0.5]] }
  project.timeline.items[0].cutout.strokes = [smart, brush]
  const [pending] = cutoutStatus(ws, project)
  assert.deepEqual([pending.state, pending.strokes, pending.regions, pending.regionsTracked], ['partial', 2, 1, 0])

  const file = path.join(ws, 'media/m1/cache/cutout/index.json')
  const index = JSON.parse(fs.readFileSync(file, 'utf8'))
  const fingerprint = Object.keys(index.auto)[0]
  const key = cutoutRegionKey({ fingerprint, rate: 10, hash: cutoutStrokeHash(smart) })
  index.regions = { [key]: { key, done: [[9, 20]], covered: [[0, 30]], stats: {} } }
  fs.writeFileSync(file, JSON.stringify(index))
  const [tracked] = cutoutStatus(ws, project)
  assert.deepEqual([tracked.state, tracked.regionsTracked], ['ready', 1])
  fs.rmSync(ws, { recursive: true, force: true })
})

test('shred cutout --stroke paints corrections in the same batch', async () => {
  const applied = []
  await cutoutCommand(['p', 'c'], {
    opt: { stroke: ['smartEraser:0.4,0.8;0.6,0.82'], at: '1.5', size: '0.05', 'clear-strokes': true },
    say: () => {},
    getProject: async () => ({ revision: 'r1', project: { timeline: { items: [{ id: 'c', type: 'video' }] } } }),
    applyBatch: async (id, ops) => applied.push(...ops),
    call: async () => ({ items: [] }),
  })
  assert.deepEqual(applied, [
    { op: 'setCutout', id: 'c', enabled: true },
    { op: 'clearCutoutStrokes', id: 'c' },
    { op: 'addCutoutStroke', id: 'c', tool: 'smartEraser', points: [[0.4, 0.8], [0.6, 0.82]], at: 1.5, size: 0.05 },
  ])
  assert.throws(() => parseStroke('spray:0.1,0.1', { id: 'c', at: '1' }), /tool one of/)
  assert.throws(() => parseStroke('brush:0.1', { id: 'c', at: '1' }), /x,y pairs/)
  assert.throws(() => parseStroke('brush:0.1,0.2', { id: 'c' }), /--at/)
  const op = parseStroke('brush:0.1,0.2', { id: 'c', at: '0' })
  assert.equal(validate(editRequestSchema, { project: 'p', ops: [op] }).ops[0].tool, 'brush')
  for (const bad of [{ ...op, points: [[1.5, 0.2]] }, { ...op, size: 0.9 }, { ...op, tool: 'spray' }]) {
    assert.throws(() => validate(editRequestSchema, { project: 'p', ops: [bad] }))
  }
})

test('shred cutout turns clips on in one batch, starts analysis and waits for it', async () => {
  const lines = []
  const calls = []
  const applied = []
  let polls = 0
  const item = { itemId: 'c', subject: 'person', resolvedSubject: 'person', model: 'modnet', rate: 10, needed: 22, done: 0, state: 'none' }
  await cutoutCommand(['p', 'c'], {
    opt: { subject: 'person', wait: true },
    say: (line) => lines.push(line),
    sleep: async () => {},
    getProject: async () => ({ revision: 'r1', project: { timeline: { items: [{ id: 'c', type: 'video' }] } } }),
    applyBatch: async (id, ops, revision) => applied.push({ id, ops, revision }),
    call: async (method, route) => {
      calls.push(`${method} ${route}`)
      if (method === 'POST') return { items: [item], job: { id: 'j1', state: 'running', jobs: [] } }
      if (route.includes('job=')) {
        polls++
        return polls < 2
          ? { items: [item], job: { id: 'j1', state: 'running', jobs: [{ mediaId: 'm1', state: 'analyzing', done: 5, count: 22 }] } }
          : { items: [{ ...item, done: 22, state: 'ready' }], job: { id: 'j1', state: 'done', jobs: [{ mediaId: 'm1', state: 'done', backend: 'webgpu' }] } }
      }
      return { items: [item] }
    },
  })
  assert.deepEqual(applied, [
    { id: 'p', revision: 'r1', ops: [{ op: 'setCutout', id: 'c', enabled: true, subject: 'person' }] },
  ])
  assert.deepEqual(calls, ['GET /v1/cutout?project=p', 'POST /v1/cutout', 'GET /v1/cutout?project=p&job=j1', 'GET /v1/cutout?project=p&job=j1'])
  assert.match(lines.join('\n'), /analysing 5\/22/)
  assert.match(lines.at(-1), /22\/22 masks {2}ready/)

  await assert.rejects(
    cutoutCommand(['p', 't'], {
      opt: {},
      say: () => {},
      getProject: async () => ({ revision: 'r', project: { timeline: { items: [{ id: 't', type: 'text' }] } } }),
      applyBatch: async () => {},
      call: async () => ({}),
    }),
    /background removal works on video clips/,
  )
})
