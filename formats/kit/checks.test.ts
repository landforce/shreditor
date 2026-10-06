import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Kit, KitRule } from './kit.mjs'
import { scoreKit, kitLayoutItems } from './checks.mjs'
import type { KitLayoutEntry } from './checks.mjs'
import { kitTargetOverrides } from './report.mjs'
import { createFormatTracks } from '../registry.mjs'
import { scoreProject } from '../scorecard.mjs'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../kit-fixtures')
const v3 = (): Kit =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, 'stock-kit.v3.json'), 'utf8')) as Kit

type Item = Record<string, unknown> & { id: string; from: number; durationInFrames: number }
interface Box {
  x: number
  y: number
  width: number
  height: number
}

const tracks = [
  ...createFormatTracks('greenscreen'),
  ...createFormatTracks('graphic-yap').filter((t) => t.formatRole === 'images'),
].map((t) => ({ ...t, items: undefined }))
const trackOf = (role: string) => tracks.find((t) => t.formatRole === role)!.id

/** A text item on its role's track, with the kit style id. */
function text(
  id: string,
  styleId: string,
  from: number,
  duration: number,
  extra: Record<string, unknown> = {},
): Item {
  const role = styleId.startsWith('kit:caption')
    ? 'captions'
    : styleId === 'kit:overlay'
      ? 'title'
      : 'title'
  return {
    id,
    type: 'text',
    trackId: trackOf(role),
    from,
    durationInFrames: duration,
    label: id,
    text: id,
    textStyleId: styleId,
    ...extra,
  }
}

function picture(
  id: string,
  role: string,
  from: number,
  duration: number,
  extra: Record<string, unknown> = {},
): Item {
  return {
    id,
    type: 'image',
    trackId: trackOf(role),
    from,
    durationInFrames: duration,
    label: id,
    mediaId: `m-${id}`,
    formatRole: role,
    ...extra,
  }
}

/** dumpLayout entry for text: per-line background boxes, `lines` lines. */
function textLayout(
  id: string,
  box: Box,
  lines = 1,
  mode: 'bars' | 'plain' = 'bars',
): KitLayoutEntry {
  const h = box.height / lines
  const rows = Array.from({ length: lines }, (_, i) => ({
    text: `line ${i}`,
    x: box.x,
    y: box.y + i * h,
    width: box.width,
    height: h,
  }))
  return {
    id,
    ...box,
    textLayout: {
      box,
      lines: rows,
      ...(mode === 'bars' ? { lineBackgrounds: rows.map((r) => ({ ...r, radius: 0 })) } : {}),
    },
  }
}

const pictureLayout = (id: string, box: Box, rotation = 0): KitLayoutEntry => ({
  id,
  ...box,
  rotation,
})

function project(items: Item[], extra: Record<string, unknown> = {}) {
  return {
    metadata: { fps: 30, width: 1080, height: 1920 },
    format: { id: 'greenscreen' },
    timeline: { tracks, items, transitions: [] as unknown[], ...extra },
  }
}

function check(
  id: string,
  items: Item[],
  layouts: KitLayoutEntry[],
  options: {
    kit?: Kit
    extra?: Record<string, unknown>
    mediaById?: Record<string, { category?: string; mimeType?: string }>
  } = {},
) {
  const card = scoreKit(project(items, options.extra), options.kit ?? v3(), {
    layouts: new Map(layouts.map((l) => [l.id, l])),
    mediaById: options.mediaById,
  })
  const found = card.checks.find((c) => c.id === id)
  assert.ok(found, `no check ${id}`)
  return found
}

const TITLE_BOX = { x: 110, y: 320, width: 800, height: 240 }

test('title.on-screen: from frame 0 for 2.5 s', () => {
  assert.equal(check('title.on-screen', [text('t', 'kit:title', 0, 90)], []).status, 'pass')
  const late = check('title.on-screen', [text('t', 'kit:title', 10, 90)], [])
  assert.equal(late.status, 'fail')
  assert.deepEqual(late.ranges, [{ startFrame: 0, endFrame: 75 }])
  const short = check(
    'title.on-screen',
    [text('t', 'kit:title', 0, 40), text('u', 'kit:caption', 50, 10)],
    [],
  )
  assert.equal(short.status, 'fail')
  assert.match(short.detail, /1\.33 s from frame 0; needs 2\.5 s/)
})

test('title.top-half (inZone) and caption.above-ui (bottomAbove) use the rendered boxes', () => {
  const title = text('t', 'kit:title', 0, 90)
  assert.equal(check('title.top-half', [title], [textLayout('t', TITLE_BOX)]).status, 'pass')
  const low = check('title.top-half', [title], [textLayout('t', { ...TITLE_BOX, y: 1100 })])
  assert.equal(low.status, 'fail')
  assert.match(low.detail, /box y 1100-1340, outside 250-960/)
  assert.deepEqual(low.ranges, [{ startFrame: 0, endFrame: 90 }])
  const caption = text('c', 'kit:caption', 10, 20)
  assert.equal(
    check(
      'caption.above-ui',
      [caption],
      [textLayout('c', { x: 200, y: 720, width: 600, height: 90 })],
    ).status,
    'pass',
  )
  const under = check(
    'caption.above-ui',
    [caption],
    [textLayout('c', { x: 200, y: 1400, width: 600, height: 90 })],
  )
  assert.equal(under.status, 'fail')
  assert.match(under.detail, /bottom at y 1490, below 1460/)
  assert.equal(check('caption.above-ui', [caption], []).status, 'na')
})

test('a caption without a background box: lines plus the outline', () => {
  const caption = text('c', 'kit:caption', 0, 20, { stroke: { width: 10, color: '#000' } })
  const entry = textLayout('c', { x: 200, y: 1380, width: 600, height: 70 }, 1, 'plain')
  // 1380 + 70 + 10 outline = 1460: just above the UI.
  assert.equal(check('caption.above-ui', [caption], [entry]).status, 'pass')
  entry.textLayout!.lines[0]!.y = 1381
  assert.equal(check('caption.above-ui', [caption], [entry]).status, 'fail')
})

test('title.max-lines counts rendered lines and points at the small size', () => {
  const title = text('t', 'kit:title', 0, 90)
  assert.equal(check('title.max-lines', [title], [textLayout('t', TITLE_BOX, 3)]).status, 'pass')
  const four = check('title.max-lines', [title], [textLayout('t', TITLE_BOX, 4)])
  assert.equal(four.status, 'fail')
  assert.match(four.detail, /wraps to 4 lines \(the kit: use 72px before adding a line\)/)
})

test('title.one-per-video counts titles, a title split by a cut once', () => {
  const split = [text('a', 'kit:title', 0, 40), { ...text('b', 'kit:title', 40, 50), text: 'a' }]
  assert.equal(check('title.one-per-video', split, []).status, 'pass')
  const two = check(
    'title.one-per-video',
    [text('a', 'kit:title', 0, 90), text('b', 'kit:title', 200, 90)],
    [],
  )
  assert.equal(two.status, 'fail')
  assert.deepEqual(two.ranges, [{ startFrame: 200, endFrame: 290 }])
})

test('clearOf: safe zones', () => {
  const title = text('t', 'kit:title', 0, 90)
  assert.equal(
    check(
      'title.clear-rail',
      [title],
      [textLayout('t', { x: 70, y: 320, width: 860, height: 120 })],
    ).status,
    'pass',
  )
  const wide = check(
    'title.clear-rail',
    [title],
    [textLayout('t', { x: 70, y: 320, width: 940, height: 120 })],
  )
  assert.equal(wide.status, 'fail')
  assert.match(wide.detail, /overlaps rightRail/)
})

test('clearOf a timed element counts only frames where both are on screen', () => {
  const title = text('t', 'kit:title', 0, 90)
  const during = picture('i1', 'images', 45, 45)
  const after = picture('i2', 'images', 120, 45)
  const above = { x: 40, y: 250, width: 1000, height: 440 }
  const layouts = [
    textLayout('t', TITLE_BOX),
    pictureLayout('i1', above),
    pictureLayout('i2', above),
  ]
  const result = check('image.clear-title', [title, during, after], layouts)
  assert.equal(result.status, 'fail')
  assert.deepEqual(result.ranges, [{ startFrame: 45, endFrame: 90 }])
  assert.match(result.detail, /"i1" overlaps title "t" at frames 45-90/)
  // Below the title's bottom edge while it is up: clear.
  const below = [
    textLayout('t', TITLE_BOX),
    pictureLayout('i1', { ...above, y: 570, height: 300 }),
    pictureLayout('i2', above),
  ]
  assert.equal(check('image.clear-title', [title, during, after], below).status, 'pass')
})

test('clearOf with look regions, the plate key content and a speaker subject', () => {
  const caption = text('c', 'kit:caption', 0, 30)
  const plate = picture('p', 'plates', 0, 60)
  const inKey = textLayout('c', { x: 200, y: 400, width: 600, height: 90 })
  const clearOfKey = check('caption.clear-title-images', [caption], [inKey])
  assert.equal(clearOfKey.status, 'pass', 'no plate on screen, so no key content')
  const onPlate = check('caption.clear-title-images', [caption, plate], [inKey])
  assert.equal(onPlate.status, 'fail')
  assert.deepEqual(onPlate.ranges, [{ startFrame: 0, endFrame: 30 }])
  assert.equal(check('greenscreen.plate-clear', [caption], [inKey]).status, 'na')
  const speaker = picture('s', 'speaker', 0, 60)
  const plateClear = check('greenscreen.plate-clear', [plate, speaker], [])
  assert.equal(plateClear.status, 'look')
  const objects = check(
    'object.clear',
    [picture('o', 'images', 0, 30, { formatRole: undefined })],
    [pictureLayout('o', { x: 300, y: 300, width: 300, height: 300 })],
    { mediaById: { 'm-o': { category: 'overlay', mimeType: 'image/png' } } },
  )
  assert.equal(objects.status, 'look', 'clear of the safe zones; the speaker needs a look')
  assert.match(objects.detail, /clear of topUi, rightRail, bottomUi; look: clear of the speaker/)
})

test('overlay.middle (nearY, judgment look) reports how far from y', () => {
  const overlay = text('o', 'kit:overlay', 0, 30)
  const result = check(
    'overlay.middle',
    [overlay],
    [textLayout('o', { x: 70, y: 900, width: 860, height: 200 })],
  )
  assert.equal(result.status, 'look')
  assert.match(result.detail, /centres up to 40 px from y=960/)
  const kit = v3()
  delete (kit.overlays.must![0]!.check as { judgment?: string }).judgment
  assert.equal(
    check(
      'overlay.middle',
      [overlay],
      [textLayout('o', { x: 70, y: 900, width: 860, height: 200 })],
      { kit },
    ).status,
    'pass',
  )
  assert.equal(
    check(
      'overlay.middle',
      [overlay],
      [textLayout('o', { x: 70, y: 1300, width: 860, height: 200 })],
      { kit },
    ).status,
    'warn',
  )
})

test('greenscreen: plates fill the canvas, hard cuts only', () => {
  const plates = [picture('p1', 'plates', 0, 30), picture('p2', 'plates', 30, 30)]
  const full = [
    pictureLayout('p1', { x: 0, y: 0, width: 1080, height: 1920 }),
    pictureLayout('p2', { x: -50, y: 0, width: 1180, height: 1920 }),
  ]
  assert.equal(check('greenscreen.fills-frame', plates, full).status, 'pass')
  const boxed = check('greenscreen.fills-frame', plates, [
    full[0]!,
    pictureLayout('p2', { x: 0, y: 200, width: 1080, height: 1520 }),
  ])
  assert.equal(boxed.status, 'fail')
  assert.deepEqual(boxed.ranges, [{ startFrame: 30, endFrame: 60 }])
  assert.equal(
    check('greenscreen.fills-frame', plates, [full[0]!, pictureLayout('p2', full[1]!, 5)]).status,
    'fail',
  )
  assert.equal(check('greenscreen.hard-cuts', plates, []).status, 'pass')
  const faded = check('greenscreen.hard-cuts', plates, [], {
    extra: {
      transitions: [{ id: 'x', leftClipId: 'p1', rightClipId: 'p2', durationInFrames: 10 }],
    },
  })
  assert.equal(faded.status, 'fail')
  assert.deepEqual(faded.ranges, [{ startFrame: 20, endFrame: 40 }])
})

test('images: one placement per video; the face check skips "over" and "full"', () => {
  const above = { x: 40, y: 250, width: 1000, height: 440 }
  const over = { x: 40, y: 250, width: 1000, height: 900 }
  const items = [picture('a', 'images', 0, 30), picture('b', 'images', 40, 30)]
  assert.equal(
    check('image.one-placement', items, [pictureLayout('a', above), pictureLayout('b', above)])
      .status,
    'pass',
  )
  const mixed = check('image.one-placement', items, [
    pictureLayout('a', above),
    pictureLayout('b', over),
  ])
  assert.equal(mixed.status, 'fail')
  assert.match(mixed.detail, /1 "above", 1 "over"/)
  const face = check('image.face', items, [pictureLayout('a', above), pictureLayout('b', over)])
  assert.equal(face.status, 'look')
  assert.deepEqual(face.ranges, [{ startFrame: 0, endFrame: 30 }])
  assert.match(face.detail, /1 "over"\/"full" image\(s\) n\/a/)
  assert.equal(
    check('image.face', items, [pictureLayout('a', over), pictureLayout('b', over)]).status,
    'na',
  )
})

test('judgment checks are look or listen with frames, never pass; unknown types are n/a', () => {
  const items = [
    text('t', 'kit:title', 0, 90),
    text('c', 'kit:caption', 10, 20, { captionSource: { type: 'transcript' } }),
  ]
  assert.equal(check('title.no-face', items, []).status, 'look')
  const words = check('caption.transcript', items, [])
  assert.equal(words.status, 'listen')
  assert.deepEqual(words.ranges, [{ startFrame: 10, endFrame: 30 }])
  assert.match(words.detail, /1 of 1 made from the transcript/)
  assert.equal(check('overlay.reads-muted', items, []).status, 'na')
  assert.equal(check('object.locked-prompt', items, []).status, 'na')
  const kit = v3()
  kit.titles.must!.push({
    id: 'title.sparkle',
    text: 'Sparkles',
    check: { type: 'sparkles' },
  } as KitRule)
  const unknown = check('title.sparkle', items, [], { kit })
  assert.equal(unknown.status, 'na')
  assert.match(unknown.detail, /unknown check type "sparkles"/)
})

test('objects must be PNG; a project of another aspect skips positions', () => {
  const object = picture('o', 'images', 0, 30, { formatRole: undefined })
  const png = check('object.transparent', [object], [], {
    mediaById: { 'm-o': { category: 'overlay', mimeType: 'image/png' } },
  })
  assert.equal(png.status, 'look')
  const jpeg = check('object.transparent', [object], [], {
    mediaById: { 'm-o': { category: 'overlay', mimeType: 'image/jpeg' } },
  })
  assert.equal(jpeg.status, 'fail')
  const wide = scoreKit(
    {
      ...project([text('t', 'kit:title', 0, 90)]),
      metadata: { fps: 30, width: 1920, height: 1080 },
    },
    v3(),
    {
      layouts: new Map([['t', textLayout('t', { ...TITLE_BOX, y: 1100 })]]),
    },
  )
  assert.equal(wide.checks.find((c) => c.id === 'title.top-half')!.status, 'na')
  assert.ok(wide.summary.na > 0)
})

test('the items whose layout the checks need', () => {
  const items = [
    text('t', 'kit:title', 0, 90),
    text('e', 'kit:emphasis', 0, 30),
    picture('i', 'images', 0, 30),
  ]
  assert.deepEqual(
    kitLayoutItems(project(items))
      .map((i) => i.id)
      .sort(),
    ['i', 't'],
  )
})

test('kit preferences replace the format pause target in the scorecard', () => {
  const p = {
    metadata: { fps: 30, width: 1080, height: 1920 },
    format: { id: 'graphic-yap' },
    timeline: {
      tracks: createFormatTracks('graphic-yap'),
      items: [
        {
          id: 'v',
          type: 'video',
          trackId: 'track-speaker',
          from: 0,
          durationInFrames: 90,
          label: 'v',
          mediaId: 'm',
          sourceStart: 0,
          sourceEnd: 90,
          sourceFps: 30,
        },
      ],
    },
  }
  const transcripts = {
    m: {
      words: [
        { text: 'a', start: 0, end: 1 },
        { text: 'b', start: 1.5, end: 3 },
      ],
    },
  }
  const mediaById = { m: { category: 'speaker', audioCodec: 'aac' } }
  const plain = scoreProject(p, { transcripts, mediaById }).checks.find(
    (c) => c.key === 'pauseMaxSec',
  )!
  const kit = v3()
  const withKit = scoreProject(p, {
    transcripts,
    mediaById,
    targetOverrides: kitTargetOverrides(kit),
  }).checks.find((c) => c.key === 'pauseMaxSec')!
  assert.notEqual(plain.target, withKit.target)
  assert.equal(withKit.target, '<= 0.3 s')
  assert.equal(withKit.status, 'warn')
  assert.match(withKit.detail, /Video Style Kit tightCuts on: 300 ms/)
  kit.preferences!.tightCuts!.on = false
  const off = scoreProject(p, {
    transcripts,
    mediaById,
    targetOverrides: kitTargetOverrides(kit),
  }).checks.find((c) => c.key === 'pauseMaxSec')!
  assert.equal(off.target, '<= 0.8 s')
  assert.equal(off.status, 'pass')
})
