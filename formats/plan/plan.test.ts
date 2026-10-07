import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { resolveFormat } from '../registry.mjs'
import { readPlan, type Plan, type PlanBeat, type PlanIssue } from './schema.mjs'
import { beatTrackRole, validatePlan, type PlanMedia } from './validate.mjs'
import { planEstimates } from './estimate.mjs'
import { buildPlanOps } from './build.mjs'
import { comparePlan } from './compare.mjs'

// The plan-first edit: reading plans (v1 and v2), every validation rule, the
// format estimates, the build batch (positions, source windows, tracks, text,
// markers, sync sound), markers-only, and the edit compared with its plan.
// shred draft's gate and check's Plan section: headless/shred-plan.test.mjs.

type Raw = Record<string, any> // plans as an agent writes them, valid or not
type Op = Record<string, any>
/** buildPlanOps with ops readable as plain objects. */
const typedBuild = (...args: Parameters<typeof buildPlanOps>) => {
  const built = buildPlanOps(...args)
  return { ...built, ops: built.ops as Op[] }
}

const TEN = resolveFormat('ten-shot', 'even')
const YAP = resolveFormat('graphic-yap')

const MEDIA: Record<string, PlanMedia> = {
  red: {
    mediaId: 'red',
    fileName: 'red.mp4',
    kind: 'video',
    duration: 4,
    sourceFps: 30,
    audioCodec: 'aac',
    category: 'b-roll',
  },
  blue: {
    mediaId: 'blue',
    fileName: 'blue.mp4',
    kind: 'video',
    duration: 2,
    sourceFps: 60,
    audioCodec: null,
    category: 'b-roll',
  },
  still: {
    mediaId: 'still',
    fileName: 'map.png',
    kind: 'image',
    duration: 0,
    sourceFps: 30,
    audioCodec: null,
    category: 'b-roll',
  },
  talk: {
    mediaId: 'talk',
    fileName: 'talk.mov',
    kind: 'video',
    duration: 30,
    sourceFps: 30,
    audioCodec: 'aac',
    category: 'speaker',
  },
}
const resolveMedia = (source: PlanBeat['source']): PlanMedia | { error: string } =>
  MEDIA[source.mediaId ?? ''] ??
  (source.asset === '/footage/green.mp4'
    ? {
        mediaId: null,
        fileName: 'green.mp4',
        kind: 'video',
        duration: 3,
        sourceFps: 30,
        audioCodec: null,
        category: 'b-roll',
      }
    : { error: `${source.mediaId ?? source.asset} is not imported or in a catalog` })

const beat = (id: string, role: string, edit: number[], mediaId: string, extra: Raw = {}): Raw => ({
  id,
  role,
  edit,
  source: { mediaId, in: 0.5, unit: 's' },
  takeaway: `${id} takeaway`,
  why: `${id} why`,
  ...extra,
})

/** A 10 Shot plan: hook, body, close over 5 s at 30 fps, title on the hook. */
const tenShotPlan = (beats?: Raw[]): Raw => ({
  schemaVersion: 2,
  fps: 30,
  durationFrames: 150,
  request: 'Ten seconds of the colours of the street',
  story: {
    arc: 'Open on the brightest wall, run the colours, end on the calm blue.',
    structure: ['hook', 'body', 'close'],
  },
  sources: [],
  beats: beats ?? [
    beat('b01', 'hook', [0, 45], 'red', { text: 'Five colours, one street' }),
    beat('b02', 'body', [45, 90], 'still'),
    beat('b03', 'body', [90, 120], 'red', { source: { mediaId: 'red', in: 2, unit: 's' } }),
    beat('b04', 'close', [120, 150], 'blue', { source: { mediaId: 'blue', in: 0, unit: 's' } }),
  ],
})

function check(raw: unknown, format = TEN, extra: { briefTargetSec?: number } = {}) {
  const read = readPlan(raw, { projectFps: 30 })
  // Tests that use `plan` pass a readable one.
  if (!read.plan) return { ...read, plan: read.plan as unknown as Plan, beats: [] }
  const checked = validatePlan(read.plan, { format, resolveMedia, ...extra })
  return {
    plan: read.plan,
    beats: checked.beats,
    errors: [...read.errors, ...checked.errors],
    warnings: [...read.warnings, ...checked.warnings],
  }
}
const messages = (list: PlanIssue[]) => list.map((i) => `${i.where}: ${i.message}`).join('\n')
const has = (list: PlanIssue[], pattern: RegExp) =>
  list.some((i) => pattern.test(`${i.where}: ${i.message}`))

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('a v2 plan reads into beats with seconds in-points, text roles and spans', () => {
  const { plan, errors, warnings } = check(tenShotPlan())
  assert.equal(errors.length, 0, messages(errors))
  assert.equal(warnings.length, 0, messages(warnings))
  assert.equal(plan.version, 2)
  assert.deepEqual(plan.beats[0]!.text, {
    text: 'Five colours, one street',
    role: 'title',
    start: 0,
    end: 45,
  })
  assert.equal(plan.beats[2]!.source.inSec, 2)
  // Frames in-points are at the plan's fps.
  const frames = check({
    ...tenShotPlan(),
    beats: [
      beat('b01', 'hook', [0, 150], 'red', {
        source: { mediaId: 'red', in: 45, unit: 'frames' },
      }),
    ],
  })
  assert.equal(frames.plan.beats[0]!.source.inSec, 1.5)
})

test('a v1 plan stays readable (frames in-points) but needs a story before it builds', () => {
  const v1 = {
    fps: 30,
    durationFrames: 60,
    sources: [],
    beats: [
      {
        id: 'b01',
        edit: [0, 60],
        source: { mediaId: 'red', in: 15 },
        takeaway: 'x',
        treatment: '',
        sound: '',
        text: null,
      },
    ],
  }
  const { plan, errors } = check(v1)
  assert.equal(plan.version, 1)
  assert.equal(plan.beats[0]!.source.inSec, 0.5)
  assert.equal(plan.beats[0]!.role, null)
  assert.ok(has(errors, /schemaVersion 1 has no story/), messages(errors))
  assert.equal(errors.length, 1, messages(errors))
})

test('shape errors: version, fps, request, arc, ids, roles, edits, sources, units, text', () => {
  assert.ok(has(check({ schemaVersion: 4 }).errors, /schemaVersion 4 is unknown \(1, 2 or 3\)/))
  assert.ok(
    has(
      check({ ...tenShotPlan(), mode: 'performance' }).errors,
      /a performance plan is schemaVersion 3/,
    ),
  )
  assert.ok(has(check({ ...tenShotPlan(), schemaVersion: 3, mode: 'act' }).errors, /mode "act"/))
  assert.ok(has(check([]).errors, /JSON object/))
  const bad = check({
    schemaVersion: 2,
    fps: 25,
    durationFrames: 0,
    beats: [
      { id: 'b01', role: 'hook', edit: [10, 10], source: { mediaId: 'red' } },
      { id: 'b01', role: 'hook', edit: [0, 30], source: { mediaId: 'red', in: 1 } },
      { role: 'body', edit: [0, 30], source: {} },
      { id: 'b04', edit: [0, 30], source: { mediaId: 'red', in: -1, unit: 's' } },
      {
        id: 'b05',
        role: 'hook',
        edit: [0, 30],
        source: { mediaId: 'red' },
        text: { text: 'x', role: 'caption' },
      },
    ],
  })
  for (const pattern of [
    /plan: fps 25 is not the project's 30/,
    /plan: `durationFrames`/,
    /plan: `request` is missing/,
    /plan: `story.arc` is missing/,
    /b01: `edit` must be/,
    /b01: `source.unit` says what `in` counts/,
    /beat 3: `id` is missing/,
    /beat 3: `source` needs a `mediaId`/,
    /b04: `role` is missing/,
    /b04: `source.in` must be a number/,
    /b05: text role "caption"/,
  ])
    assert.ok(has(bad.errors, pattern), `${pattern}\n${messages(bad.errors)}`)
  const dup = check(
    tenShotPlan([
      beat('b01', 'hook', [0, 75], 'red'),
      beat('b01', 'close', [75, 150], 'blue', { source: { mediaId: 'blue', in: 0, unit: 's' } }),
    ]),
  )
  assert.ok(has(dup.errors, /b01: beat id is used twice/), messages(dup.errors))
})

test('a beat without a takeaway or a why is a warning, not an error', () => {
  const plan = tenShotPlan()
  plan.beats[1] = { ...plan.beats[1], takeaway: '', why: '' }
  const { errors, warnings } = check(plan)
  assert.equal(errors.length, 0, messages(errors))
  assert.ok(has(warnings, /b02: no takeaway/))
  assert.ok(has(warnings, /b02: no why/))
})

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

test('roles come from the format structure; the hook opens at frame 0', () => {
  const plan = tenShotPlan()
  plan.beats[0] = { ...plan.beats[0], edit: [0, 45], role: 'body' }
  plan.beats[1] = { ...plan.beats[1], role: 'hook' }
  plan.beats[3] = { ...plan.beats[3], role: 'outro' }
  plan.story.structure = ['hook', 'middle']
  const { errors, warnings } = check(plan)
  assert.ok(
    has(
      errors,
      /b04: role "outro" is not in the format's structure: 10 Shot uses hook, setup, body, payoff, close/,
    ),
    messages(errors),
  )
  assert.ok(has(errors, /plan: story.structure has "middle"/))
  assert.ok(has(errors, /plan: no hook beat at frame 0/))
  assert.ok(has(warnings, /b02: hook after b01 \(body\)/), messages(warnings))
  assert.ok(has(warnings, /plan: no close beat/), messages(warnings))
})

test('media must exist; a catalogued asset is fine until build; in + length must fit the source', () => {
  const plan = tenShotPlan()
  plan.beats[1] = beat('b02', 'body', [45, 90], 'ghost')
  plan.beats[2] = { ...plan.beats[2], source: { asset: '/footage/green.mp4', in: 1, unit: 's' } }
  // blue.mp4 is 2 s: from 1.5 s, a 1 s beat runs to 2.5 s.
  plan.beats[3] = { ...plan.beats[3], source: { mediaId: 'blue', in: 1.5, unit: 's' } }
  const { errors, warnings } = check(plan)
  assert.ok(has(errors, /b02: ghost is not imported or in a catalog/), messages(errors))
  assert.ok(has(warnings, /b03: green.mp4 is catalogued but not imported/))
  assert.ok(
    has(errors, /b04: needs blue.mp4 from 1.50 to 2.50 s, but it is 2.00 s long/),
    messages(errors),
  )
  // Exactly to the end is fine; stills have no length.
  plan.beats[1] = beat('b02', 'body', [45, 90], 'still', {
    source: { mediaId: 'still', in: 99, unit: 's' },
  })
  plan.beats[3] = { ...plan.beats[3], source: { mediaId: 'blue', in: 1, unit: 's' } }
  assert.equal(check(plan).errors.length, 0, messages(check(plan).errors))
})

test('beats on one track may not overlap; on different tracks they may (Graphic Yap)', () => {
  const overlapping = tenShotPlan()
  overlapping.beats[1] = { ...overlapping.beats[1], edit: [40, 90] }
  const { errors } = check(overlapping)
  assert.ok(
    has(
      errors,
      /b02: overlaps b01 on the shots track: frames 0-45 \[0.00-1.50 s\] and frames 40-90 \[1.33-3.00 s\]/,
    ),
    messages(errors),
  )

  const yap = {
    ...tenShotPlan(),
    durationFrames: 300,
    beats: [
      beat('b01', 'hook', [0, 150], 'talk', { text: 'The map nobody reads' }),
      beat('b02', 'body', [30, 90], 'still'),
      beat('b03', 'body', [150, 300], 'talk', { source: { mediaId: 'talk', in: 8, unit: 's' } }),
      beat('b04', 'close', [240, 300], 'still', { text: { text: 'Read it', role: 'labels' } }),
    ],
  }
  const ok = check(yap, YAP)
  assert.equal(ok.errors.length, 0, messages(ok.errors))
  assert.deepEqual(
    ok.beats.map((b) => b.trackRole),
    ['speaker', 'images', 'speaker', 'images'],
  )
  // Two titles at once collide on the Title track.
  yap.beats[2] = { ...yap.beats[2], text: { text: 'Again', role: 'title', edit: [100, 200] } }
  assert.ok(has(check(yap, YAP).errors, /b03: overlaps b01 on the title track/))
})

test('gaps, total length and the brief target are warnings; a planned gap is not', () => {
  const plan = tenShotPlan()
  plan.beats[1] = { ...plan.beats[1], edit: [60, 90] }
  plan.durationFrames = 160
  const { errors, warnings } = check(plan, TEN, { briefTargetSec: 10 })
  assert.equal(errors.length, 0, messages(errors))
  assert.ok(has(warnings, /b02: no picture at frames 45-60/), messages(warnings))
  assert.ok(has(warnings, /plan: no picture at frames 150-160/), messages(warnings))
  assert.ok(has(warnings, /plan: beats end at frame 150 \(5.00 s\); durationFrames is 160/))
  assert.ok(has(warnings, /plan: 5.33 s long; the brief asks for about 10 s/))
  plan.beats[1]!.gapBefore = true
  assert.ok(!has(check(plan).warnings, /b02: no picture/))
})

test('track: a format track name or role, checked against the media kind', () => {
  assert.equal(beatTrackRole({ track: 'Labels' }, MEDIA.still!, TEN), null)
  assert.equal(beatTrackRole({ track: 'Shots' }, MEDIA.still!, TEN), 'shots')
  assert.equal(beatTrackRole({ track: 'images' }, MEDIA.talk!, YAP), 'images')
  assert.equal(beatTrackRole({ track: null }, MEDIA.talk!, YAP), 'speaker')
  assert.equal(beatTrackRole({ track: null }, { kind: 'audio', category: 'music' }, TEN), 'music')
  const plan = tenShotPlan()
  plan.beats[1] = { ...plan.beats[1], track: 'Labels' }
  assert.ok(has(check(plan).errors, /b02: track "Labels" is not a image track of 10 Shot/))
})

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

test('the format targets are estimated from the plan', () => {
  const { plan, beats } = check(tenShotPlan())
  const estimates: Record<string, any> = Object.fromEntries(
    planEstimates(plan, beats, TEN).map((c) => [c.key, c]),
  )
  assert.equal(estimates.shotCount.value, 4)
  assert.equal(estimates.shotCount.status, 'warn') // 12 to 16
  assert.equal(estimates.lengthSec.value, 5)
  assert.equal(estimates.titleHook.status, 'pass')
  assert.equal(estimates.titleHold.value, 1.5) // 1.9 to 4.8 s, or all video
  assert.equal(estimates.titleHold.status, 'warn')
  assert.equal(estimates.titleWords.value, 4)
  assert.ok(estimates.cutsPerMin)
  // No title: the hook is missing, and estimates only ever say pass/warn/fail/info.
  const untitled = tenShotPlan()
  untitled.beats[0] = { ...untitled.beats[0], text: null }
  const u = check(untitled)
  const hook = planEstimates(u.plan, u.beats, TEN).find((c) => c.key === 'titleHook')
  assert.equal(hook?.status, 'fail')
})

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const tenShotProject = (timeline: Raw = {}) => ({
  metadata: { fps: 30, width: 1080, height: 1920 },
  format: { id: 'ten-shot', variant: 'even' },
  timeline: {
    tracks: [
      { id: 'track-title', name: 'Title', kind: 'video', formatRole: 'title', order: 0 },
      { id: 'track-labels', name: 'Labels', kind: 'video', formatRole: 'labels', order: 1 },
      { id: 'track-shots', name: 'Shots', kind: 'video', formatRole: 'shots', order: 2 },
      { id: 'track-music', name: 'Music', kind: 'audio', formatRole: 'music', order: 3 },
    ],
    items: [],
    ...timeline,
  },
})

test('build: clips at the beat frames with source windows, on the format track; 10 Shot drops sync sound', () => {
  const { plan, beats } = check(tenShotPlan())
  const { ops, placed } = typedBuild(plan, beats, { project: tenShotProject(), format: TEN })
  const adds = ops.filter((op) => op.op === 'addClip')
  assert.deepEqual(
    adds.map((op) => [op.mediaId, op.trackId, op.from, op.durationInFrames]),
    [
      ['red', 'track-shots', 0, 45],
      ['still', 'track-shots', 45, 45],
      ['red', 'track-shots', 90, 30],
      ['blue', 'track-shots', 120, 30],
    ],
  )
  const windows = ops.filter((op) => op.op === 'updateItem').map((op) => [op.id.$ref, op.updates])
  assert.deepEqual(windows, [
    ['clip0#/detail/created/0/id', { sourceStart: 15, sourceEnd: 60 }],
    ['clip2#/detail/created/0/id', { sourceStart: 60, sourceEnd: 90 }],
    // blue is 60 fps: 1 s of timeline is 60 source frames.
    ['clip3#/detail/created/0/id', { sourceStart: 0, sourceEnd: 60 }],
  ])
  // red has audio: its linked audio goes, alone; blue has none; the still none.
  const removed = ops.filter((op) => op.op === 'removeItems')
  assert.deepEqual(removed, [
    {
      callerId: 'clip0-mute',
      op: 'removeItems',
      ids: [{ $ref: 'clip0#/detail/created/1/id' }],
      linked: false,
    },
    {
      callerId: 'clip2-mute',
      op: 'removeItems',
      ids: [{ $ref: 'clip2#/detail/created/1/id' }],
      linked: false,
    },
  ])
  assert.deepEqual(
    placed.map((p) => p.syncSound),
    ['removed', null, 'removed', null],
  )
})

test('build: planned text in the kit or project style, a marker per beat, in one batch', () => {
  const { plan, beats } = check(tenShotPlan())
  const plain = typedBuild(plan, beats, { project: tenShotProject(), format: TEN })
  const title = plain.ops.find((op) => op.op === 'addText')!
  assert.deepEqual(
    [title.text, title.from, title.durationInFrames, title.trackId, title.styleId, title.fontSize],
    ['Five colours, one street', 0, 45, 'track-title', undefined, 96],
  )
  const kitted = typedBuild(plan, beats, {
    project: tenShotProject({
      textStyles: [{ id: 'kit:title', name: 'Kit title', role: 'title' }],
    }),
    format: TEN,
  })
  assert.equal(kitted.ops.find((op) => op.op === 'addText')!.styleId, 'kit:title')
  const styled = typedBuild(plan, beats, {
    project: tenShotProject({ textStyles: [{ id: 's1', name: 'Poster', role: 'title' }] }),
    format: TEN,
  })
  assert.equal(styled.ops.find((op) => op.op === 'addText')!.styleId, 's1')
  assert.deepEqual(
    plain.ops.filter((op) => op.op === 'addMarker').map((op) => [op.id, op.frame, op.label]),
    [
      ['plan-b01', 0, 'hook: b01 takeaway'],
      ['plan-b02', 45, 'body: b02 takeaway'],
      ['plan-b03', 90, 'body: b03 takeaway'],
      ['plan-b04', 120, 'close: b04 takeaway'],
    ],
  )
  // callerIds are unique (the batch is one atomic request).
  const ids = plain.ops.map((op) => op.callerId)
  assert.equal(new Set(ids).size, ids.length)
})

test('build: missing format tracks are made in the format order; sync sound kept where allowed', () => {
  const yap = check(
    {
      ...tenShotPlan(),
      durationFrames: 150,
      beats: [
        beat('b01', 'hook', [0, 90], 'talk', { text: 'The map nobody reads' }),
        beat('b02', 'body', [30, 90], 'still'),
        beat('b03', 'close', [90, 150], 'talk', { source: { mediaId: 'talk', in: 8, unit: 's' } }),
      ],
    },
    YAP,
  )
  const project = {
    metadata: { fps: 30 },
    format: { id: 'graphic-yap' },
    timeline: {
      tracks: [
        { id: 't-speaker', name: 'Speaker', kind: 'video', formatRole: 'speaker', order: 5 },
      ],
      items: [],
    },
  }
  const { ops, placed } = typedBuild(yap.plan, yap.beats, { project, format: YAP })
  const tracks = ops.filter((op) => op.op === 'addTrack')
  assert.deepEqual(
    tracks.map((op) => [op.name, op.kind, op.formatRole, op.order]),
    [
      ['Title', 'video', 'title', 4.5],
      ['Images', 'video', 'images', 4.5],
    ],
  )
  assert.equal(ops.find((op) => op.op === 'addText')!.trackId.$ref, 'track-title#/detail/trackId')
  assert.equal(ops.filter((op) => op.op === 'removeItems').length, 0)
  assert.deepEqual(
    placed.map((p) => [p.track, p.syncSound]),
    [
      ['Speaker', 'kept'],
      ['Images', null],
      ['Speaker', 'kept'],
    ],
  )
})

test('build refuses a non-empty draft unless --replace; a rebuild replaces its own markers', () => {
  const { plan, beats } = check(tenShotPlan())
  const busy = tenShotProject({
    items: [{ id: 'x', type: 'video', trackId: 'track-shots', from: 0, durationInFrames: 30 }],
    markers: [
      { id: 'plan-b01', frame: 0, color: '#F59E0B' },
      { id: 'user-note', frame: 9, color: '#3B82F6' },
    ],
  })
  assert.throws(
    () => buildPlanOps(plan, beats, { project: busy, format: TEN }),
    /already has 1 item\(s\).*--replace/,
  )
  const { ops } = typedBuild(plan, beats, { project: busy, format: TEN, replace: true })
  assert.deepEqual(ops.slice(0, 2), [
    { callerId: 'clear-items', op: 'removeItems', ids: ['x'] },
    { callerId: 'clear-markers', op: 'removeMarkers', ids: ['plan-b01'] },
  ])
})

test('markers-only: just the beat markers, even on a timeline with clips', () => {
  const { plan, beats } = check(tenShotPlan())
  const busy = tenShotProject({
    items: [{ id: 'x', type: 'video', trackId: 'track-shots', from: 0, durationInFrames: 30 }],
  })
  const { ops, placed } = typedBuild(plan, beats, {
    project: busy,
    format: TEN,
    markersOnly: true,
  })
  assert.deepEqual([...new Set(ops.map((op) => op.op))], ['addMarker'])
  assert.equal(ops.length, 4)
  assert.ok(placed.every((p) => !p.track))
})

// ---------------------------------------------------------------------------
// The edit against the plan
// ---------------------------------------------------------------------------

const clip = (
  id: string,
  mediaId: string,
  from: number,
  durationInFrames: number,
  type = 'video',
) => ({
  id,
  mediaId,
  from,
  durationInFrames,
  type,
  trackId: 'track-shots',
})

test('compare: a timeline built from the plan is clean', () => {
  const { plan, beats } = check(tenShotPlan())
  const timeline = {
    items: [
      clip('a', 'red', 0, 45),
      clip('b', 'still', 45, 45, 'image'),
      clip('c', 'red', 90, 30),
      clip('d', 'blue', 120, 30),
    ],
  }
  assert.deepEqual(comparePlan(plan, beats, timeline), { findings: [], checked: 4, skipped: 0 })
})

test('compare: a moved clip is missing from its beat and out of order; length drift is reported', () => {
  const { plan, beats } = check(tenShotPlan())
  // The still moved to the end; everything after it slid up 45 frames.
  const timeline = {
    items: [
      clip('a', 'red', 0, 45),
      clip('c', 'red', 45, 30),
      clip('d', 'blue', 75, 30),
      clip('b', 'still', 105, 60, 'image'),
    ],
  }
  const { findings } = comparePlan(plan, beats, timeline)
  const text = findings.map((f) => `${f.level} ${f.message}`).join('\n')
  assert.match(
    text,
    /warn b02 body: no clip from map.png at frames 45-90 \[1.50-3.00 s\]; it plays at frames 105-165/,
  )
  assert.match(text, /warn b04 close: no clip from blue.mp4 at frames 120-150/)
  assert.match(text, /warn b03 now plays before b02 \(planned b02 then b03\)/)
  assert.match(text, /info the timeline is 5.50 s, the plan 5.00 s \(\+15 frames\)/)
  assert.ok(findings.every((f) => ['warn', 'info'].includes(f.level) && f.ranges.length))
  // A clip that is gone entirely, and a small drift that is only info.
  const gone = comparePlan(plan, beats, {
    items: [
      clip('a', 'red', 0, 45),
      clip('b', 'still', 45, 45, 'image'),
      clip('c', 'red', 90, 30),
      clip('e', 'red', 120, 35),
    ],
  })
  const lines = gone.findings.map((f) => `${f.level} ${f.message}`).join('\n')
  assert.match(lines, /b04 close: no clip from blue.mp4 .*; it is not on the timeline/)
  assert.match(lines, /info the timeline is 5.17 s/)
})

test('compare: a moved clip is found where it went, not on another beat that uses the same media', () => {
  const { plan, beats } = check(tenShotPlan())
  // b03 (red from 2 s) moved to the end; b01 (red too) is still on its frames.
  const timeline = {
    items: [
      clip('a', 'red', 0, 45),
      clip('b', 'still', 45, 45, 'image'),
      clip('d', 'blue', 120, 30),
      clip('c', 'red', 150, 30),
    ],
  }
  const text = comparePlan(plan, beats, timeline)
    .findings.map((f) => f.message)
    .join('\n')
  assert.match(
    text,
    /b03 body: no clip from red.mp4 at frames 90-120 .*; it plays at frames 150-180/,
  )
  assert.doesNotMatch(text, /b01/)
})
