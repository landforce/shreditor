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
  motionSlug,
  parseAt,
  placementOps,
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

test('a composition that does not match the canvas is flagged', () => {
  const canvas = { width: 1080, height: 1920 }
  assert.deepEqual(canvasWarnings({ width: 1080, height: 1920, duration: 3 }, canvas), [])
  assert.match(canvasWarnings({ width: 1440, height: 1440, duration: 3 }, canvas)[0], /fitted/)
  assert.match(canvasWarnings(null, canvas)[0], /no root composition/)
})

test('a source is a folder with index.html, or a composition file inside one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'))
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>')
  fs.mkdirSync(path.join(dir, 'compositions'))
  fs.writeFileSync(path.join(dir, 'compositions', 'intro.html'), '<html></html>')
  assert.deepEqual(resolveSource(dir), {
    dir,
    html: path.join(dir, 'index.html'),
    composition: null,
  })
  assert.equal(
    resolveSource(path.join(dir, 'compositions', 'intro.html')).composition,
    'intro.html',
  )
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

test('a re-render swaps into the same clip, place and track', () => {
  const ops = placementOps({
    project: project(
      [{ id: 'mt', name: MOTION_TRACK, kind: 'video' }],
      [{ id: 'c1', trackId: 'mt', from: 40, durationInFrames: 60 }],
    ),
    mediaId: 'm3',
    durationInFrames: 75,
    label: `${MOTION_LABEL}title`,
    replace: 'c1',
  })
  assert.deepEqual(ops[0], { op: 'removeItems', ids: ['c1'] })
  assert.deepEqual(ops[1], {
    callerId: 'motion',
    op: 'addClip',
    mediaId: 'm3',
    trackId: 'mt',
    from: 40,
    durationInFrames: 75,
  })
  assert.throws(
    () =>
      placementOps({
        project: project([]),
        mediaId: 'm',
        durationInFrames: 1,
        label: 'x',
        replace: 'gone',
      }),
    /No clip gone/,
  )
})

test('a render that carries sound has its audio muted on the timeline', () => {
  const ops = placementOps({
    project: project([{ id: 'mt', name: MOTION_TRACK, kind: 'video' }]),
    mediaId: 'm4',
    from: 0,
    durationInFrames: 30,
    label: `${MOTION_LABEL}beats`,
    muteAudio: true,
  })
  assert.deepEqual(ops.at(-1), {
    op: 'updateItem',
    id: { $ref: 'motion#/detail/created/1/id' },
    updates: { volume: -60, label: `${MOTION_LABEL}beats (audio, muted)` },
    linked: false,
  })
})
