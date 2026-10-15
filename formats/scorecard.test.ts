import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { createFormatTracks } from './registry.mjs'
import { mapClipWords, resolveItemRoles, scoreProject } from './scorecard.mjs'
import type { Scorecard, ScorecardCheck } from './scorecard.mjs'

interface Item {
  id: string
  type: string
  trackId: string
  from: number
  durationInFrames: number
  label: string
  [field: string]: unknown
}
type Extra = { id?: string; label?: string; [field: string]: unknown }
type Track = {
  id: string
  name: string
  order: number
  kind?: string
  formatRole?: string
  muted?: boolean
}
interface Word {
  text: string
  start: number
  end: number
}

const FPS = 30
const f = (sec: number) => Math.round(sec * FPS)
let serial = 0

function makeProject(
  formatId: string,
  variant: string | null,
  items: Item[],
  { transitions = [], tracks }: { transitions?: object[]; tracks?: Track[] } = {},
) {
  return {
    id: 'p',
    name: 'p',
    metadata: { width: 1080, height: 1920, fps: FPS },
    format: { id: formatId, ...(variant ? { variant } : {}) },
    timeline: { tracks: tracks ?? createFormatTracks(formatId), items, transitions },
  }
}

/** An item from frame `from` for `frames` frames. */
const at = (
  type: string,
  trackId: string,
  from: number,
  frames: number,
  extra: Extra = {},
): Item => ({
  id: extra.id ?? `${type}-${++serial}`,
  type,
  trackId,
  from,
  durationInFrames: frames,
  label: extra.label ?? type,
  ...extra,
})
const clip = (type: string, trackId: string, fromSec: number, durSec: number, extra?: Extra) =>
  at(type, trackId, f(fromSec), f(durSec), extra)
const text = (trackId: string, fromSec: number, durSec: number, value: string, extra: Extra = {}) =>
  clip('text', trackId, fromSec, durSec, {
    text: value,
    color: '#fff',
    transform: { y: -500 },
    ...extra,
  })

/** A synced talking-head (or b-roll) clip: video plus its linked audio. */
function synced(
  videoTrack: string,
  audioTrack: string,
  fromSec: number,
  durSec: number,
  mediaId: string,
  sourceStartSec = 0,
): [Item, Item] {
  const group = `g-${++serial}`
  const window = {
    sourceStart: f(sourceStartSec),
    sourceEnd: f(sourceStartSec + durSec),
    sourceFps: FPS,
  }
  return [
    clip('video', videoTrack, fromSec, durSec, { mediaId, linkedGroupId: group, ...window }),
    clip('audio', audioTrack, fromSec, durSec, { mediaId, linkedGroupId: group, ...window }),
  ]
}

/** Words every `step` seconds from `from` to `to`, `length` seconds long. */
function words(
  from: number,
  to: number,
  step: number,
  length = step * 0.8,
  skip: (t: number) => boolean = () => false,
): Word[] {
  const list: Word[] = []
  for (let t = from; t + length <= to + 1e-9; t += step) {
    if (!skip(t))
      list.push({ text: 'word', start: Number(t.toFixed(3)), end: Number((t + length).toFixed(3)) })
  }
  return list
}
const envelope = (list: Word[]) => ({
  data: { segments: [{ start: 0, end: 999, text: '', words: list }] },
})

const check = (card: Scorecard, key: string): ScorecardCheck => {
  const found = card.checks.find((c) => c.key === key)
  assert.ok(found, `check ${key} exists`)
  return found
}
const failing = (card: Scorecard) =>
  card.checks.filter((c) => c.status === 'fail').map((c) => c.key)
const warning = (card: Scorecard) =>
  card.checks.filter((c) => c.status === 'warn').map((c) => c.key)
const nth = <T>(list: T[], index = 0): T => {
  assert.ok(list.length > index, `has item ${index}`)
  return list[index] as T
}
const num = (found: ScorecardCheck): number => {
  assert.equal(typeof found.value, 'number', `${found.key} is measured`)
  return found.value as number
}

// ---------------------------------------------------------------------------
// Graphic Yap
// ---------------------------------------------------------------------------

const speakerMedia = { spk: { category: 'speaker', audioCodec: 'aac', fps: 30 } }

/** Three images two seconds apart, then a five second rest, repeating. */
function graphicYapImages(firstStart = 1, until = 60) {
  const items = []
  for (let base = firstStart; base < until; base += 9) {
    for (const offset of [0, 2, 4]) {
      const start = base + offset
      if (start < until)
        items.push(clip('image', 'track-images', start, Math.min(1.8, until - start)))
    }
  }
  return items
}

test('graphic yap: a timeline that meets every rule and target passes', () => {
  const items = [
    text('track-title', 0, 3, 'Five things nobody tells you'),
    ...synced('track-speaker', 'track-speaker-audio', 0, 60, 'spk'),
    ...graphicYapImages(),
  ]
  const card = scoreProject(makeProject('graphic-yap', null, items), {
    mediaById: speakerMedia,
    transcripts: { spk: envelope(words(0.1, 59.9, 0.3, 0.25)) },
  })
  assert.equal(card.format, 'graphic-yap')
  assert.equal(card.variant, 'standard')
  assert.equal(card.durationSec, 60)
  assert.deepEqual(failing(card), [])
  assert.deepEqual(warning(card), [])
  assert.equal(check(card, 'imagesPerMin').value, 21)
  assert.equal(check(card, 'imageGapSec').value, 2)
  assert.equal(check(card, 'longestNoNewImageSec').value, 5)
  assert.equal(check(card, 'firstImageSec').value, 1)
  assert.ok(num(check(card, 'speechWpm')) > 160)
  assert.equal(check(card, 'titleHook').status, 'pass')
  assert.equal(check(card, 'captions').status, 'info', 'captions follow the style kit')
  assert.deepEqual(card.summary, {
    pass: card.checks.filter((c) => c.status === 'pass').length,
    warn: 0,
    fail: 0,
  })
})

test('graphic yap: a transition fails; late first image, an image gap and a pause warn, with frame ranges', () => {
  const images = graphicYapImages(3).filter((item) => item.from < f(20) || item.from >= f(28))
  const speaker = synced('track-speaker', 'track-speaker-audio', 0, 60, 'spk')
  const items = [text('track-title', 0, 3, 'Hook'), ...speaker, ...images]
  const transitions = [
    {
      id: 'x',
      type: 'crossfade',
      leftClipId: nth(images).id,
      rightClipId: nth(images, 1).id,
      trackId: 'track-images',
      durationInFrames: 10,
    },
  ]
  const spoken = words(0.1, 59.9, 0.3, 0.25, (t) => t > 19.9 && t < 22)
  const card = scoreProject(makeProject('graphic-yap', null, items, { transitions }), {
    mediaById: speakerMedia,
    transcripts: { spk: envelope(spoken) },
  })
  // Pacing numbers are guidelines: they warn. A transition breaks a format rule.
  assert.deepEqual(failing(card), ['transitions'])
  for (const key of ['firstImageSec', 'longestNoNewImageSec', 'pauseMaxSec'])
    assert.ok(warning(card).includes(key), key)

  const first = check(card, 'firstImageSec')
  assert.equal(first.value, 3)
  assert.deepEqual(first.ranges, [{ startFrame: 0, endFrame: f(3) }])

  const gap = check(card, 'longestNoNewImageSec')
  assert.ok(num(gap) > 5)
  assert.ok(
    gap.ranges.some((r) => r.startFrame <= f(16) && r.endFrame >= f(28)),
    JSON.stringify(gap.ranges),
  )

  const pause = check(card, 'pauseMaxSec')
  assert.ok(num(pause) > 1.9 && num(pause) < 2.3, String(pause.value))
  assert.equal(pause.ranges.length, 1)
  const where = nth(pause.ranges)
  assert.ok(where.startFrame >= f(19.8) && where.startFrame <= f(20), JSON.stringify(where))
  assert.ok(where.endFrame >= f(21.9) && where.endFrame <= f(22.4), JSON.stringify(where))

  assert.deepEqual(check(card, 'transitions').ranges, [
    { startFrame: nth(images, 1).from - 5, endFrame: nth(images, 1).from + 5 },
  ])
  assert.equal(card.summary.fail, 1)
})

test('graphic yap intense: the same edit misses the denser targets', () => {
  const items = [
    text('track-title', 0, 3, 'Hook'),
    ...synced('track-speaker', 'track-speaker-audio', 0, 60, 'spk'),
    ...graphicYapImages(),
  ]
  const card = scoreProject(makeProject('graphic-yap', 'intense', items), {
    mediaById: speakerMedia,
  })
  assert.equal(card.variant, 'intense')
  assert.deepEqual(warning(card).sort(), ['imagesPerMin', 'visualChangesPerMin'])
  assert.equal(check(card, 'pauseMaxSec').status, 'na', 'no transcript: speech checks are na')
  assert.ok(check(card, 'imagesPerMin').ranges.length > 0, 'slow stretches are pointed at')
})

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

test('roles resolve: item formatRole, then media category, then track role, then type', () => {
  const tracks = [
    ...createFormatTracks('graphic-yap'),
    { id: 'v9', name: 'V9', kind: 'video', order: 10 },
    { id: 'custom', name: 'Backgrounds', kind: 'video', order: 11, formatRole: 'plates' },
  ]
  const items = [
    clip('video', 'track-speaker', 0, 5, { id: 'explicit', mediaId: 'spk', formatRole: 'images' }),
    clip('image', 'track-speaker', 5, 5, { id: 'category', mediaId: 'shot' }),
    clip('video', 'track-images', 0, 5, { id: 'track', mediaId: 'loose' }),
    clip('video', 'v9', 0, 5, { id: 'fallback', mediaId: 'loose' }),
    clip('image', 'v9', 5, 5, { id: 'fallback-image' }),
    clip('image', 'custom', 0, 5, { id: 'track-formatRole' }),
    text('track-images', 0, 3, 'not a picture', { id: 'text-on-images' }),
    text('v9', 10, 3, 'Title at zero?', { id: 'late-text' }),
    text('v9', 0, 3, 'A title', { id: 'title' }),
    text('v9', 0, 1, 'Too short', { id: 'short', transform: { y: -500 } }),
    text('v9', 3, 2, 'caption', { id: 'caption', textRole: 'caption' }),
    clip('audio', 'track-music', 0, 5, { id: 'linked-broll', mediaId: 'shot' }),
    clip('audio', 'track-music', 5, 5, { id: 'music', mediaId: 'loose' }),
  ]
  const project = makeProject('graphic-yap', null, items, { tracks })
  const mediaById = { spk: { category: 'speaker' }, shot: { category: 'b-roll' }, loose: {} }
  const roles = resolveItemRoles(project, { mediaById })
  const role = (id: string) => [roles.get(id)?.role, roles.get(id)?.source]
  assert.deepEqual(role('explicit'), ['images', 'formatRole'])
  assert.deepEqual(role('category'), ['images', 'category'])
  assert.deepEqual(role('track'), ['images', 'track'])
  assert.deepEqual(role('fallback'), ['speaker', 'heuristic'])
  assert.deepEqual(role('fallback-image'), ['images', 'heuristic'])
  assert.deepEqual(role('track-formatRole'), ['plates', 'track'])
  assert.deepEqual(
    role('text-on-images'),
    ['title', 'heuristic'],
    'a picture track role never makes text a picture',
  )
  assert.deepEqual(role('late-text'), ['labels', 'heuristic'])
  assert.deepEqual(role('title'), ['title', 'heuristic'])
  assert.deepEqual(role('short'), ['labels', 'heuristic'])
  assert.deepEqual(role('caption'), ['captions', 'textRole'])
  assert.deepEqual(role('linked-broll'), ['images', 'category'], 'sync sound of b-roll media')
  assert.deepEqual(role('music'), ['music', 'track'])
  // Same project scored as a greenscreen: categories map to that format's roles.
  const gs = resolveItemRoles(project, { mediaById, format: 'greenscreen' })
  assert.equal(gs.get('category')?.role, 'plates')
})

// ---------------------------------------------------------------------------
// Transcript mapping and pauses
// ---------------------------------------------------------------------------

test('transcript words map through the clip source window and speed', () => {
  const transcript = envelope([
    { text: 'before', start: 4, end: 4.5 },
    { text: 'six', start: 6, end: 6.5 },
    { text: 'edge', start: 14.8, end: 15.4 },
    { text: 'after', start: 16, end: 16.5 },
  ])
  const item = {
    from: f(10),
    durationInFrames: f(10),
    sourceStart: f(5),
    sourceEnd: f(15),
    sourceFps: 30,
  }
  const mapped = mapClipWords(item, transcript, { fps: FPS })
  assert.deepEqual(
    mapped.map((w) => [w.text, w.start, Number(w.end.toFixed(3))]),
    [
      ['six', 11, 11.5],
      ['edge', 19.8, 20],
    ],
  )
  const fast = mapClipWords({ ...item, durationInFrames: f(5), speed: 2 }, transcript, { fps: FPS })
  assert.deepEqual(fast[0], { text: 'six', start: 10.5, end: 10.75 })
  // Segment-only transcripts (no word timings) map whole segments.
  const coarse = mapClipWords(item, { segments: [{ text: 'seg', start: 6, end: 8 }] }, { fps: FPS })
  assert.deepEqual(
    coarse.map((w) => [w.start, w.end]),
    [[11, 13]],
  )
})

test('a cut that removes a silence leaves no pause; a gap between clips is one', () => {
  // Source has speech 0-5 s and 8-13 s, silence 5-8 s.
  const transcript = envelope([...words(0.1, 5, 0.3, 0.25), ...words(8, 13, 0.3, 0.25)])
  const media = { spk: { category: 'speaker', fps: 30 } }
  const tight = [
    text('track-title', 0, 3, 'Hook'),
    ...synced('track-speaker', 'track-speaker-audio', 0, 5, 'spk', 0),
    ...synced('track-speaker', 'track-speaker-audio', 5, 5, 'spk', 8),
  ]
  const tightCard = scoreProject(makeProject('greenscreen', null, tight), {
    mediaById: media,
    transcripts: { spk: transcript },
  })
  assert.equal(check(tightCard, 'pauseMaxSec').status, 'pass')
  assert.ok(num(check(tightCard, 'pauseMaxSec')) < 0.5)

  const loose = [
    text('track-title', 0, 3, 'Hook'),
    ...synced('track-speaker', 'track-speaker-audio', 0, 8, 'spk', 0),
    ...synced('track-speaker', 'track-speaker-audio', 8, 5, 'spk', 8),
  ]
  const looseCard = scoreProject(makeProject('greenscreen', null, loose), {
    mediaById: media,
    transcripts: { spk: transcript },
  })
  const pause = check(looseCard, 'pauseMaxSec')
  assert.equal(pause.status, 'warn')
  assert.ok(num(pause) > 2.9 && num(pause) < 3.2)
  const gap = nth(pause.ranges)
  assert.ok(gap.startFrame > f(4.8) && gap.endFrame === f(8))
})

test('a muted track or silent clip does not count as speech', () => {
  const items = [
    text('track-title', 0, 3, 'Hook'),
    ...synced('track-speaker', 'track-speaker-audio', 0, 10, 'spk'),
  ]
  nth(items, 2).volume = -60
  const card = scoreProject(makeProject('greenscreen', null, items), { mediaById: speakerMedia })
  assert.equal(check(card, 'speech').status, 'fail')
  const tracks = createFormatTracks('greenscreen').map((t) =>
    t.id === 'track-speaker-audio' ? { ...t, muted: true } : t,
  )
  nth(items, 2).volume = 0
  assert.equal(
    check(
      scoreProject(makeProject('greenscreen', null, items, { tracks }), {
        mediaById: speakerMedia,
      }),
      'speech',
    ).status,
    'fail',
  )
})

// ---------------------------------------------------------------------------
// Greenscreen
// ---------------------------------------------------------------------------

/** 8 plates of 2.8 s and 6 of 113 frames: 45 s, 13 changes, median gap 2.8 s. */
function greenscreenPlates() {
  const lengths = [84, 84, 113, 84, 113, 84, 113, 84, 113, 84, 113, 84, 113, 84]
  let from = 0
  return lengths.map((frames) => {
    const item = at('image', 'track-plates', from, frames, { mediaId: 'plate' })
    from += frames
    return item
  })
}

test('greenscreen: plates changing on the beat with sync voice pass', () => {
  const items = [
    at('text', 'track-title', 0, 84, {
      text: 'Look at these DMs',
      color: '#fff',
      transform: { y: -600 },
    }),
    clip('text', 'track-captions', 3, 3, { text: 'look at', color: '#fff', textRole: 'caption' }),
    ...synced('track-speaker', 'track-speaker-audio', 0, 45, 'spk'),
    ...greenscreenPlates(),
  ]
  const card = scoreProject(makeProject('greenscreen', null, items), {
    mediaById: { ...speakerMedia, plate: { category: 'graphics' } },
    transcripts: { spk: envelope(words(0.05, 44.9, 60 / 225, 0.2)) },
  })
  assert.deepEqual(failing(card), [])
  assert.deepEqual(warning(card), [])
  assert.equal(check(card, 'plateCoveragePct').value, 100)
  assert.equal(check(card, 'firstPlateChangeSec').value, 2.8)
  assert.equal(check(card, 'visualChangesPerMin').value, 17.33)
  assert.equal(check(card, 'medianChangeGapSec').value, 2.8)
  assert.equal(check(card, 'longestNoChangeSec').status, 'info')
})

test('greenscreen: held hook plate, music and an extra label fail or warn', () => {
  const plates = [at('image', 'track-plates', 0, f(5)), at('image', 'track-plates', f(5), f(15))]
  const items = [
    text('track-title', 0, 5, 'Hook'),
    clip('text', 'track-title', 8, 2, { text: 'Extra', color: '#fff', formatRole: 'labels' }),
    ...synced('track-speaker', 'track-speaker-audio', 0, 20, 'spk'),
    ...plates,
    clip('audio', 'a2', 0, 20, { id: 'bed', mediaId: 'song' }),
  ]
  const tracks = [
    ...createFormatTracks('greenscreen'),
    { id: 'a2', name: 'A2', kind: 'audio', order: 9 },
  ]
  const card = scoreProject(makeProject('greenscreen', null, items, { tracks }), {
    mediaById: { ...speakerMedia, song: { category: 'music' } },
  })
  assert.ok(warning(card).includes('firstPlateChangeSec'))
  assert.ok(failing(card).includes('music'))
  assert.deepEqual(check(card, 'music').ranges, [{ startFrame: 0, endFrame: f(20) }])
  assert.equal(check(card, 'titleHold').status, 'warn')
  assert.equal(check(card, 'labelCount').status, 'warn')
  assert.equal(check(card, 'captions').status, 'warn', 'captions are a default, not a rule')
})

// ---------------------------------------------------------------------------
// Vlog
// ---------------------------------------------------------------------------

function vlogShots() {
  const shots = []
  let from = 0
  for (let i = 0; i < 47; i++) {
    const frames = i === 20 ? 90 : 27
    shots.push(at('video', 'track-b-roll', from, frames, { mediaId: 'broll' }))
    from += frames
  }
  return { shots, end: from }
}

test('vlog fast: VO wall to wall over quick b-roll passes', () => {
  const { shots, end } = vlogShots()
  const items = [
    at('text', 'track-title', 0, 120, {
      text: 'I built a sauna for $400',
      color: '#fff',
      transform: { y: -400 },
    }),
    at('text', 'track-captions', 0, end, { text: 'captions', color: '#fff', textRole: 'caption' }),
    ...shots,
    at('audio', 'track-voiceover', 0, end, {
      mediaId: 'vo',
      sourceStart: 0,
      sourceEnd: end,
      sourceFps: 30,
    }),
    at('audio', 'track-music', 0, end, { mediaId: 'song', volume: -18 }),
  ]
  const card = scoreProject(makeProject('vlog', 'fast', items), {
    mediaById: {
      vo: { category: 'voiceover' },
      song: { category: 'music' },
      broll: { category: 'b-roll' },
    },
    transcripts: { vo: envelope(words(0.1, end / FPS, 0.3, 0.25)) },
  })
  assert.deepEqual(failing(card), [])
  assert.deepEqual(warning(card), [])
  assert.equal(check(card, 'shotCount').value, 47)
  assert.equal(check(card, 'longestShotSec').value, 3)
  assert.equal(check(card, 'medianShotSec').status, 'info')
  assert.equal(check(card, 'firstCutSec').value, 0.9)
})

test('vlog: no title, no captions, a VO gap and slow-pace cutting fail or warn', () => {
  const { shots, end } = vlogShots()
  const items = [
    ...shots,
    at('audio', 'track-voiceover', 0, f(20), {
      mediaId: 'vo',
      sourceStart: 0,
      sourceEnd: f(20),
      sourceFps: 30,
    }),
    at('audio', 'track-voiceover', f(22), end - f(22), {
      mediaId: 'vo',
      sourceStart: f(22),
      sourceEnd: end,
      sourceFps: 30,
    }),
  ]
  const card = scoreProject(makeProject('vlog', 'slow', items), {
    mediaById: { vo: { category: 'voiceover' } },
    transcripts: { vo: envelope(words(0.1, end / FPS, 0.3, 0.25)) },
  })
  assert.deepEqual(failing(card).sort(), ['captions', 'titleHook'])
  assert.ok(warning(card).includes('pauseMaxSec'))
  assert.deepEqual(check(card, 'titleHook').ranges, [{ startFrame: 0, endFrame: f(3) }])
  assert.ok(warning(card).includes('cutsPerMin'), 'too fast for the slow pace')
  assert.ok(warning(card).includes('voCoveragePct'))
  assert.equal(check(card, 'music').status, 'warn', 'music is the default under VO')
})

// ---------------------------------------------------------------------------
// 10 Shot
// ---------------------------------------------------------------------------

function tenShots(count: number, seconds: number) {
  return Array.from({ length: count }, (_, i) =>
    clip('video', 'track-shots', i * seconds, seconds, { mediaId: `shot${i}` }),
  )
}

test('10 shot: a music montage with a title passes the rules (the guide cut rate conflicts)', () => {
  const items = [
    text('track-title', 0, 3, 'how it felt waking up today', { transform: { y: 0 } }),
    ...tenShots(14, 1),
    clip('audio', 'track-music', 0, 14, { mediaId: 'song' }),
  ]
  const card = scoreProject(makeProject('ten-shot', 'even', items), {
    mediaById: { song: { category: 'music' } },
  })
  assert.deepEqual(failing(card), [])
  assert.equal(check(card, 'shotCount').status, 'pass')
  assert.equal(check(card, 'titleWords').value, 6)
  // 13 cuts in 14 s is 55.7 a minute: a faster 10 Shot. Pace is the edit's call,
  // so cuts per minute is reported, not scored.
  assert.deepEqual(warning(card), [])
  assert.equal(check(card, 'cutsPerMin').status, 'info')
})

test('10 shot: talking, captions, sync sound and too few shots fail', () => {
  const shots = tenShots(7, 2)
  const linked = shots.map((shot) => ({
    ...shot,
    id: `${shot.id}-a`,
    type: 'audio',
    trackId: 'track-music',
  }))
  const items = [
    text('track-title', 0, 2, 'Hook'),
    ...shots,
    ...linked,
    clip('text', 'track-labels', 3, 2, { text: 'hi', color: '#fff', textRole: 'caption' }),
    clip('audio', 'a-voice', 0, 14, { mediaId: 'spk' }),
  ]
  const tracks = [
    ...createFormatTracks('ten-shot'),
    { id: 'a-voice', name: 'A2', kind: 'audio', order: 9 },
  ]
  const mediaById = {
    spk: { category: 'speaker' },
    ...Object.fromEntries(shots.map((s) => [s.mediaId, { category: 'b-roll' }])),
  }
  const card = scoreProject(makeProject('ten-shot', null, items, { tracks }), { mediaById })
  assert.deepEqual(failing(card).sort(), ['captions', 'music', 'speech', 'syncSound'])
  assert.ok(warning(card).includes('shotCountMin'))
  assert.equal(check(card, 'syncSound').ranges.length, 7)
  assert.equal(check(card, 'titleHold').status, 'pass')
})

test('the format option overrides the project format; a project without one throws', () => {
  const items = tenShots(3, 1)
  const card = scoreProject(makeProject('ten-shot', null, items), {
    format: 'vlog',
    variant: 'fast',
  })
  assert.equal(card.format, 'vlog')
  assert.equal(card.variant, 'fast')
  assert.throws(() => scoreProject({ timeline: { tracks: [], items: [] } }), /no format/)
  const empty = scoreProject(makeProject('vlog', null, []))
  assert.equal(empty.durationSec, 0)
  assert.equal(check(empty, 'lengthSec').status, 'na')
  assert.equal(check(empty, 'titleHook').status, 'fail')
})

test('speed ramps warn, naming the clips and frames, unless the project allows them', () => {
  const items = [
    text('track-title', 0, 3, 'how it felt waking up today', { transform: { y: 0 } }),
    ...tenShots(14, 1),
    clip('audio', 'track-music', 0, 14, { mediaId: 'song' }),
  ]
  const ramped = items.map((item, index) =>
    index === 3
      ? {
          ...item,
          label: 'Hero shot',
          speedRamp: [
            { frame: 0, speed: 2 },
            { frame: 10, speed: 0.3 },
            { frame: 20, speed: 2 },
          ],
        }
      : item,
  )
  const media = { mediaById: { song: { category: 'music' } } }
  const plain = scoreProject(makeProject('ten-shot', 'even', items), media)
  assert.equal(check(plain, 'speedRamps').status, 'pass')

  const project = makeProject('ten-shot', 'even', ramped)
  const card = scoreProject(project, media)
  const ramps = check(card, 'speedRamps')
  assert.equal(ramps.status, 'warn')
  assert.equal(ramps.value, 1)
  const hero = nth(ramped, 3)
  assert.match(
    ramps.detail,
    new RegExp(`Hero shot at ${hero.from}/${hero.from + 10}/${hero.from + 20}`),
  )
  assert.match(ramps.detail, /--allow speed-ramps/)
  assert.deepEqual(ramps.ranges, [
    { startFrame: hero.from, endFrame: hero.from + hero.durationInFrames },
  ])
  assert.deepEqual(failing(card), [])

  const allowed = scoreProject(
    { ...project, format: { ...project.format, options: { speedRamps: 'allowed' as const } } },
    media,
  )
  assert.equal(check(allowed, 'speedRamps').status, 'pass')
  assert.equal(check(allowed, 'speedRamps').target, 'allowed')
})

test('transcript words map through a speed ramp', () => {
  // 2x for the first 30 frames, then 1x: 60 source frames, then 30, in 60 frames.
  const item = at('video', 'v', 30, 60, {
    sourceStart: 0,
    sourceFps: 30,
    speedRamp: [
      { frame: 0, speed: 2, easing: 'hold' },
      { frame: 30, speed: 1 },
    ],
  })
  const mapped = mapClipWords(
    item,
    envelope([
      { text: 'fast', start: 1, end: 1.5 },
      { text: 'slow', start: 2.5, end: 2.9 },
      { text: 'gone', start: 3.2, end: 3.5 },
    ]),
    { fps: FPS },
  )
  assert.deepEqual(
    mapped.map((word) => [word.text, Number(word.start.toFixed(4)), Number(word.end.toFixed(4))]),
    [
      // Source 1 s at 2x is 0.5 s into the clip (clip starts at 1 s).
      ['fast', 1.5, 1.75],
      // Source 2.5 s: 2 s played in the first second, 0.5 s more at 1x.
      ['slow', 2.5, 2.9],
    ],
  )
})
