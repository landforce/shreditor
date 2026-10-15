// Portable Chrome contract test for every public headless edit operation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createHarnessServer } from './server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'
import { EDIT_OPERATION_NAMES, editOpSchema } from './lib/contract.mjs'
import { templateCases } from './template-edit-cases.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 2x2x2 LUT that pushes everything warm.
const WARM_CUBE = ['TITLE "Warm"', 'LUT_3D_SIZE 2', ...Array(8).fill('0.9 0.6 0.3')].join('\n')

function baseProject() {
  return {
    id: 'edit-contract',
    name: 'Edit contract',
    description: '',
    schemaVersion: 10,
    createdAt: 1_735_689_600_000,
    updatedAt: 1_735_689_600_000,
    duration: 120,
    metadata: { width: 1280, height: 720, fps: 30, backgroundColor: '#000000' },
    timeline: {
      masterBusDb: 0,
      tracks: [
        {
          id: 'video-1',
          name: 'V1',
          kind: 'video',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
        {
          id: 'video-2',
          name: 'V2',
          kind: 'video',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
          items: [],
        },
        {
          id: 'audio-1',
          name: 'A1',
          kind: 'audio',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 2,
          items: [],
        },
      ],
      items: [
        {
          id: 'text-1',
          type: 'text',
          trackId: 'video-1',
          from: 0,
          durationInFrames: 90,
          label: 'Title',
          text: 'hello',
          color: '#fff',
          fontSize: 80,
          textAlign: 'center',
          verticalAlign: 'middle',
          transform: {},
        },
        {
          id: 'clip-left',
          type: 'video',
          trackId: 'video-2',
          from: 0,
          durationInFrames: 30,
          label: 'Left',
          mediaId: 'existing',
          src: '',
          volume: 0,
          sourceStart: 0,
          sourceEnd: 30,
          sourceDuration: 60,
          sourceFps: 30,
          speed: 1,
          transform: {},
        },
        {
          id: 'clip-right',
          type: 'video',
          trackId: 'video-2',
          from: 30,
          durationInFrames: 30,
          label: 'Right',
          mediaId: 'existing',
          src: '',
          volume: 0,
          sourceStart: 30,
          sourceEnd: 60,
          sourceDuration: 90,
          sourceFps: 30,
          speed: 1,
          transform: {},
        },
      ],
      transitions: [],
      keyframes: [],
      compositions: [],
      markers: [{ id: 'marker-1', frame: 5, label: 'Note', color: '#3B82F6' }],
    },
  }
}

const KIT_TITLE_LOOK = { style: { fontFamily: 'Anton', fontSize: 120, color: '#ffffff' } }
// The harness project is 1280x720: the style's 16:9 version applies there.
const KIT_TITLE = {
  id: 'kit-title',
  name: 'Kit Title',
  role: 'title',
  variants: [
    { aspect: '9:16', ...KIT_TITLE_LOOK, layout: { yRatio: -0.3 } },
    { aspect: '16:9', ...KIT_TITLE_LOOK, layout: { yRatio: -0.2 } },
  ],
  version: 1,
  updatedAt: 1,
}
// Only a vertical version: unusable on the 16:9 harness project until cloned.
const VERTICAL_ONLY = { ...KIT_TITLE, variants: [KIT_TITLE.variants[0]] }

const item = (project, id) => project.timeline.items.find((candidate) => candidate.id === id)
const roundTrip = (project) => JSON.parse(JSON.stringify(project))

const cases = [
  {
    name: 'addText',
    op: {
      op: 'addText',
      id: 'new-text',
      text: 'added',
      from: 90,
      durationInFrames: 20,
      trackId: 'video-1',
    },
    assert: (project) => assert.equal(item(project, 'new-text')?.text, 'added'),
    failure: { op: 'addText', id: 'bad-text', trackId: 'missing-track' },
  },
  {
    name: 'addItem',
    op: {
      op: 'addItem',
      item: {
        id: 'new-item',
        type: 'text',
        trackId: 'video-1',
        from: 100,
        durationInFrames: 15,
        text: 'raw',
        label: 'Raw',
        color: '#fff',
        fontSize: 50,
      },
    },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'new-item')?.label, item(project, 'new-item')?.durationInFrames],
        ['Raw', 15],
      ),
    failure: {
      op: 'addItem',
      item: { type: 'text', trackId: 'missing-track', from: 0, durationInFrames: 10 },
    },
  },
  {
    name: 'updateItem',
    op: { op: 'updateItem', id: 'text-1', updates: { label: 'Updated' } },
    assert: (project) => assert.equal(item(project, 'text-1')?.label, 'Updated'),
    failure: { op: 'updateItem', id: 'missing', updates: { label: 'nope' } },
  },
  {
    name: 'moveItem',
    op: { op: 'moveItem', id: 'text-1', from: 60, trackId: 'video-2' },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'text-1')?.from, item(project, 'text-1')?.trackId],
        [60, 'video-2'],
      ),
    failure: { op: 'moveItem', id: 'missing', from: 2 },
  },
  {
    name: 'removeItems',
    op: { op: 'removeItems', ids: ['text-1'] },
    assert: (project) => assert.equal(item(project, 'text-1'), undefined),
    failure: { op: 'removeItems', ids: ['missing'] },
  },
  {
    name: 'unlinkItems',
    ops: [
      { op: 'updateItem', id: 'clip-left', updates: { linkedGroupId: 'pair' } },
      {
        op: 'addItem',
        item: {
          id: 'left-audio',
          type: 'audio',
          trackId: 'audio-1',
          from: 0,
          durationInFrames: 30,
          label: 'Left audio',
          mediaId: 'existing',
          src: '',
          volume: 0,
          linkedGroupId: 'pair',
          sourceStart: 0,
          sourceEnd: 30,
          sourceFps: 30,
          speed: 1,
        },
      },
      { op: 'unlinkItems', ids: ['left-audio'] },
      // Unlinked, the audio goes alone; the video stays (its own audio muted).
      { op: 'removeItems', ids: ['left-audio'], linked: false },
    ],
    op: { op: 'unlinkItems', ids: ['clip-left'] },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'left-audio'), item(project, 'clip-left')?.embeddedAudioMuted],
        [undefined, true],
      ),
    failure: { op: 'unlinkItems', ids: ['missing'] },
  },
  {
    name: 'addMarker',
    op: { op: 'addMarker', id: 'plan-b01', frame: 12, label: 'hook: the claim' },
    assert: (project) =>
      assert.deepEqual(
        project.timeline.markers.map((m) => [m.id, m.frame, m.label]),
        [
          ['marker-1', 5, 'Note'],
          ['plan-b01', 12, 'hook: the claim'],
        ],
      ),
    failure: { op: 'addMarker', id: 'marker-1', frame: 0 },
  },
  {
    name: 'removeMarkers',
    op: { op: 'removeMarkers', ids: ['marker-1'] },
    assert: (project) => assert.equal(project.timeline.markers?.length ?? 0, 0),
    failure: { op: 'removeMarkers', ids: ['missing'] },
  },
  {
    name: 'split',
    op: { op: 'split', id: 'clip-left', frame: 15 },
    assert: (project) => {
      const parts = project.timeline.items.filter((candidate) => candidate.label === 'Left')
      assert.equal(parts.length, 2)
      assert.equal(
        parts.reduce((sum, candidate) => sum + candidate.durationInFrames, 0),
        30,
      )
    },
    failure: { op: 'split', id: 'clip-left', frame: 0 },
  },
  {
    name: 'trimStart',
    op: { op: 'trimStart', id: 'text-1', amount: 5 },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'text-1')?.from, item(project, 'text-1')?.durationInFrames],
        [5, 85],
      ),
    failure: { op: 'trimStart', id: 'missing', amount: 5 },
  },
  {
    name: 'trimEnd',
    op: { op: 'trimEnd', id: 'text-1', amount: 5 },
    assert: (project) => assert.equal(item(project, 'text-1')?.durationInFrames, 95),
    failure: { op: 'trimEnd', id: 'missing', amount: 5 },
  },
  {
    name: 'addTransition',
    op: {
      op: 'addTransition',
      leftClipId: 'clip-left',
      rightClipId: 'clip-right',
      type: 'crossfade',
      durationInFrames: 10,
      presentation: 'glitch',
      alignment: 0.4,
      properties: { intensity: 2 },
    },
    assert: (project) => {
      assert.equal(project.timeline.transitions.length, 1)
      const transition = project.timeline.transitions[0]
      assert.equal(transition.presentation, 'glitch')
      assert.equal(transition.alignment, 0.4)
      assert.deepEqual(transition.properties, { intensity: 2 })
    },
    failure: {
      op: 'addTransition',
      leftClipId: 'clip-left',
      rightClipId: 'missing',
      durationInFrames: 10,
    },
  },
  {
    name: 'updateTransition',
    op: { op: 'updateTransition', id: 'tr-x', presentation: 'wipe' },
    ops: [
      {
        op: 'addTransition',
        leftClipId: 'clip-left',
        rightClipId: 'clip-right',
        durationInFrames: 10,
        callerId: 'tr',
      },
      {
        op: 'updateTransition',
        id: { $ref: 'tr#/detail/id' },
        presentation: 'wipe',
        direction: 'from-left',
      },
    ],
    assert: (project) => {
      const transition = project.timeline.transitions[0]
      assert.equal(transition.presentation, 'wipe')
      assert.equal(transition.direction, 'from-left')
    },
    schemaFailure: { op: 'updateTransition', id: 'x', alignment: 2 },
  },
  {
    name: 'removeTransition',
    op: { op: 'removeTransition', id: 'tr-x' },
    ops: [
      {
        op: 'addTransition',
        leftClipId: 'clip-left',
        rightClipId: 'clip-right',
        durationInFrames: 10,
        callerId: 'tr',
      },
      { op: 'removeTransition', id: { $ref: 'tr#/detail/id' } },
    ],
    assert: (project) => assert.equal(project.timeline.transitions?.length ?? 0, 0),
    failure: { op: 'removeTransition', id: 'ghost' },
  },
  {
    name: 'setTransformParent',
    op: { op: 'setTransformParent', id: 'clip-right', parentItemId: 'clip-left' },
    assert: (project) => {
      const child = item(project, 'clip-right')
      assert.equal(child.transformParent?.parentItemId, 'clip-left')
      assert.ok(child.transformParent.childLocalReference.width > 0)
      assert.ok(child.transformParent.childWorldReference.width > 0)
    },
    failure: { op: 'setTransformParent', id: 'clip-right', parentItemId: 'missing' },
  },
  {
    name: 'addTrack',
    op: { op: 'addTrack', kind: 'audio', order: 9 },
    assert: (project) =>
      assert.ok(
        project.timeline.tracks.some((track) => track.kind === 'audio' && track.order === 9),
      ),
    schemaFailure: { op: 'addTrack', kind: 'data' },
  },
  {
    name: 'removeTrack',
    op: { op: 'removeTrack', trackId: 'audio-1' },
    assert: (project) =>
      assert.equal(
        project.timeline.tracks.some((track) => track.id === 'audio-1'),
        false,
      ),
    failure: { op: 'removeTrack', trackId: 'video-1' },
  },
  {
    name: 'addClip',
    op: {
      op: 'addClip',
      mediaId: 'video-media',
      from: 90,
      durationInFrames: 30,
      trackId: 'video-1',
    },
    media: [
      {
        mediaId: 'video-media',
        metadata: {
          id: 'video-media',
          fileName: 'generated.mp4',
          mimeType: 'video/mp4',
          duration: 1,
          fps: 30,
          width: 320,
          height: 180,
          audioCodec: 'aac',
          audioCodecSupported: true,
        },
      },
    ],
    assert: (project) => {
      const linked = project.timeline.items.filter(
        (candidate) => candidate.mediaId === 'video-media',
      )
      assert.deepEqual(linked.map((candidate) => candidate.type).sort(), ['audio', 'video'])
      assert.equal(new Set(linked.map((candidate) => candidate.linkedGroupId)).size, 1)
    },
    failure: { op: 'addClip', mediaId: 'missing-media' },
  },
  {
    name: 'replaceMedia',
    op: { op: 'replaceMedia', id: 'clip-right', mediaId: 'video-media', sourceStart: 3 },
    media: [
      {
        mediaId: 'video-media',
        metadata: {
          id: 'video-media',
          fileName: 'generated.mp4',
          mimeType: 'video/mp4',
          duration: 2,
          fps: 30,
          width: 320,
          height: 180,
        },
      },
    ],
    assert: (project) =>
      assert.deepEqual(
        ['mediaId', 'from', 'durationInFrames', 'sourceStart', 'sourceEnd', 'label'].map(
          (key) => item(project, 'clip-right')?.[key],
        ),
        ['video-media', 30, 30, 3, 33, 'generated.mp4'],
      ),
    failure: { op: 'replaceMedia', id: 'clip-right', mediaId: 'missing-media' },
  },
  {
    name: 'addKeyframe',
    op: {
      op: 'addKeyframe',
      itemId: 'text-1',
      property: 'opacity',
      frame: 10,
      value: 0.5,
      easing: 'linear',
    },
    assert: (project) =>
      assert.equal(project.timeline.keyframes[0]?.properties[0]?.keyframes[0]?.value, 0.5),
    failure: { op: 'addKeyframe', itemId: 'missing', property: 'opacity', frame: 10, value: 0.5 },
  },
  {
    name: 'removeKeyframes',
    ops: [
      { op: 'addKeyframe', itemId: 'text-1', property: 'opacity', frame: 10, value: 0.5 },
      { op: 'removeKeyframes', itemId: 'text-1', property: 'opacity' },
    ],
    op: { op: 'removeKeyframes', itemId: 'text-1', property: 'opacity' },
    assert: (project) =>
      assert.equal(
        project.timeline.keyframes.some(
          (group) =>
            group.itemId === 'text-1' &&
            group.properties.some((property) => property.property === 'opacity'),
        ),
        false,
      ),
    failure: { op: 'removeKeyframes', itemId: 'missing', property: 'opacity' },
  },
  {
    name: 'addEffect',
    op: { op: 'addEffect', itemId: 'text-1', gpuEffectType: 'gpu-invert', params: {} },
    assert: (project) => assert.equal(item(project, 'text-1')?.effects?.length, 1),
    failure: { op: 'addEffect', itemId: 'missing', gpuEffectType: 'gpu-invert', params: {} },
  },
  {
    name: 'removeEffect',
    setup: async (page) =>
      (
        await edit(page, baseProject(), [
          { op: 'addEffect', itemId: 'text-1', gpuEffectType: 'gpu-invert', params: {} },
        ])
      ).project,
    opFrom: (project) => ({
      op: 'removeEffect',
      itemId: 'text-1',
      effectId: item(project, 'text-1').effects[0].id,
    }),
    op: { op: 'removeEffect', itemId: 'text-1', effectId: 'effect-id' },
    assert: (project) => assert.equal(item(project, 'text-1')?.effects?.length ?? 0, 0),
    failure: { op: 'removeEffect', itemId: 'text-1', effectId: 'missing-effect' },
  },
  {
    name: 'updateEffect',
    setup: async (page) =>
      (
        await edit(page, baseProject(), [
          { op: 'addEffect', itemId: 'text-1', gpuEffectType: 'gpu-exposure', params: {} },
        ])
      ).project,
    opFrom: (project) => ({
      op: 'updateEffect',
      itemId: 'text-1',
      effectId: item(project, 'text-1').effects[0].id,
      params: { exposure: 0.5 },
      enabled: false,
    }),
    op: { op: 'updateEffect', itemId: 'text-1', effectId: 'effect-id', params: { exposure: 0.5 } },
    assert: (project) =>
      assert.deepEqual(
        [
          item(project, 'text-1')?.effects?.[0]?.effect?.params?.exposure,
          item(project, 'text-1')?.effects?.[0]?.enabled,
        ],
        [0.5, false],
      ),
    failure: { op: 'updateEffect', itemId: 'text-1', effectId: 'missing-effect', enabled: false },
  },
  {
    name: 'addLut',
    op: { op: 'addLut', itemId: 'text-1', lut: 'warm.cube', intensity: 0.5 },
    luts: [{ name: 'warm.cube', text: WARM_CUBE }],
    assert: (project) => {
      const { gpuEffectType, params } = item(project, 'text-1').effects[0].effect
      assert.deepEqual(
        [gpuEffectType, params.lutName, params.lutSize, params.intensity],
        ['gpu-lut', 'Warm', '2', 0.5],
      )
    },
    failure: { op: 'addLut', itemId: 'text-1', lut: 'not-provided.cube' },
  },
  {
    name: 'applyTextStyle',
    op: { op: 'applyTextStyle', ids: ['text-1'], styleId: 'Kit Title' },
    input: { textStyleLibrary: [KIT_TITLE] },
    assert: (project) => {
      assert.deepEqual(
        project.timeline.textStyles.map((style) => style.id),
        ['kit-title'],
      )
      const { textStyleId, fontFamily, fontSize, transform } = item(project, 'text-1')
      // The 16:9 version, scaled from 1920x1080 to the 1280x720 project.
      assert.deepEqual(
        [textStyleId, fontFamily, fontSize, transform.y],
        ['kit-title', 'Anton', 80, -144],
      )
    },
    failure: { op: 'applyTextStyle', ids: ['text-1'], styleId: 'missing-style' },
  },
  {
    name: 'upsertTextStyle',
    ops: [
      { op: 'applyTextStyle', ids: ['text-1'], styleId: 'kit-title' },
      {
        op: 'upsertTextStyle',
        style: {
          ...KIT_TITLE,
          variants: KIT_TITLE.variants.map((variant) => ({
            ...variant,
            style: { ...variant.style, color: '#00e5ff' },
          })),
        },
      },
    ],
    op: { op: 'upsertTextStyle', style: KIT_TITLE },
    input: { textStyleLibrary: [KIT_TITLE] },
    assert: (project) => {
      const [style] = project.timeline.textStyles
      const colors = style.variants.map((variant) => variant.style.color)
      assert.deepEqual(
        [style.version, item(project, 'text-1').color, colors],
        [2, '#00e5ff', ['#00e5ff', '#00e5ff']],
      )
    },
    failure: { op: 'upsertTextStyle', fromItemId: 'clip-left', name: 'Not text', role: 'title' },
  },
  {
    name: 'addCaptions',
    op: { op: 'addCaptions', clipId: 'clip-left', styleId: 'kit-title' },
    input: {
      textStyleLibrary: [KIT_TITLE],
      transcripts: [
        {
          mediaId: 'existing',
          segments: [
            {
              text: 'styles you reuse',
              start: 0,
              end: 0.9,
              words: [
                { text: 'styles', start: 0, end: 0.3 },
                { text: 'you', start: 0.3, end: 0.6 },
                { text: 'reuse', start: 0.6, end: 0.9 },
              ],
            },
          ],
        },
      ],
    },
    assert: (project) => {
      const captions = project.timeline.items.filter(
        (candidate) => candidate.textRole === 'caption',
      )
      assert.deepEqual(
        captions.map((caption) => [caption.text, caption.textStyleId, caption.formatRole]),
        [['styles you reuse', 'kit-title', 'captions']],
      )
    },
    failure: { op: 'addCaptions', clipId: 'clip-left', styleId: 'kit-title' },
  },
  {
    name: 'setTransform',
    op: { op: 'setTransform', id: 'text-1', transform: { opacity: 0.4, x: 12 } },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'text-1')?.transform?.opacity, item(project, 'text-1')?.transform?.x],
        [0.4, 12],
      ),
    failure: { op: 'setTransform', id: 'missing', transform: { opacity: 0.4 } },
  },
  {
    name: 'setSpeedRamp',
    op: {
      op: 'setSpeedRamp',
      id: 'clip-left',
      keys: [
        { frame: 0, speed: 1 },
        { frame: 30, speed: 1.5 },
      ],
    },
    // Same length; the source window is the curve's area (37.5 frames, rounded).
    assert: (project) =>
      assert.deepEqual(
        [
          item(project, 'clip-left')?.durationInFrames,
          item(project, 'clip-left')?.sourceEnd,
          item(project, 'clip-left')?.speedRamp?.map((key) => key.speed),
        ],
        [30, 38, [1, 1.5]],
      ),
    // 4x for 30 frames needs 120 source frames; the media has 60.
    failure: { op: 'setSpeedRamp', id: 'clip-left', keys: [{ frame: 0, speed: 4 }] },
  },
  {
    name: 'clearSpeedRamp',
    op: { op: 'clearSpeedRamp', id: 'clip-left' },
    ops: [
      { op: 'setSpeedRamp', id: 'clip-left', preset: 'ease-out', endSpeed: 0.8 },
      { op: 'clearSpeedRamp', id: 'clip-left' },
    ],
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'clip-left')?.speedRamp, item(project, 'clip-left')?.sourceEnd],
        [undefined, 30],
      ),
    failure: { op: 'clearSpeedRamp', id: 'text-1' },
  },
  {
    name: 'setCutout',
    op: { op: 'setCutout', id: 'clip-left', enabled: true, subject: 'person', feather: 2 },
    // Settings only: the masks are analysed separately (shred cutout, or before a render).
    assert: (project) =>
      assert.deepEqual(
        [
          item(project, 'clip-left')?.cutout?.enabled,
          item(project, 'clip-left')?.cutout?.subject,
          item(project, 'clip-left')?.cutout?.feather,
        ],
        [true, 'person', 2],
      ),
    // Background removal is for video clips; text-1 is a title.
    failure: { op: 'setCutout', id: 'text-1', enabled: true },
  },
]

async function edit(page, project, ops, media, luts, templates, extra = {}) {
  return page.evaluate((input) => window.freecut.editProject(input), {
    project,
    ops,
    media,
    luts,
    ...(templates ? { templates } : {}),
    ...extra,
  })
}

cases.push(...templateCases({ item, edit, baseProject }))

async function main() {
  const distDir = path.join(ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    throw new Error('dist/headless.html is missing; run npm run build first')
  }
  assert.deepEqual(
    cases.map(({ name }) => name).sort(),
    [...EDIT_OPERATION_NAMES].sort(),
    'schema/test operation parity',
  )
  for (const testCase of cases)
    assert.equal(
      editOpSchema.safeParse(testCase.op).success,
      true,
      `${testCase.name} success payload schema`,
    )

  const server = await createHarnessServer({ distDir })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: chromeLaunchArgs(),
  })
  try {
    const page = await browser.newPage()
    await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })

    for (const testCase of cases) {
      const project = testCase.setup ? await testCase.setup(page) : baseProject()
      const operation = testCase.opFrom ? testCase.opFrom(project) : testCase.op
      const result = await edit(
        page,
        project,
        testCase.ops ?? [operation],
        testCase.media,
        testCase.luts,
        testCase.templates,
        testCase.input,
      )
      assert.equal(result.ok, true, `${testCase.name} reports success`)
      testCase.assert(roundTrip(result.project))

      if (testCase.schemaFailure) {
        assert.equal(
          editOpSchema.safeParse(testCase.schemaFailure).success,
          false,
          `${testCase.name} rejects invalid schema`,
        )
      } else {
        assert.equal(
          editOpSchema.safeParse(testCase.failure).success,
          true,
          `${testCase.name} failure payload schema`,
        )
        await assert.rejects(
          edit(page, baseProject(), [testCase.failure]),
          undefined,
          `${testCase.name} meaningful failure`,
        )
      }
      process.stdout.write(`  PASS  ${testCase.name}\n`)
    }

    // A style with no version for the project's aspect fails, naming the way out.
    await assert.rejects(
      edit(
        page,
        baseProject(),
        [{ op: 'applyTextStyle', ids: ['text-1'], styleId: 'kit-title' }],
        [],
        [],
        null,
        {
          textStyleLibrary: [VERTICAL_ONLY],
        },
      ),
      /no 16:9 version \(it has 9:16\)\. Make one from the closest: shred styles clone kit-title --aspect 16:9 --project edit-contract/,
    )
    process.stdout.write('  PASS  applyTextStyle without a version for the aspect\n')
  } finally {
    await browser.close()
    await server.close()
  }
  process.stdout.write(`All ${cases.length} edit operation contracts passed\n`)
}

main().catch((error) => {
  process.stderr.write(`Edit operation contract failed: ${error.stack ?? error}\n`)
  process.exitCode = 1
})
