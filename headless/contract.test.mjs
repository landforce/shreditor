import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  HEADLESS_API_VERSION,
  EDIT_OPERATION_NAMES,
  capabilities,
  editOpSchema,
  editRequestSchema,
  frameRequestSchema,
  layoutRequestSchema,
  normalizeRenderInput,
  renderRequestSchema,
  validate,
} from './lib/contract.mjs'
import { parseArgs } from './lib/cli.mjs'
import { listProjects, loadProject } from './lib/workspace.mjs'

const samples = {
  addText: { op: 'addText', text: 'hello', from: 0 },
  addItem: {
    op: 'addItem',
    item: { type: 'text', id: 'i', trackId: 'v', from: 0, durationInFrames: 1 },
  },
  updateItem: { op: 'updateItem', id: 'i', updates: { text: 'new' } },
  moveItem: { op: 'moveItem', id: 'i', from: 2, trackId: 'v' },
  removeItems: { op: 'removeItems', ids: ['i'], linked: false },
  split: { op: 'split', id: 'i', frame: 1 },
  trimStart: { op: 'trimStart', id: 'i', amount: 1 },
  trimEnd: { op: 'trimEnd', id: 'i', amount: 1 },
  addTransition: {
    op: 'addTransition',
    leftClipId: 'a',
    rightClipId: 'b',
    type: 'crossfade',
    presentation: 'glitch',
    direction: 'from-left',
    alignment: 0.4,
    properties: { intensity: 2 },
  },
  updateTransition: {
    op: 'updateTransition',
    id: 't',
    presentation: 'wipe',
    direction: 'from-top',
  },
  removeTransition: { op: 'removeTransition', id: 't' },
  addTrack: { op: 'addTrack', kind: 'audio', order: 2, name: 'Music', formatRole: 'music' },
  removeTrack: { op: 'removeTrack', trackId: 'v', removeItems: true },
  addClip: { op: 'addClip', mediaId: 'm', from: 0 },
  addKeyframe: {
    op: 'addKeyframe',
    itemId: 'i',
    property: 'opacity',
    frame: 0,
    value: 1,
    easing: 'linear',
  },
  removeKeyframes: { op: 'removeKeyframes', itemId: 'i', property: 'effect:gpu-blur:e1:radius' },
  setTransformParent: {
    op: 'setTransformParent',
    id: 'arm',
    parentItemId: 'body',
    behavior: 'preserve-world',
    frame: 0,
  },
  addEffect: {
    op: 'addEffect',
    itemId: 'i',
    gpuEffectType: 'gpu-gaussian-blur',
    params: { radius: 2 },
  },
  removeEffect: { op: 'removeEffect', itemId: 'i', effectId: 'e' },
  updateEffect: { op: 'updateEffect', itemId: 'i', effectId: 'e', params: { amount: 0.2 } },
  addLut: { op: 'addLut', itemId: 'i', lut: 'Warm Look.cube', intensity: 0.8 },
  setTransform: { op: 'setTransform', id: 'i', transform: { opacity: 0.5, rotation: 2 } },
  unlinkItems: { op: 'unlinkItems', ids: ['i'] },
  addMarker: {
    op: 'addMarker',
    frame: 30,
    id: 'plan-b01',
    label: 'hook: the claim',
    color: '#F59E0B',
  },
  removeMarkers: { op: 'removeMarkers', ids: ['plan-b01'] },
  replaceMedia: { op: 'replaceMedia', id: 'clip-1', mediaId: 'media-2', sourceStart: 30 },
  addTemplate: {
    op: 'addTemplate',
    template: 'Lower third',
    from: 30,
    durationInFrames: 90,
    controls: { Name: 'Jane Doe', 'Bar colour': '#ff3366' },
  },
  updateTemplate: { op: 'updateTemplate', template: 'Lower third' },
  setTemplateControls: {
    op: 'setTemplateControls',
    id: 'i',
    controls: { Name: 'Bo', Accent: null },
  },
  createComposition: { op: 'createComposition', ids: ['bar', 'title'], name: 'Lower third' },
  setCompositionControls: {
    op: 'setCompositionControls',
    compositionId: 'c',
    controls: [{ name: 'Name', targetItemId: 'title', property: 'text.text' }],
  },
  applyTextStyle: { op: 'applyTextStyle', ids: ['i'], styleId: 'Kit Title' },
  upsertTextStyle: {
    op: 'upsertTextStyle',
    style: {
      name: 'Kit Title',
      role: 'title',
      style: {
        fontFamily: 'Anton',
        fontSize: 120,
        stroke: { width: 3, color: '#000', join: 'miter' },
      },
      layout: { yRatio: -0.3, widthRatio: 0.9 },
      defaultDurationFrames: 75,
    },
  },
  addCaptions: { op: 'addCaptions', clipId: 'c', styleId: 'kit-captions', replace: true },
  setSpeedRamp: {
    op: 'setSpeedRamp',
    id: 'c',
    keys: [
      { frame: 0, speed: 1, easing: 'ease-in' },
      { frame: 30, speed: 3 },
    ],
  },
  clearSpeedRamp: { op: 'clearSpeedRamp', id: 'c' },
  setCutout: { op: 'setCutout', id: 'c', enabled: true, subject: 'person', feather: 2 },
}

test('speed ramp op schemas take keys or a preset, in the speed limits', () => {
  const ok = [
    { op: 'setSpeedRamp', id: 'c', keys: [] },
    { op: 'setSpeedRamp', id: 'c', preset: 'hero', frame: 45, speed: 0.25, baseSpeed: 2 },
    { op: 'setSpeedRamp', id: 'c', preset: 'whip', linked: false },
  ]
  for (const op of ok) assert.equal(editOpSchema.safeParse(op).success, true, JSON.stringify(op))
  const bad = [
    { op: 'setSpeedRamp', id: 'c' },
    { op: 'setSpeedRamp', id: 'c', keys: [], preset: 'hero' },
    { op: 'setSpeedRamp', id: 'c', preset: 'zoom' },
    { op: 'setSpeedRamp', id: 'c', keys: [{ frame: 0, speed: 17 }] },
    { op: 'setSpeedRamp', id: 'c', keys: [{ frame: 0, speed: 0.05 }] },
    { op: 'setSpeedRamp', id: 'c', keys: [{ frame: -1, speed: 1 }] },
    { op: 'setSpeedRamp', id: 'c', keys: [{ frame: 0, speed: 1, easing: 'bounce' }] },
    { op: 'clearSpeedRamp', id: 'c', keys: [] },
  ]
  for (const op of bad) assert.equal(editOpSchema.safeParse(op).success, false, JSON.stringify(op))
})

test('template op schemas reject what the editor could not apply', () => {
  const bad = [
    { op: 'addTemplate' },
    { op: 'addTemplate', template: 'x', controls: {} },
    { op: 'addTemplate', template: 'x', controls: { Name: 3 } },
    { op: 'setTemplateControls', id: 'i', controls: {} },
    { op: 'createComposition', ids: [], name: 'x' },
    { op: 'createComposition', ids: ['a'], name: '  ' },
    {
      op: 'setCompositionControls',
      compositionId: 'c',
      controls: [{ name: 'N', targetItemId: 't', property: 'text.fontSize' }],
    },
  ]
  for (const op of bad) assert.equal(editOpSchema.safeParse(op).success, false, JSON.stringify(op))
})

test('text style ops validate styles at the wire', () => {
  assert.equal(editOpSchema.safeParse({ ...samples.addText, styleId: 'Kit Title' }).success, true)
  assert.equal(
    editOpSchema.safeParse({ op: 'upsertTextStyle', fromItemId: 'i', name: 'Mine', role: 'label' })
      .success,
    true,
  )
  const style = samples.upsertTextStyle.style
  for (const bad of [
    { ...style, role: 'heading' },
    { ...style, style: { fontWeight: 'black' } },
    { ...style, style: { surprise: 1 } },
    {
      ...style,
      caption: { maxWordsPerChunk: 0, maxCharsPerLine: 20, maxLines: 1, minChunkFrames: 0 },
    },
  ])
    assert.equal(editOpSchema.safeParse({ op: 'upsertTextStyle', style: bad }).success, false)
  assert.equal(editOpSchema.safeParse({ op: 'upsertTextStyle', name: 'x' }).success, false)
  assert.equal(editOpSchema.safeParse({ op: 'addCaptions', clipId: 'c' }).success, false)
  // One look for a named aspect, or a family with one look per aspect.
  const { style: look, layout } = style
  const family = {
    name: 'Kit Title',
    role: 'title',
    variants: [
      { aspect: '9:16', style: look, layout },
      { aspect: '16:9', style: { ...look, fontSize: 90 } },
    ],
  }
  for (const good of [{ ...style, aspect: '16:9' }, { ...style, aspect: '1920x1080' }, family])
    assert.equal(editOpSchema.safeParse({ op: 'upsertTextStyle', style: good }).success, true)
  for (const bad of [
    { ...style, aspect: 'wide' },
    { ...family, variants: [] },
    { ...family, variants: [{ aspect: 'tall', style: look }] },
    { ...family, style: look },
  ])
    assert.equal(editOpSchema.safeParse({ op: 'upsertTextStyle', style: bad }).success, false)
})

test('every published edit discriminator has a valid strict schema', () => {
  assert.deepEqual(Object.keys(samples), EDIT_OPERATION_NAMES)
  for (const op of EDIT_OPERATION_NAMES)
    assert.equal(editOpSchema.safeParse(samples[op]).success, true, op)
  assert.equal(editOpSchema.safeParse({ ...samples.addText, surprise: true }).success, false)
  assert.equal(editOpSchema.safeParse({ op: 'invented' }).success, false)
  assert.equal(
    editOpSchema.safeParse({ op: 'addEffect', itemId: 'i', gpuEffectType: 'gpu-invented' }).success,
    false,
  )
  assert.equal(editOpSchema.safeParse({ op: 'updateItem', id: 'i', updates: {} }).success, false)
  assert.equal(
    editOpSchema.safeParse({ op: 'updateEffect', itemId: 'i', effectId: 'e' }).success,
    false,
  )
  assert.equal(
    editOpSchema.safeParse({ op: 'setTransform', id: 'i', transform: {} }).success,
    false,
  )
  for (const lut of ['look.png', '../look.cube', 'sub/look.cube', ''])
    assert.equal(editOpSchema.safeParse({ ...samples.addLut, lut }).success, false, lut)
  assert.equal(editOpSchema.safeParse({ ...samples.addLut, intensity: 1.5 }).success, false)
})

test('edit request requires exactly one project source and nonempty valid ops', () => {
  assert.equal(editRequestSchema.safeParse({ project: 'p', ops: [] }).success, false)
  assert.equal(
    editRequestSchema.safeParse({ project: 'p', projectObject: {}, ops: [samples.addText] })
      .success,
    false,
  )
  assert.equal(editRequestSchema.safeParse({ project: 'p', ops: [samples.addText] }).success, true)
})

test('render request enforces finite bounds, ranges, enums, and canonical HTTP fields', () => {
  assert.equal(
    renderRequestSchema.safeParse({ project: 'p', fps: 1, resolution: '16x16' }).success,
    true,
  )
  assert.equal(
    renderRequestSchema.safeParse({ project: 'p', fps: 240, resolution: '16384x16384' }).success,
    true,
  )
  for (const invalid of [
    { project: 'p', fps: 0 },
    { project: 'p', fps: Number.NaN },
    { project: 'p', resolution: '15x1080' },
    { project: 'p', quality: 'best' },
    { project: 'p', inSec: 2, outSec: 1 },
    { project: 'p', duration: 0 },
    { project: 'p', in: 1 },
    { project: 'p', outSec: 2, duration: 1 },
    { project: 'p', container: 'mp3' },
    { project: 'p', audioOnly: true, container: 'webm' },
  ])
    assert.equal(renderRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid))
  assert.deepEqual(
    normalizeRenderInput({ project: 'p', in: '1', 'out-sec': '2', 'audio-only': true }),
    {
      project: 'p',
      inSec: 1,
      outSec: 2,
      audioOnly: true,
    },
  )
})

test('frame and layout requests reject invalid targets and frame options', () => {
  assert.deepEqual(
    frameRequestSchema.parse({ project: 'p', frame: 0, format: 'WEBP', quality: 0 }),
    { project: 'p', frame: 0, format: 'webp', quality: 0 },
  )
  assert.equal(layoutRequestSchema.safeParse({ projectObject: {}, at: 1.5 }).success, true)

  for (const invalid of [
    { project: 'p', frame: '12' },
    { project: 'p', frame: Number.NaN },
    { project: 'p', at: '1.5' },
    { project: 'p', atSeconds: Number.POSITIVE_INFINITY },
    { project: 'p', format: 'gif' },
    { project: 'p', quality: -0.1 },
    { project: 'p', quality: 1.1 },
    { project: 'p', width: 0 },
    { project: 'p', height: 10.5 },
    { project: 'p', projectObject: {}, frame: 0 },
    { frame: 0 },
  ])
    assert.equal(frameRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid))

  for (const invalid of [
    { project: 'p', frame: '12' },
    { project: 'p', at: '1.5' },
    { project: 'p', format: 'png' },
  ])
    assert.equal(layoutRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid))
})

test('validation errors and capabilities are machine-readable and bounded', () => {
  assert.throws(
    () => validate(editRequestSchema, { project: 'p', ops: [] }),
    (error) => {
      assert.equal(error.code, 'VALIDATION_ERROR')
      assert.ok(error.fields.some((field) => field.path === 'ops'))
      return true
    },
  )
  const result = capabilities()
  assert.equal(result.apiVersion, HEADLESS_API_VERSION)
  assert.deepEqual(result.operations, EDIT_OPERATION_NAMES)
  assert.ok(result.schemas.render)
  assert.ok(result.schemas.frame)
  assert.ok(result.schemas.layout)
  // Bounded so an agent can read it whole (about 34 KB with the speed ramp ops).
  // Raised with the speed ramp, cutout, replaceMedia, TTS and cut-trash additions (37.7 KB).
  assert.ok(JSON.stringify(result).length < 40_000)
})

test('CLI rejects unknown options and normalizes aliases', () => {
  const allowed = new Set(['inSec'])
  assert.deepEqual(parseArgs(['--in', '2'], { allowed, aliases: { in: 'inSec' } }), {
    _: [],
    inSec: '2',
  })
  assert.throws(() => parseArgs(['--typo'], { allowed }), /Unknown option/)
})

test('project listings expose distinct actionable directory ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-contract-'))
  try {
    for (const dir of ['one', 'two']) {
      const projectDir = path.join(root, 'projects', dir)
      fs.mkdirSync(projectDir, { recursive: true })
      fs.writeFileSync(
        path.join(projectDir, 'project.json'),
        JSON.stringify({ id: 'duplicate', name: dir, updatedAt: 1 }),
      )
    }
    const listed = listProjects(root)
    assert.deepEqual(listed.map((entry) => entry.id).sort(), ['one', 'two'])
    assert.deepEqual(
      listed.map((entry) => entry.projectId),
      ['duplicate', 'duplicate'],
    )
    for (const entry of listed) assert.equal(loadProject(root, entry.id).project.name, entry.name)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('marker, link and track-role ops reject what the editor could not apply', () => {
  const bad = [
    { op: 'addMarker', frame: -1 },
    { op: 'addMarker', frame: 1.5 },
    { op: 'addMarker' },
    { op: 'removeMarkers', ids: [] },
    { op: 'unlinkItems', ids: [] },
    { op: 'removeItems', ids: ['i'], linked: 'no' },
    { op: 'addTrack', kind: 'video', formatRole: 'hero' },
    { op: 'addTrack', kind: 'video', name: '' },
    { op: 'replaceMedia', id: 'clip-1' },
    { op: 'replaceMedia', id: 'clip-1', mediaId: 'm', sourceStart: -3 },
  ]
  for (const op of bad) assert.equal(editOpSchema.safeParse(op).success, false, JSON.stringify(op))
  assert.equal(editOpSchema.safeParse({ op: 'addMarker', frame: 0 }).success, true)
})
