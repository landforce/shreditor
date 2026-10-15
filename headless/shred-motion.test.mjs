import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MOTION_LABEL,
  MOTION_TRACK,
  canvasWarnings,
  compositionInfo,
  motionName,
  motionSlug,
  parseAt,
  parseDuration,
  parseVariables,
  placementOps,
  replacedClip,
  resolveSource,
  starterComposition,
} from '../skills/shreditor-edit/scripts/motion.mjs'

test('motion names become folder slugs', () => {
  assert.equal(motionSlug('Lower third (v2)'), 'lower-third-v2')
  assert.throws(() => motionSlug('  '), /--name/)
})

test('--at takes frames or seconds', () => {
  assert.equal(parseAt('75', 30), 75)
  assert.equal(parseAt('2.5s', 30), 75)
  assert.equal(parseAt(undefined, 30), undefined)
  assert.throws(() => parseAt('soon', 30), /frames \(75\) or seconds/)
})

test('--duration takes seconds with or without s; --variables must be an object', () => {
  assert.equal(parseDuration(undefined), 3)
  assert.equal(parseDuration('2.5s'), 2.5)
  assert.equal(parseDuration('4'), 4)
  assert.throws(() => parseDuration('0'), /--duration/)
  assert.throws(() => parseDuration('soon'), /--duration/)
  assert.deepEqual(parseVariables('{"title":"Hole 1"}'), { title: 'Hole 1' })
  assert.equal(parseVariables(undefined), undefined)
  assert.throws(() => parseVariables('{title}'), /not JSON/)
  assert.throws(() => parseVariables('["a"]'), /JSON object/)
})

test('the starter is a transparent composition at the canvas, with title and accent variables', () => {
  const html = starterComposition({
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 2.5,
    title: 'Hi',
  })
  assert.deepEqual(compositionInfo(html), { width: 1080, height: 1920, duration: 2.5, fps: 30 })
  assert.match(html, /background: transparent/)
  assert.match(html, /data-var-text="title"/)
  const vars = JSON.parse(/data-composition-variables='([^']+)'/.exec(html)[1])
  assert.deepEqual(
    vars.map((v) => v.id),
    ['title', 'accent'],
  )
})

test('a title with quotes or markup is escaped in the starter', () => {
  const html = starterComposition({
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 2,
    title: "Colin's <b>Q&A</b>",
  })
  const attr = /data-composition-variables='([^']+)'/.exec(html)[1]
  const decoded = attr
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  assert.equal(JSON.parse(decoded)[0].default, "Colin's <b>Q&A</b>")
  assert.match(html, />Colin&#39;s &lt;b&gt;Q&amp;A&lt;\/b&gt;<\/h1>/)
})

test('a composition that does not match the canvas is flagged', () => {
  const canvas = { width: 1080, height: 1920 }
  assert.deepEqual(canvasWarnings({ width: 1080, height: 1920, duration: 3 }, canvas), [])
  assert.match(canvasWarnings({ width: 1440, height: 1440, duration: 3 }, canvas)[0], /fitted/)
  assert.match(canvasWarnings(null, canvas)[0], /no root composition/)
})

test('a source is a folder, a composition file (rendered from its project), or a name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'))
  const dir = path.join(root, 'title')
  fs.mkdirSync(path.join(dir, 'compositions'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>')
  fs.writeFileSync(path.join(dir, 'hyperframes.json'), '{}')
  fs.writeFileSync(path.join(dir, 'compositions', 'intro.html'), '<html></html>')
  assert.deepEqual(resolveSource(dir), {
    dir,
    html: path.join(dir, 'index.html'),
    composition: null,
  })
  assert.deepEqual(resolveSource(path.join(dir, 'compositions', 'intro.html')), {
    dir,
    html: path.join(dir, 'compositions', 'intro.html'),
    composition: path.join('compositions', 'intro.html'),
  })
  assert.equal(resolveSource('title', { motionRoot: root }).dir, dir)
  assert.equal(motionName(resolveSource(path.join(dir, 'compositions', 'intro.html'))), 'intro')
  assert.equal(motionName({ dir, composition: path.join('compositions', 'index.html') }), 'title')
  assert.throws(() => resolveSource(path.join(dir, 'nope')), /No such file/)
})

const project = (tracks, items = []) => ({ timeline: { tracks, items } })

test('the first overlay makes a Motion track on top; later ones reuse it', () => {
  const fresh = placementOps({
    project: project([{ id: 'v1', name: 'Shots', kind: 'video' }]),
    mediaId: 'm1',
    from: 30,
    durationInFrames: 75,
    label: `${MOTION_LABEL}title`,
  })
  assert.deepEqual(fresh[0], {
    callerId: 'motionTrack',
    op: 'addTrack',
    kind: 'video',
    name: MOTION_TRACK,
  })
  assert.deepEqual(fresh[1].trackId, { $ref: 'motionTrack#/detail/trackId' })

  const again = placementOps({
    project: project([{ id: 'mt', name: MOTION_TRACK, kind: 'video' }]),
    mediaId: 'm2',
    from: 0,
    durationInFrames: 30,
    label: `${MOTION_LABEL}title`,
  })
  assert.equal(again.length, 2)
  assert.equal(again[0].trackId, 'mt')
})

test('a second overlay at the same time goes on a new Motion lane', () => {
  const ops = placementOps({
    project: project(
      [{ id: 'mt', name: MOTION_TRACK, kind: 'video' }],
      [{ id: 'c1', trackId: 'mt', from: 0, durationInFrames: 90, label: 'Motion: title' }],
    ),
    mediaId: 'm2',
    from: 30,
    durationInFrames: 60,
    label: `${MOTION_LABEL}lower-third`,
  })
  assert.deepEqual(ops[0], {
    callerId: 'motionTrack',
    op: 'addTrack',
    kind: 'video',
    name: 'Motion 2',
  })
  const later = placementOps({
    project: project(
      [{ id: 'mt', name: MOTION_TRACK, kind: 'video' }],
      [{ id: 'c1', trackId: 'mt', from: 0, durationInFrames: 90, label: 'Motion: title' }],
    ),
    mediaId: 'm2',
    from: 90,
    durationInFrames: 60,
    label: `${MOTION_LABEL}lower-third`,
  })
  assert.equal(later[0].trackId, 'mt')
  // Lanes fill in name order, whichever sits on top.
  const lanes = placementOps({
    project: project([
      { id: 'm2', name: 'Motion 2', kind: 'video' },
      { id: 'mt', name: MOTION_TRACK, kind: 'video' },
    ]),
    mediaId: 'm',
    from: 0,
    durationInFrames: 10,
    label: 'x',
  })
  assert.equal(lanes[0].trackId, 'mt')
  assert.deepEqual(lanes[1].updates, { label: 'x', sourceStart: 0, sourceEnd: 10 })
})

const motionClip = {
  id: 'c1',
  type: 'video',
  label: 'Motion: title',
  trackId: 'mt',
  from: 40,
  durationInFrames: 60,
}

test('--item replaces only motion clips, unless forced', () => {
  const p = project(
    [{ id: 'mt', name: MOTION_TRACK, kind: 'video' }],
    [
      motionClip,
      { id: 't1', type: 'text', label: 'Two', trackId: 'v1', from: 0, durationInFrames: 30 },
    ],
  )
  assert.equal(replacedClip(p, 'c1'), motionClip)
  assert.throws(() => replacedClip(p, 't1'), /not a motion graphic/)
  assert.equal(replacedClip(p, 't1', { force: true }).id, 't1')
  assert.throws(() => replacedClip(p, 'gone'), /No clip gone/)
})

test("a re-render swaps into the same place and keeps the clip's look and keyframes", () => {
  const old = { ...motionClip, transform: { x: 10, y: -200 }, fadeOut: 0.3 }
  const p = project([{ id: 'mt', name: MOTION_TRACK, kind: 'video' }], [old])
  p.timeline.keyframes = [
    {
      itemId: 'c1',
      properties: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'k1', frame: 0, value: 0, easing: 'linear' },
            { id: 'k2', frame: 70, value: 1, easing: 'linear' },
          ],
        },
      ],
    },
  ]
  const ops = placementOps({
    project: p,
    mediaId: 'm3',
    durationInFrames: 60,
    label: `${MOTION_LABEL}title`,
    replace: old,
  })
  assert.deepEqual(ops[0], { op: 'removeItems', ids: ['c1'] })
  assert.deepEqual(ops[1], {
    callerId: 'motion',
    op: 'addClip',
    mediaId: 'm3',
    trackId: 'mt',
    from: 40,
    durationInFrames: 60,
  })
  const clip = { $ref: 'motion#/detail/created/0/id' }
  assert.deepEqual(ops[3], {
    op: 'updateItem',
    id: clip,
    updates: { transform: { x: 10, y: -200 }, fadeOut: 0.3 },
    linked: false,
  })
  // The keyframe past the new length is dropped.
  assert.deepEqual(ops.slice(4), [
    { op: 'addKeyframe', itemId: clip, property: 'opacity', frame: 0, value: 0, easing: 'linear' },
  ])
})

test('a longer re-render that would run into the next clip fails before anything changes', () => {
  const p = project(
    [{ id: 'mt', name: MOTION_TRACK, kind: 'video' }],
    [
      motionClip,
      {
        id: 'c2',
        type: 'video',
        label: 'Motion: next',
        trackId: 'mt',
        from: 100,
        durationInFrames: 30,
      },
    ],
  )
  assert.throws(
    () =>
      placementOps({
        project: p,
        mediaId: 'm',
        durationInFrames: 90,
        label: 'x',
        replace: motionClip,
      }),
    /into "Motion: next" at 100/,
  )
})

test('a render that carries sound has its audio removed, the video kept', () => {
  const ops = placementOps({
    project: project([{ id: 'mt', name: MOTION_TRACK, kind: 'video' }]),
    mediaId: 'm4',
    from: 0,
    durationInFrames: 30,
    label: `${MOTION_LABEL}beats`,
    dropAudio: true,
  })
  assert.deepEqual(ops.at(-1), {
    op: 'removeItems',
    ids: [{ $ref: 'motion#/detail/created/1/id' }],
    linked: false,
  })
})
