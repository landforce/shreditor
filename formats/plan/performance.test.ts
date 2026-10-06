import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { resolveFormat } from '../registry.mjs'
import { readPlan, type Plan, type PlanBeat, type PlanIssue } from './schema.mjs'
import type { PlanMedia } from './validate.mjs'
import { validatePerformance } from './performance/validate.mjs'
import { isFiller, isRetake, scaffoldPerformance } from './performance/scaffold.mjs'
import { performanceEstimates } from './performance/estimate.mjs'
import { buildPerformanceOps } from './performance/build.mjs'
import { comparePerformance } from './performance/compare.mjs'
import { performanceScript, toSourceList } from './performance/script.mjs'
import { findPhrase, similarity } from './performance/words.mjs'
import type { TranscriptWord } from './performance/words.mjs'

// Performance plans (the speaker formats): the scaffold from a transcript
// (sentence and pause splits, retakes, false starts), validation, the layout
// (jump cuts, pads, runs), estimates, the build batch (speaker clips with their
// audio, visuals at their words, to-source markers), the script and the edit
// compared with the plan. The story plans: ./plan.test.ts.

type Raw = Record<string, any> // plans as an agent writes them, valid or not
type Op = Record<string, any>

const YAP = resolveFormat('graphic-yap')
const GREEN = resolveFormat('greenscreen')
const VLOG = resolveFormat('vlog', 'fast')

/** [text, start, end] in source seconds. */
const w = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end })

// A 16 s take: the hook, a 1.5 s pause, a sentence said twice, "Um.", a
// restart ("So the so the freezer..."), 2.7 s of dead air, the close.
const WORDS: TranscriptWord[] = [
  w('Most', 0.5, 0.8),
  w('people', 0.8, 1.1),
  w('store', 1.1, 1.4),
  w('bread', 1.4, 1.8),
  w('wrong.', 1.8, 2.3),
  w('The', 3.8, 4.0),
  w('fridge', 4.0, 4.4),
  w('makes', 4.4, 4.7),
  w('it', 4.7, 4.9),
  w('stale', 4.9, 5.2),
  w('faster.', 5.2, 5.6),
  w('The', 5.8, 6.0),
  w('fridge', 6.0, 6.4),
  w('makes', 6.4, 6.7),
  w('bread', 6.7, 7.0),
  w('stale', 7.0, 7.3),
  w('faster.', 7.3, 7.6),
  w('Um.', 7.9, 8.2),
  w('So', 8.5, 8.7),
  w('the', 8.7, 8.9),
  w('so', 9.0, 9.2),
  w('the', 9.2, 9.4),
  w('freezer', 9.4, 9.9),
  w('is', 9.9, 10.1),
  w('your', 10.1, 10.3),
  w('friend.', 10.3, 10.8),
  w('Slice', 13.5, 13.9),
  w('it', 13.9, 14.0),
  w('first,', 14.0, 14.4),
  w('then', 14.4, 14.7),
  w('freeze', 14.7, 15.1),
  w('it.', 15.1, 15.5),
]

const MEDIA: Record<string, PlanMedia> = {
  talk: {
    mediaId: 'talk',
    fileName: 'talk.mov',
    kind: 'video',
    duration: 16,
    sourceFps: 30,
    audioCodec: 'aac',
    category: 'speaker',
  },
  loaf: {
    mediaId: 'loaf',
    fileName: 'loaf.png',
    kind: 'image',
    duration: 0,
    sourceFps: 30,
    audioCodec: null,
    category: 'graphics',
    width: 1080,
    height: 1080,
  },
  fridge: {
    mediaId: 'fridge',
    fileName: 'fridge.mp4',
    kind: 'video',
    duration: 5,
    sourceFps: 30,
    audioCodec: 'aac',
    category: 'b-roll',
  },
  hum: {
    mediaId: 'hum',
    fileName: 'hum.wav',
    kind: 'audio',
    duration: 10,
    sourceFps: 30,
    audioCodec: 'pcm',
    category: 'sfx',
  },
}
const resolveMedia = (source: PlanBeat['source']): PlanMedia | { error: string } =>
  MEDIA[source.mediaId ?? ''] ??
  (source.asset === '/stills/crumbs.png'
    ? { ...MEDIA.loaf!, mediaId: null, fileName: 'crumbs.png' }
    : { error: `${source.mediaId ?? source.asset} is not imported or in a catalog` })
const wordsFor = (mediaId: string) => (mediaId === 'talk' ? WORDS : null)

const scaffold = (format = YAP) =>
  scaffoldPerformance([{ mediaId: 'talk', duration: 16, words: WORDS }], {
    format,
    fps: 30,
    padFrames: 2,
    pauseSec: 1,
  })

/** The scaffold as the agent annotates it: the ask, the arc, images on two lines, one to source, a title. */
function annotated(): Raw {
  const plan = scaffold().plan
  plan.request = 'Cut my bread rant into a Graphic Yap'
  plan.story.arc = 'The claim, why the fridge is wrong, the freezer fix, how to do it.'
  const line = (id: string) => plan.performance.lines.find((l: Raw) => l.id === id)
  Object.assign(line('l01'), {
    visuals: [{ asset: 'loaf', at: 'bread', until: 'wrong' }],
    onScreen: { text: 'You store bread wrong', until: { line: 'l04' } },
  })
  line('l04').visuals = [{ asset: 'fridge' }]
  line('l07').visuals = [{ toSource: 'a freezer drawer of sliced loaves', at: 'freezer' }]
  return plan
}

function check(raw: unknown, format = YAP, extra: { briefTargetSec?: number } = {}) {
  const read = readPlan(raw, { projectFps: 30, defaultMode: format.planMode })
  if (!read.plan)
    return { ...read, plan: read.plan as unknown as Plan, lines: [], layout: null as any }
  if (read.plan.mode !== 'performance')
    return { ...read, plan: read.plan, lines: [], layout: null as any }
  const checked = validatePerformance(read.plan, { format, resolveMedia, wordsFor, ...extra })
  return {
    plan: read.plan,
    lines: checked.lines,
    layout: checked.layout,
    errors: [...read.errors, ...checked.errors],
    warnings: [...read.warnings, ...checked.warnings],
  }
}
const messages = (list: PlanIssue[]) => list.map((i) => `${i.where}: ${i.message}`).join('\n')
const has = (list: PlanIssue[], pattern: RegExp) =>
  list.some((i) => pattern.test(`${i.where}: ${i.message}`))

// ---------------------------------------------------------------------------
// Scaffold
// ---------------------------------------------------------------------------

test('scaffold: lines on sentence ends and pauses; pauses, retakes and false starts cut', () => {
  const { plan, counts } = scaffold()
  const lines = plan.performance.lines.map((l: Raw) => [
    l.id,
    l.keep ? 'KEEP' : `CUT ${l.reason}${l.takeOf ? ` of ${l.takeOf}` : ''}`,
    l.role ?? '-',
    l.source.in,
    l.source.out,
    l.text,
  ])
  assert.deepEqual(lines, [
    ['l01', 'KEEP', 'hook', 0.5, 2.3, 'Most people store bread wrong.'],
    ['l02', 'CUT pause', '-', 2.3, 3.8, ''],
    ['l03', 'CUT retake of l04', 'body', 3.8, 5.6, 'The fridge makes it stale faster.'],
    ['l04', 'KEEP', 'body', 5.8, 7.6, 'The fridge makes bread stale faster.'],
    ['l05', 'CUT false start', '-', 7.9, 8.2, 'Um.'],
    ['l06', 'CUT false start', '-', 8.5, 8.9, 'So the'],
    ['l07', 'KEEP', 'body', 9, 10.8, 'so the freezer is your friend.'],
    ['l08', 'CUT dead air', '-', 10.8, 13.5, ''],
    ['l09', 'KEEP', 'close', 13.5, 15.5, 'Slice it first, then freeze it.'],
  ])
  assert.deepEqual(counts, { lines: 9, kept: 4, retakes: 1, falseStarts: 2, pauses: 2 })
  assert.equal(plan.schemaVersion, 3)
  assert.equal(plan.mode, 'performance')
  assert.deepEqual(plan.performance.speaker, ['talk'])
  assert.equal(plan.performance.padFrames, 2)
  assert.deepEqual(plan.story.structure, ['hook', 'body', 'close'])
  // Every kept line starts with no visuals; request and arc are left to the agent.
  assert.ok(
    plan.performance.lines.filter((l: Raw) => l.keep).every((l: Raw) => l.visuals.length === 0),
  )
  const { errors } = check(plan)
  assert.ok(has(errors, /`request` is missing/) && has(errors, /`story.arc` is missing/))
  assert.equal(errors.length, 2, messages(errors))
})

test('scaffold: a restart at a line start is cut on its own; Greenscreen gets a setup line', () => {
  const restart = scaffoldPerformance(
    [
      {
        mediaId: 'talk',
        duration: 2,
        words: [
          w('The', 0, 0.2),
          w('best', 0.2, 0.5),
          w('the', 0.6, 0.8),
          w('best', 0.8, 1.0),
          w('loaf', 1.0, 1.4),
          w('wins.', 1.4, 1.9),
        ],
      },
    ],
    { format: YAP, fps: 30, pauseSec: 1 },
  ).plan.performance.lines
  assert.deepEqual(
    restart.map((l: Raw) => [l.text, l.keep, l.reason ?? null]),
    [
      ['The best', false, 'false start'],
      ['the best loaf wins.', true, null],
    ],
  )
  const green = scaffold(GREEN).plan
  assert.deepEqual(
    green.performance.lines.filter((l: Raw) => l.keep).map((l: Raw) => l.role),
    ['hook', 'setup', 'body', 'close'],
  )
  assert.deepEqual(green.story.structure, ['hook', 'setup', 'body', 'close'])
})

test('scaffold rules: fillers, retakes, phrases and similarity', () => {
  assert.ok(isFiller('Um.') && isFiller('So, um, yeah.') && isFiller('You know.'))
  assert.ok(!isFiller('So good.'))
  assert.ok(isRetake('The fridge makes it stale faster.', 'The fridge makes bread stale faster.'))
  // A cut-off take that the next one finishes is a retake too.
  assert.ok(isRetake('The fridge makes', 'The fridge makes bread stale faster.'))
  // A list's parallel lines are not.
  assert.ok(!isRetake('Number one is the croissant.', 'Number two is the pain au chocolat.'))
  assert.ok(!isRetake('Yes.', 'Yes.'))
  assert.deepEqual(findPhrase(WORDS.slice(0, 5), 'store bread'), { first: 2, last: 3 })
  assert.equal(findPhrase(WORDS.slice(0, 5), 'toast'), null)
  assert.equal(similarity('Most people store bread wrong', 'most people, store bread WRONG!'), 1)
})

// ---------------------------------------------------------------------------
// Reading and validation
// ---------------------------------------------------------------------------

test('the annotated plan validates; kept lines play back to back with pads; visuals land on their words', () => {
  const { plan, layout, errors, warnings } = check(annotated())
  assert.equal(errors.length, 0, messages(errors))
  assert.equal(warnings.length, 0, messages(warnings))
  assert.equal(plan.version, 3)
  assert.equal(plan.mode, 'performance')
  // Each kept line is its own clip (they are seconds apart in the source),
  // padded 2 frames each side but never into another line's speech: l04 starts
  // right after the cut retake l03 ends (5.6 s), so it gets the pad (5.73 s) only.
  assert.deepEqual(
    layout.runs.map((r: Raw) => [
      r.lines.join(),
      r.inSec.toFixed(3),
      r.outSec.toFixed(3),
      r.start,
      r.end,
    ]),
    [
      ['l01', '0.433', '2.367', 0, 58],
      ['l04', '5.733', '7.667', 58, 116],
      ['l07', '8.933', '10.867', 116, 174],
      ['l09', '13.433', '15.567', 174, 238],
    ],
  )
  assert.equal(layout.durationFrames, 238)
  assert.deepEqual(layout.spans.get('l07'), { start: 116, end: 174, speechStart: 118, run: 'run3' })
  assert.deepEqual(
    layout.visuals.map((v: Raw) => [
      v.id,
      v.trackRole,
      v.media?.mediaId ?? null,
      v.toSource,
      v.start,
      v.end,
    ]),
    [
      // "bread" starts 0.9 s after the line's in (frame 2 + 27), "wrong" ends at its out.
      ['l01-v1', 'images', 'loaf', null, 29, 56],
      ['l04-v1', 'images', 'fridge', null, 58, 116],
      ['l07-v1', 'images', null, 'a freezer drawer of sliced loaves', 130, 174],
    ],
  )
  assert.deepEqual(
    layout.texts.map((t: Raw) => [t.id, t.role, t.text, t.start, t.end]),
    [['l01-text', 'title', 'You store bread wrong', 0, 116]],
  )
})

test('lines that run on in their source play as one clip, so no cut appears between them', () => {
  const plan = annotated()
  // Keep the second take of the fridge line and the freezer line, back to back
  // in the source: 7.6 s and 7.65 s are within two pads.
  const line = (id: string) => plan.performance.lines.find((l: Raw) => l.id === id)
  line('l07').source = { mediaId: 'talk', in: 7.65, out: 10.8, unit: 's' }
  line('l07').text = 'Um. So the so the freezer is your friend.'
  line('l07').visuals = []
  line('l05').source = { mediaId: 'talk', in: 7.6, out: 7.65, unit: 's' }
  line('l06').source = { mediaId: 'talk', in: 7.6, out: 7.65, unit: 's' }
  const { layout, errors } = check(plan)
  assert.equal(errors.length, 0, messages(errors))
  assert.deepEqual(
    layout.runs.map((r: Raw) => r.lines),
    [['l01'], ['l04', 'l07'], ['l09']],
  )
  // l07's span starts where its source in plays: the clip runs on from l04.
  assert.deepEqual(layout.spans.get('l04'), { start: 58, end: 116, speechStart: 60, run: 'run2' })
  assert.deepEqual(layout.spans.get('l07'), { start: 116, end: 212, speechStart: 116, run: 'run2' })
})

test('takes: one kept per set; takeOf names a line; all cut is a warning', () => {
  const both = annotated()
  both.performance.lines[2].keep = true
  const twice = check(both)
  assert.ok(
    has(twice.errors, /l04: l03, l04 are takes of one line and l03 and l04 are kept: keep one/),
    messages(twice.errors),
  )
  const none = annotated()
  none.performance.lines[3] = {
    ...none.performance.lines[3],
    keep: false,
    reason: 'flub',
    visuals: [],
  }
  const cut = check(none)
  assert.ok(has(cut.warnings, /l03: every take of l03, l04 is cut/), messages(cut.warnings))
  const ghost = annotated()
  ghost.performance.lines[2].takeOf = 'l99'
  assert.ok(has(check(ghost).errors, /l03: takeOf "l99" is not a line/))
})

test('shape errors: lines, sources, keep, reasons, roles, visuals, points', () => {
  const plan = annotated()
  plan.performance.lines.push(
    { id: 'x1', source: { mediaId: 'talk', in: 3, out: 2 }, keep: true, role: 'body' },
    { id: 'x2', source: { mediaId: 'talk', in: 1, out: 2, unit: 'ms' }, keep: 'yes' },
    { id: 'x3', source: { in: 1, out: 2 }, keep: false, reason: 'boring' },
    { id: 'x4', source: { mediaId: 'talk', in: 1, out: 2 }, keep: true },
    {
      id: 'x5',
      source: { mediaId: 'talk', in: 1, out: 2 },
      keep: true,
      role: 'body',
      visuals: [
        { track: 'images' },
        { asset: 'loaf', at: -1 },
        { asset: 'loaf', until: { line: 5 } },
      ],
      onScreen: { text: 'hi', role: 'caption' },
    },
    { id: 'x6', source: { mediaId: 'talk', in: 1, out: 2 }, keep: false },
    { id: 'l01', source: { mediaId: 'talk', in: 1, out: 2 }, keep: false, reason: 'other' },
  )
  const { errors, warnings } = check(plan)
  for (const pattern of [
    /x1: `source.out` must be a number after `in`/,
    /x2: `source.unit` is 's'/,
    /x2: `keep` is true/,
    /x3: `source.mediaId` names the speaker clip/,
    /x3: reason "boring" is not one of flub, retake, pause/,
    /x4: `role` is missing/,
    /x5: a visual needs an `asset`/,
    /x5: `at` is seconds, a phrase or \{ word: n \}/,
    /x5: `until` is seconds, a phrase, \{ word: n \} or \{ line: id \}/,
    /x5: `onScreen.role` is title or labels/,
    /l01: line id is used twice/,
  ])
    assert.ok(has(errors, pattern), `${pattern}\n${messages(errors)}`)
  assert.ok(has(warnings, /x6: cut without a `reason`/), messages(warnings))
  assert.ok(has(check({ ...annotated(), performance: { lines: [] } }).errors, /plan: no lines/))
})

test('validation: media, lengths, roles, the hook first, story order, visuals and overlaps', () => {
  const plan = annotated()
  const line = (id: string) => plan.performance.lines.find((l: Raw) => l.id === id)
  line('l09').source = { mediaId: 'talk', in: 13.5, out: 17, unit: 's' }
  line('l09').role = 'outro'
  line('l04').visuals = [
    { asset: 'ghost' },
    { asset: 'hum' },
    { asset: 'loaf', at: 'butter' },
    { asset: 'fridge', track: 'captions' },
    { asset: '/stills/crumbs.png', at: 'stale' },
  ]
  line('l07').visuals.push({ asset: 'loaf', at: 0.1, until: 0.5 }, { asset: 'fridge', in: 4.5 })
  const { errors, warnings } = check(plan)
  for (const pattern of [
    /l09: runs to 17.00 s, but talk.mov is 16.00 s long/,
    /l09: role "outro" is not in the format's structure: Graphic Yap uses hook, body, close/,
    /l04-v1: ghost is not imported or in a catalog/,
    /l04-v2: hum.wav is audio: a visual is a picture/,
    /l04-v3: at "butter" is not in what the line says: 0:The 1:fridge/,
    /l04-v4: track "captions" is not one of images, plates, broll, labels/,
    /l07-v1: overlaps l07-v2 on the images track: frames 121-133/,
    /l07-v3: needs fridge.mp4 from 4.50 s to 6.43 s, but it is 5.00 s long/,
  ])
    assert.ok(has(errors, pattern), `${pattern}\n${messages(errors)}`)
  assert.ok(has(warnings, /l04-v5: crumbs.png is catalogued but not imported/), messages(warnings))

  // The first kept line must be the hook; roles out of story order warn.
  const late = annotated()
  late.performance.lines[0] = { ...late.performance.lines[0], role: 'body' }
  late.performance.lines[3] = { ...late.performance.lines[3], role: 'hook' }
  const shape = check(late)
  assert.ok(has(shape.errors, /l01: the first kept line plays body: the video opens on its hook/))
  assert.ok(has(shape.warnings, /l04: hook after l01 \(body\)/), messages(shape.warnings))
  const empty = annotated()
  for (const l of empty.performance.lines) Object.assign(l, { keep: false, reason: 'other' })
  assert.ok(has(check(empty).errors, /no kept lines/))
})

test("a kept line's text is checked against what is said; a missing transcript is a warning", () => {
  const plan = annotated()
  plan.performance.lines[3].text = 'Freeze it and toast it from frozen.'
  plan.performance.lines[6].text = ''
  const { warnings } = check(plan)
  assert.ok(
    has(
      warnings,
      /l04: the text is not what is said at 5.80 s-7.60 s; the transcript says "The fridge makes bread stale faster."/,
    ),
    messages(warnings),
  )
  assert.ok(
    has(
      warnings,
      /l07: no text: the transcript at 9.00 s-10.80 s says "so the freezer is your friend."/,
    ),
  )
  const blind = readPlan(annotated(), { projectFps: 30 }).plan!
  const result = validatePerformance(blind, { format: YAP, resolveMedia, wordsFor: () => null })
  assert.ok(has(result.warnings, /no transcript for talk.mov/), messages(result.warnings))
  // Word points need the words.
  assert.ok(has(result.errors, /l01-v1: at "bread" needs the line's transcript words/))
})

test('plan modes: speaker formats expect performance, the others story; v2 plans are story plans', () => {
  // A v3 plan that doesn't say takes its shape's mode, else the format's.
  const raw = annotated()
  delete raw.mode
  assert.equal(readPlan(raw, { projectFps: 30 }).plan!.mode, 'performance')
  const bare = { schemaVersion: 3, fps: 30, request: 'x', story: { arc: 'y' } }
  assert.equal(
    readPlan(bare, { projectFps: 30, defaultMode: 'performance' }).plan!.mode,
    'performance',
  )
  assert.equal(readPlan(bare, { projectFps: 30, defaultMode: 'story' }).plan!.mode, 'story')
  // A performance plan on a Vlog is allowed, with a warning.
  const vlog = check(annotated(), VLOG)
  assert.ok(has(vlog.warnings, /Vlog plans a story of beats/), messages(vlog.warnings))
  // A v2 plan (story) on Graphic Yap reads as a story, with a warning from story validation.
  const v2 = readPlan(
    {
      schemaVersion: 2,
      fps: 30,
      durationFrames: 30,
      request: 'x',
      story: { arc: 'y' },
      beats: [
        { id: 'b1', role: 'hook', edit: [0, 30], source: { mediaId: 'talk', in: 0, unit: 's' } },
      ],
    },
    { projectFps: 30, defaultMode: 'performance' },
  )
  assert.equal(v2.plan!.mode, 'story')
  assert.equal(v2.plan!.performance, null)
  assert.equal(v2.errors.length, 0, messages(v2.errors))
})

test('length: kept lines plus pads, against durationFrames (optional) and the brief', () => {
  const plan = { ...annotated(), durationFrames: 300 }
  const { warnings } = check(plan, YAP, { briefTargetSec: 45 })
  assert.ok(
    has(warnings, /plan: the kept lines run 7.93 s \(238 frames\); durationFrames says 300/),
  )
  assert.ok(has(warnings, /plan: 7.93 s long; the brief asks for about 45 s/))
  const padded = { ...annotated() }
  padded.performance.padFrames = 20
  assert.ok(has(check(padded).warnings, /padFrames 20 leaves up to 1.33 s of silence at each cut/))
})

// ---------------------------------------------------------------------------
// Estimates, script
// ---------------------------------------------------------------------------

test('estimates: length, speech rate, pauses and images per minute from the planned cut', () => {
  const { plan, layout } = check(annotated())
  const estimates: Record<string, any> = Object.fromEntries(
    performanceEstimates(plan, layout, YAP, { transcripts: { talk: { words: WORDS } } }).map(
      (c) => [c.key, c],
    ),
  )
  assert.equal(estimates.lengthSec.value.toFixed(2), '7.93')
  assert.equal(estimates.lengthSec.status, 'warn') // 40 to 80 s
  assert.equal(estimates.titleHook.status, 'pass')
  // 23 words in 7.93 s.
  assert.equal(Math.round(estimates.speechWpm.value), 174)
  assert.ok(estimates.pauseMaxSec.value < 0.5, String(estimates.pauseMaxSec.value))
  // Two images and the one still to source: 3 in 7.93 s.
  assert.equal(Math.round(estimates.imagesPerMin.value), 23)
  assert.equal(estimates.firstImageSec.value.toFixed(2), '0.97')
})

test('script: every line with its timecode in the cut, KEEP or CUT and why, visuals under it; the to-source list', () => {
  const { plan, lines, layout } = check(annotated())
  const script = performanceScript(plan, lines, layout).join('\n')
  assert.match(script, /^ 0:00\.00\s+KEEP\s+l01\s+hook\s+Most people store bread wrong\.$/m)
  assert.match(script, /^\s+talk\.mov 0\.50-2\.30 s$/m)
  assert.match(script, /^\s+\+ images\s+loaf\.png\s+0:00\.97-0:01\.87$/m)
  assert.match(script, /^\s+\+ title\s+"You store bread wrong"\s+0:00\.00-0:03\.87$/m)
  assert.match(script, /^\(0:01\.93\)\s+CUT \(pause\)\s+l02\s+-\s+\[1\.50 s without words\]$/m)
  assert.match(
    script,
    /^\(0:01\.93\)\s+CUT \(retake of l04\)\s+l03\s+body\s+The fridge makes it stale faster\.$/m,
  )
  assert.match(script, /^ 0:03\.87\s+KEEP\s+l07\s+body\s+so the freezer/m)
  assert.match(
    script,
    /\+ images\s+TO SOURCE: a freezer drawer of sliced loaves\s+0:04\.33-0:05\.80/,
  )
  assert.deepEqual(toSourceList(lines, layout, 30), [
    'l07-v1   0:04.33  images  a freezer drawer of sliced loaves   (on l07 body: "so the freezer is your friend.")',
  ])
})

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const yapProject = (timeline: Raw = {}) => ({
  metadata: { fps: 30, width: 1080, height: 1920 },
  format: { id: 'graphic-yap' },
  timeline: {
    tracks: [
      { id: 'track-title', name: 'Title', kind: 'video', formatRole: 'title', order: 0 },
      { id: 'track-captions', name: 'Captions', kind: 'video', formatRole: 'captions', order: 1 },
      { id: 'track-images', name: 'Images', kind: 'video', formatRole: 'images', order: 2 },
      { id: 'track-speaker', name: 'Speaker', kind: 'video', formatRole: 'speaker', order: 3 },
      {
        id: 'track-speaker-audio',
        name: 'Speaker audio',
        kind: 'audio',
        formatRole: 'speaker',
        order: 4,
      },
    ],
    items: [],
    ...timeline,
  },
})

function built(options: Raw = {}) {
  const { plan, lines, layout } = check(annotated())
  const result = buildPerformanceOps(plan, layout, lines, {
    project: yapProject(options.timeline),
    format: YAP,
    ...options,
  })
  return { ...result, ops: result.ops as Op[] }
}

test('build: kept lines jump cut back to back on Speaker with their own audio; source windows padded', () => {
  const { ops, placed } = built()
  const speaker = ops.filter((op) => op.op === 'addClip' && op.mediaId === 'talk')
  assert.deepEqual(
    speaker.map((op) => [op.callerId, op.trackId, op.from, op.durationInFrames]),
    [
      ['run0', 'track-speaker', 0, 58],
      ['run1', 'track-speaker', 58, 58],
      ['run2', 'track-speaker', 116, 58],
      ['run3', 'track-speaker', 174, 64],
    ],
  )
  // The source window is set on the video; its linked audio follows (updateItem carries timing).
  const windows = ops
    .filter((op) => op.op === 'updateItem' && op.id.$ref.startsWith('run'))
    .map((op) => [op.id.$ref, op.updates])
  assert.deepEqual(windows, [
    ['run0#/detail/created/0/id', { sourceStart: 13, sourceEnd: 71 }],
    ['run1#/detail/created/0/id', { sourceStart: 172, sourceEnd: 230 }],
    ['run2#/detail/created/0/id', { sourceStart: 268, sourceEnd: 326 }],
    ['run3#/detail/created/0/id', { sourceStart: 403, sourceEnd: 467 }],
  ])
  assert.ok(placed.runs.every((r) => r.syncSound === 'kept' && r.track === 'Speaker'))
  // Only the b-roll visual's own sound goes, never the speaker's.
  assert.deepEqual(
    ops.filter((op) => op.op === 'removeItems').map((op) => op.ids[0].$ref),
    ['visual1#/detail/created/1/id'],
  )
})

test('build: visuals at their frames on their track, text, a marker per kept line and per visual to source', () => {
  const { ops, placed } = built()
  assert.deepEqual(
    ops
      .filter((op) => op.op === 'addClip' && op.mediaId !== 'talk')
      .map((op) => [op.mediaId, op.trackId, op.from, op.durationInFrames]),
    [
      ['loaf', 'track-images', 29, 27],
      ['fridge', 'track-images', 58, 58],
    ],
  )
  const title = ops.find((op) => op.op === 'addText')!
  assert.deepEqual(
    [title.text, title.trackId, title.from, title.durationInFrames],
    ['You store bread wrong', 'track-title', 0, 116],
  )
  assert.deepEqual(
    ops
      .filter((op) => op.op === 'addMarker')
      .map((op) => [op.id, op.frame, op.label, op.color ?? null]),
    [
      ['plan-l01', 0, 'hook: Most people store bread wrong.', null],
      ['plan-l04', 58, 'body: The fridge makes bread stale faster.', null],
      ['plan-l07', 116, 'body: so the freezer is your friend.', null],
      ['plan-l09', 174, 'close: Slice it first, then freeze it.', null],
      ['plan-src-l07-v1', 130, 'to source (images): a freezer drawer of sliced loaves', '#EF4444'],
    ],
  )
  assert.deepEqual(
    placed.toSource.map((v) => v.id),
    ['l07-v1'],
  )
  const ids = ops.map((op) => op.callerId)
  assert.equal(new Set(ids).size, ids.length)
})

test('build: cover fit sets a full-bleed transform; markers-only; a busy draft needs --replace', () => {
  const plan = annotated()
  plan.performance.lines[0].visuals[0].fit = 'cover'
  const { plan: read, lines, layout } = check(plan)
  const { ops } = buildPerformanceOps(read, layout, lines, { project: yapProject(), format: YAP })
  assert.deepEqual(
    (ops as Op[]).find((op) => op.op === 'setTransform'),
    {
      callerId: 'visual0-fit',
      op: 'setTransform',
      id: { $ref: 'visual0#/detail/created/0/id' },
      transform: { width: 1920, height: 1920 },
    },
  )
  const markers = built({ markersOnly: true })
  assert.deepEqual([...new Set(markers.ops.map((op) => op.op))], ['addMarker'])
  assert.equal(markers.ops.length, 5)
  const busy = {
    items: [{ id: 'x', type: 'video', trackId: 'track-speaker', from: 0, durationInFrames: 30 }],
  }
  assert.throws(() => built({ timeline: busy }), /already has 1 item\(s\)/)
  assert.deepEqual(built({ timeline: busy, replace: true }).ops[0], {
    callerId: 'clear-items',
    op: 'removeItems',
    ids: ['x'],
  })
})

// ---------------------------------------------------------------------------
// The edit against the plan
// ---------------------------------------------------------------------------

const speakerClip = (id: string, from: number, length: number, sourceStart: number) => ({
  id,
  type: 'video',
  mediaId: 'talk',
  trackId: 'track-speaker',
  from,
  durationInFrames: length,
  sourceStart,
  sourceEnd: sourceStart + length,
  sourceFps: 30,
})
const builtTimeline = () => [
  speakerClip('a', 0, 58, 13),
  speakerClip('b', 58, 58, 172),
  speakerClip('c', 116, 58, 268),
  speakerClip('d', 174, 64, 403),
]

test('compare: the built cut is clean', () => {
  const { plan, lines, layout } = check(annotated())
  assert.deepEqual(comparePerformance(plan, lines, layout, { items: builtTimeline() }), {
    findings: [],
    checked: 9,
    skipped: 0,
  })
})

test('compare: a kept line gone, lines reordered, a retake back in, a pause back in, length drift', () => {
  const { plan, lines, layout } = check(annotated())
  const [a, b, , d] = builtTimeline()
  const items = [
    a!,
    // l09 (the close) moved before l04; l07 removed.
    { ...d!, from: 58 },
    { ...b!, from: 122 },
    // The cut retake l03 (3.8-5.6 s) is back in, and the pause after the hook (2.3-3.8 s).
    speakerClip('r', 180, 54, 114),
    speakerClip('p', 234, 45, 69),
  ]
  const { findings } = comparePerformance(plan, lines, layout, { items })
  const text = findings.map((f) => `${f.level} ${f.message}`).join('\n')
  assert.match(
    text,
    /warn l07 body "so the freezer is your friend\." is not on the timeline \(planned at frames 116-174/,
  )
  assert.match(text, /warn l09 now plays before l04 \(planned l04 then l09\)/)
  assert.match(
    text,
    /warn l03 body "The fridge makes it stale faster\." was cut \(retake\) and is back in at frames 180-234/,
  )
  assert.match(text, /info l02 cut was cut \(pause\) and is back in/)
  assert.match(text, /warn the timeline is 9.30 s, the plan 7.93 s/)
  assert.ok(findings.every((f) => ['warn', 'info'].includes(f.level) && f.ranges.length))
})
