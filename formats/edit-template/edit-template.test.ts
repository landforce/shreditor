// The edit template model (formats/edit-template/): VideoDatabase Video DNA and
// finished projects into templates, slot roles, the suggested format and the
// Template section of shred check. The commands: headless/edit-templates.test.mjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'vite-plus/test'
import { resolveFormat } from '../registry.mjs'
import { readVdb, templateFromVdb } from './vdb.mjs'
import {
  inferShotType,
  shotRole,
  slotTrackRole,
  suggestTemplateFormat,
  textPattern,
  textRole,
} from './roles.mjs'
import { templateFromProject } from './project.mjs'
import { scoreTemplate } from './score.mjs'
import { scaffoldFromTemplate } from './scaffold.mjs'
import { pacingFromSlots, templateProblems } from './template.mjs'
import { clip, yapMedia, yapProject } from '../../headless/fixtures/edit-template-fixtures.mjs'

const FIXTURES = path.resolve(__dirname, '../../headless/fixtures/vdb')
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8')
const fromFixture = (name: string) =>
  templateFromVdb(readVdb(fixture(name)), { createdAt: 'fixed' })
const test = it

describe('edit templates', () => {
  test('vdb: the json (get_video_dna) and the md download give the same slot structure', () => {
    const json = fromFixture('vdb-44870-dna.json')
    const md = fromFixture('vdb-44870-dna.md')
    assert.deepEqual(templateProblems(json), [])
    const structure = (t: any) => t.slots.map(({ pattern: _pattern, ...slot }: any) => slot)
    assert.deepEqual(structure(md), structure(json))
    assert.equal(json.slots.length, 32)
    for (const key of [
      'durationSec',
      'shotCount',
      'cutsPerMin',
      'medianShotSec',
      'firstCutSec',
      'shotMix',
      'title',
    ])
      assert.deepEqual(md.pacing[key], json.pacing[key], key)
    assert.deepEqual(json.captions, { mode: 'on', start: 0, end: 56.078, position: 'bottom' })
    assert.equal(md.name, 'kathrinmormann-44870')
    assert.equal(json.source.videoId, 44870)
    assert.equal(md.source.videoId, 44870)
    assert.equal(md.source.platformUrl, 'https://www.instagram.com/p/Dd9KqdyIgTV')
    // Only the json has the hook template and the outline: the title's pattern is the template.
    const title = (t: any) => t.slots.find((slot: any) => slot.id === 'T01')
    assert.match(title(json).pattern, /^DON'T BELIEVE THE HYPE: \[HYPED THING\]/)
    assert.equal(title(md).pattern, "DON'T BELIEVE THE HYPE ZARA X JOHN GALLIANO")
    assert.equal(title(json).reference, title(md).reference)
    assert.equal(json.outline.beats.length, 5)
    assert.deepEqual(md.outline.beats, [])
  })

  test('vdb: pacing targets, roles, anchors and the suggested format for 44870', () => {
    const t = fromFixture('vdb-44870-dna.json')
    assert.deepEqual(
      [t.pacing.shotCount, t.pacing.cutsPerMin, t.pacing.medianShotSec, t.pacing.firstCutSec],
      [27, 27.82, 1.6, 0.833],
    )
    assert.deepEqual(t.pacing.shotMix, { speaker: 0.89, images: 0.06, screen: 0.05 })
    const roles = t.slots.filter((s: any) => s.kind === 'shot').map((s: any) => s.role)
    assert.equal(roles.filter((r: any) => r === 'images').length, 7)
    assert.equal(roles.filter((r: any) => r === 'screen').length, 1)
    assert.deepEqual(
      t.slots
        .filter((s: any) => s.kind === 'text')
        .map((s: any) => [s.id, s.role, s.style, s.pattern]),
      [
        ['T01', 'title', 'kit:title', t.outline.hook.template],
        ['T02', 'labels', 'kit:listicle-headline', '1. [POINT]'],
        ['T03', 'labels', 'kit:listicle-headline', '2. [POINT]'],
        ['T04', 'labels', 'kit:listicle-headline', '3. [POINT]'],
      ],
    )
    // G01 starts at 11.03 s, 3 ms before S10 does: rounded labels snap to the shot.
    assert.deepEqual(t.slots.find((s: any) => s.id === 'G01').anchor, { slot: 'S10', offsetSec: 0 })
    assert.deepEqual(t.slots.find((s: any) => s.id === 'T02').anchor, { slot: 'S07', offsetSec: 3 })
    assert.equal(t.format.id, 'graphic-yap')
    assert.equal(t.format.variant, 'standard')
    assert.match(t.format.reason, /Talking Head Edit \(not a Shreditor format\).*89%/)
  })

  test('vdb: missing optional fields are fine; no timeline is a clear error', () => {
    const minimal = {
      data: {
        timeline: {
          shots: [
            { start: 0, end: 1.2, description: 'B-roll: street' },
            { start: 1.2, end: 2, speech: 'none' },
          ],
        },
      },
    }
    const t = templateFromVdb(readVdb(JSON.stringify(minimal)))
    assert.deepEqual(templateProblems(t), [])
    assert.deepEqual(
      t.slots.map((s: any) => [s.id, s.role, s.boundary]),
      [
        ['S01', 'broll', 'start'],
        ['S02', 'shots', 'cut'],
      ],
    )
    assert.equal(t.captions.mode, 'off')
    assert.equal(t.outline, null)
    assert.throws(
      () => readVdb(JSON.stringify({ data: { timeline: { available: false } } })),
      /no edit timeline/,
    )
    assert.throws(
      () => readVdb('# Video DNA: @x - y\n\n## Format\n\nVlog\n'),
      /no "## Edit Timeline"/,
    )
  })

  // ---------------------------------------------------------------------------
  // Roles and the format suggestion
  // ---------------------------------------------------------------------------

  test('roles: shot_type and speech to slot roles, text kinds to roles and styles', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ shot_type: 'talking_head', speech: 'to_camera' }, 'speaker'],
      [{ shot_type: 'photo_or_still' }, 'images'],
      [{ shot_type: 'screen_recording' }, 'screen'],
      [{ shot_type: 'b_roll', speech: 'voiceover' }, 'broll'],
      [{ shot_type: 'something_new', speech: 'none' }, 'shots'],
      [{ shot_type: 'something_new', speech: 'voiceover' }, 'broll'],
      [{ description: 'Photo: a croissant' }, 'images'],
      [{ description: 'Screen recording: cart', framing: 'medium' }, 'screen'],
      [{ description: 'A desk', framing: 'screen' }, 'screen'],
      [{ description: 'Holding shears', speech: 'to_camera' }, 'speaker'],
    ]
    for (const [shot, role] of cases) assert.equal(shotRole(shot), role, JSON.stringify(shot))
    assert.equal(inferShotType({ description: 'Photo: x' }), 'photo_or_still')
    assert.deepEqual(textRole('title hook'), { role: 'title', style: 'kit:title' })
    assert.deepEqual(textRole('list_item'), { role: 'labels', style: 'kit:listicle-headline' })
    assert.deepEqual(textRole('callout'), { role: 'labels', style: 'kit:overlay' })
    assert.equal(textPattern('list_item', '2. THE STYLING', null), '2. [POINT]')
    assert.equal(textPattern('callout', 'Wow', 'X: [Y]'), 'Wow')
    const yap = resolveFormat('graphic-yap')
    assert.equal(slotTrackRole('screen', yap), 'images')
    assert.equal(slotTrackRole('broll', resolveFormat('greenscreen')), 'plates')
    // A 10 Shot has no Images track: a photo is a shot.
    assert.equal(slotTrackRole('images', resolveFormat('ten-shot')), 'shots')
  })

  test('roles: the suggested format from the reference format or the shot mix', () => {
    const shots = (list: Array<[string, number, string]>) =>
      list.map(([role, sec, speech], i) => ({
        id: `S${i}`,
        kind: 'shot',
        role,
        start: 0,
        end: sec,
        targetSec: sec,
        speech,
      }))
    const suggest = (slots: any[], referenceFormat?: string) =>
      suggestTemplateFormat({ referenceFormat, slots, pacing: pacingFromSlots(slots, 14) })
    const montage = shots(
      Array.from({ length: 12 }, (): [string, number, string] => ['shots', 1.1, 'none']),
    )
    assert.equal(suggest(montage).id, 'ten-shot')
    assert.equal(suggest(montage).variant, 'even')
    const vo = shots(
      Array.from({ length: 10 }, (): [string, number, string] => ['broll', 1.4, 'voiceover']),
    )
    assert.equal(suggest(vo).id, 'vlog')
    assert.equal(suggest(vo, '10 Shot').id, 'ten-shot')
    assert.match(suggest(vo, 'Vlog').reason, /the reference is a Vlog/)
  })

  test('from a project: clips and texts become slots, with the tracks and styles to rebuild them', () => {
    const t = templateFromProject(yapProject(), { mediaById: yapMedia, createdAt: 'fixed' })
    assert.deepEqual(templateProblems(t), [])
    assert.equal(t.name, 'bread-rant')
    assert.deepEqual(t.format, {
      id: 'graphic-yap',
      variant: 'standard',
      reason: "the project's own format",
    })
    assert.deepEqual(t.canvas, { width: 1080, height: 1920, fps: 30, aspect: '9:16' })
    assert.deepEqual(
      t.slots.map((s: any) => [s.id, s.kind, s.role, s.start, s.targetSec, s.boundary ?? null]),
      [
        ['s01', 'shot', 'speaker', 0, 3, 'start'],
        ['t01', 'text', 'title', 0, 3.5, null],
        ['s02', 'shot', 'speaker', 3, 2, 'jump_cut'],
        ['s03', 'shot', 'images', 3.333, 1.333, 'start'],
        ['s04', 'shot', 'speaker', 5, 3, 'jump_cut'],
      ],
    )
    const first = t.slots[0].project
    assert.deepEqual(
      [first.itemId, first.mediaId, first.audio, first.audioTrackId, first.sourceStartSec],
      ['c1', 'talk', 'linked', 'track-speaker-audio', 0],
    )
    assert.equal(t.slots[2].project.audio, 'none')
    assert.equal(t.slots.find((s: any) => s.id === 't01').project.styleId, 'style-hook')
    assert.deepEqual(t.captions, { mode: 'on', start: 0, end: 8, style: 'style-caps' })
    assert.deepEqual(
      t.project.textStyles.map((s: any) => s.id),
      ['style-hook', 'style-caps'],
    )
    assert.equal(t.project.tracks.length, 5)
    // The viewer sees 5 shots: c1, c2, the loaf over c2, c2 again, c3.
    assert.equal(t.pacing.shotCount, 5)
    assert.deepEqual(t.pacing.title, { atSec: 0, holdSec: 3.5 })
  })

  test('check: the Template section passes a close cut and only warns on a far one', () => {
    const template = templateFromProject(yapProject(), { mediaById: yapMedia, createdAt: 'fixed' })
    const same = scoreTemplate(yapProject(), template, { mediaById: yapMedia })
    assert.equal(same.summary.warn, 0, JSON.stringify(same.checks, null, 1))
    assert.ok(same.checks.every((c: any) => c.status !== 'fail'))
    // One long speaker clip, no image, a late short title, no captions.
    const far = yapProject()
    far.timeline.items = [
      clip('c1', 'talk', 'track-speaker', 0, 600),
      { ...far.timeline.items.find((i: any) => i.id === 'tt'), from: 30, durationInFrames: 20 },
    ]
    const report = scoreTemplate(far, template, { mediaById: yapMedia })
    const status = Object.fromEntries(report.checks.map((c: any) => [c.key, c.status]))
    assert.deepEqual(status, {
      templateLength: 'warn',
      templateCutsPerMin: 'warn',
      templateMedianShot: 'warn',
      templateFirstCut: 'na',
      templateShotMix: 'warn',
      templateLabels: 'pass',
      templateTitleAt0: 'warn',
      templateTitleHold: 'warn',
      templateCaptions: 'warn',
    })
    assert.equal(report.summary.fail, 0)
    const hook = report.checks.find((c: any) => c.key === 'templateTitleAt0')
    assert.deepEqual(hook.ranges, [{ startFrame: 30, endFrame: 50 }])
    assert.deepEqual(report.checks.find((c: any) => c.key === 'templateLength').ranges, [
      { startFrame: 0, endFrame: 600 },
    ])
  })

  // ---------------------------------------------------------------------------
  // The plan scaffold (validated through the commands in headless/edit-templates.test.mjs)
  // ---------------------------------------------------------------------------

  const words = Array.from({ length: 24 }, (_, i) => ({
    text: `word${i}${i % 4 === 3 ? '.' : ''}`,
    start: i * 0.5,
    end: i * 0.5 + 0.4,
  }))
  const photo = (mediaId: string) => ({
    mediaId,
    fileName: `${mediaId}.png`,
    kind: 'image',
    duration: 0,
    category: 'graphics',
  })

  test('scaffold: a speaker format keeps the performance and places the cutaways and texts', () => {
    const template = fromFixture('vdb-44870-dna.json')
    const result = scaffoldFromTemplate(template, {
      format: resolveFormat('graphic-yap'),
      fps: 30,
      request: 'Like that one',
      media: [photo('p1'), photo('p2')],
      speakers: [{ mediaId: 'talk', duration: 13, words }],
      pauseSec: 1,
      padFrames: 3,
    })
    assert.equal(result.mode, 'performance')
    const kept = result.plan.performance.lines.filter((line: any) => line.keep)
    assert.equal(kept.length, 6)
    assert.equal(kept[0].onScreen.role, 'title')
    assert.deepEqual(kept[0].onScreen.until, { line: kept[1].id })
    const visuals = kept.flatMap((line: any) => line.visuals)
    assert.equal(visuals.length + result.skippedVisuals.length, 9)
    for (const line of kept) {
      const spans = line.visuals
        .map((v: any) => [v.at, v.until])
        .sort((a: number[], b: number[]) => a[0]! - b[0]!)
      for (const [i, [at, until]] of spans.entries()) {
        assert.ok(until > at)
        if (i) assert.ok(at >= spans[i - 1][1], `visuals on ${line.id} overlap`)
      }
    }
    assert.deepEqual(result.plan.template.source, {
      type: 'vdb',
      videoId: 44870,
      url: template.source.url,
    })
    assert.throws(
      () =>
        scaffoldFromTemplate(template, {
          format: resolveFormat('graphic-yap'),
          fps: 30,
          speakers: [],
        }),
      /import the speaker footage/,
    )
  })

  test('scaffold: a story format leaves beats without a candidate for the agent to fill', () => {
    const template = fromFixture('vdb-44870-dna.md')
    const result = scaffoldFromTemplate(template, {
      format: resolveFormat('vlog', 'slow'),
      fps: 30,
      request: 'x',
      media: [photo('p1')],
    })
    assert.equal(result.plan.beats.length, 27)
    assert.equal(result.plan.beats[0].role, 'hook')
    assert.equal(result.plan.beats.at(-1).role, 'close')
    // Speaker slots have no speaker media: left empty; the photos fill the images slots.
    assert.ok(result.toFill.includes('S01'))
    assert.equal(result.plan.beats.find((b: any) => b.slot === 'S03').source.mediaId, 'p1')
    assert.match(result.plan.story.arc, /Follow the reference's structure .*27 shots over 56 s/)
    assert.deepEqual(result.skippedTexts, [])
  })
})
