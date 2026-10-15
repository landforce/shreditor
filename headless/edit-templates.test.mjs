// Edit templates through the commands (skills/shreditor-edit/scripts/edit-templates.mjs):
// both Video DNA inputs, from-vdb/list/show, the plan scaffold they make (validated
// by the plan validator), new --from-template and slot fill, and the Template
// section of shred check. The model's own tests: formats/edit-template/edit-template.test.ts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readVdb, templateFromVdb } from '../formats/edit-template/vdb.mjs'
import { templateProblems } from '../formats/edit-template/template.mjs'
import {
  clip,
  png,
  video,
  yapMedia,
  yapProject,
  yapTracks,
} from './fixtures/edit-template-fixtures.mjs'
import {
  newFromTemplate,
  templateCheck,
  templateCommand,
  templatePlan,
} from '../skills/shreditor-edit/scripts/edit-templates.mjs'
import { checkPlan } from '../skills/shreditor-edit/scripts/plan.mjs'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'vdb')
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8')
const fromFixture = (name) => templateFromVdb(readVdb(fixture(name)), { createdAt: 'fixed' })

test('vdb: the json (get_video_dna) and the md download give the same slot structure', () => {
  const json = fromFixture('vdb-44870-dna.json')
  const md = fromFixture('vdb-44870-dna.md')
  assert.deepEqual(templateProblems(json), [])
  const structure = (t) => t.slots.map(({ pattern, ...slot }) => slot)
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
  const title = (t) => t.slots.find((slot) => slot.id === 'T01')
  assert.match(title(json).pattern, /^DON'T BELIEVE THE HYPE: \[HYPED THING\]/)
  assert.equal(title(md).pattern, "DON'T BELIEVE THE HYPE ZARA X JOHN GALLIANO")
  assert.equal(title(json).reference, title(md).reference)
  assert.equal(json.outline.beats.length, 5)
  assert.deepEqual(md.outline.beats, [])
})

// ---------------------------------------------------------------------------
// A scratch workspace and project
// ---------------------------------------------------------------------------

function workspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-edit-templates-'))
  fs.mkdirSync(path.join(ws, 'projects', 'p1', 'agent'), { recursive: true })
  return ws
}

function addMedia(ws, id, meta, { project = 'p1', words } = {}) {
  fs.mkdirSync(path.join(ws, 'media', id, 'cache', 'ai'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'media', id, 'metadata.json'), JSON.stringify({ id, ...meta }))
  if (words)
    fs.writeFileSync(
      path.join(ws, 'media', id, 'cache', 'ai', 'transcript.json'),
      JSON.stringify({ data: { segments: [{ text: 'x', start: 0, end: 30, words }] } }),
    )
  const links = path.join(ws, 'projects', project, 'media-links.json')
  fs.mkdirSync(path.dirname(links), { recursive: true })
  const have = fs.existsSync(links) ? JSON.parse(fs.readFileSync(links, 'utf8')).mediaIds : []
  fs.writeFileSync(links, JSON.stringify({ mediaIds: [...have, id] }))
}

// ---------------------------------------------------------------------------
// The commands, with the service faked
// ---------------------------------------------------------------------------

function commands(ws, { opt = {}, project, created = [] } = {}) {
  const said = []
  const batches = []
  const projects = new Map([['p1', project]])
  const deps = {
    say: (line = '') => said.push(line),
    opt,
    workspace: () => ws,
    getProject: async (id) => ({ project: projects.get(id), revision: 'r1' }),
    applyBatch: async (id, ops) => {
      batches.push({ id, ops })
      return {
        results: ops.map((op, i) => ({
          callerId: op.callerId,
          detail:
            op.op === 'addClip'
              ? { created: [{ id: `${op.callerId}-v` }, { id: `${op.callerId}-a` }] }
              : { id: `${op.callerId ?? `op${i}`}-x` },
        })),
      }
    },
    readDrafts: () => ({}),
    writeDrafts: () => {},
    warnUnsaved: async () => false,
    call: async (method, route, body) => {
      created.push(body)
      projects.set('p2', {
        id: 'p2',
        name: body.name,
        metadata: { width: body.width, height: body.height, fps: body.fps },
        format: body.format,
        timeline: { tracks: yapTracks.slice(0, 4), items: [] },
      })
      return { id: 'p2' }
    },
    key: (tag) => tag,
    editorUrl: 'http://editor',
  }
  return { deps, said, batches, projects }
}

test('template from-vdb, list and show through the commands', async () => {
  const ws = workspace()
  const run = commands(ws)
  await templateCommand(run.deps, ['from-vdb', path.join(FIXTURES, 'vdb-44870-dna.md')])
  const out = run.said.join('\n')
  assert.match(out, /Saved .*app\/edit-templates\/kathrinmormann-44870\.json/)
  assert.match(out, /Format\s+Graphic Yap standard/)
  assert.match(out, /S03\s+shot\s+images\s+0:01\.67-0:02\.03\s+0\.37\s+images\s+hard cut/)
  assert.match(out, /T02\s+text\s+labels .*"1\. \[POINT\]"\s+\(ref "1\. THE TOTAL"\)/)
  const listed = commands(ws)
  await templateCommand(listed.deps, ['list'])
  assert.match(
    listed.said.join('\n'),
    /kathrinmormann-44870\s+graphic-yap standard\s+56\.1 s\s+27 shots\s+vdb 44870/,
  )
})

const WORDS = Array.from({ length: 24 }, (_, i) => {
  const sentenceEnd = i % 4 === 3
  return { text: `word${i}${sentenceEnd ? '.' : ''}`, start: i * 0.5, end: i * 0.5 + 0.4 }
})

test('plan --template: a speaker format keeps the performance and takes the template cutaways and texts', async () => {
  const ws = workspace()
  addMedia(ws, 'talk', video('talk.mov', 13, 'speaker'), { words: WORDS })
  addMedia(ws, 'photo1', png('photo1.png'))
  addMedia(ws, 'photo2', png('photo2.png'))
  const project = {
    id: 'p1',
    metadata: { fps: 30, width: 1080, height: 1920 },
    format: { id: 'graphic-yap' },
    timeline: { tracks: yapTracks, items: [] },
  }
  await templateCommand(commands(ws).deps, ['from-vdb', path.join(FIXTURES, 'vdb-44870-dna.json')])
  const run = commands(ws, {
    opt: { template: 'kathrinmormann-44870', request: 'Cut my rant like that video' },
    project,
  })
  await templatePlan(run.deps, ['p1'])
  const out = run.said.join('\n')
  assert.equal(process.exitCode ?? 0, 0, out)
  assert.match(out, /Template  kathrinmormann-44870 → .*agent\/plan\.json/)
  assert.match(out, /From template kathrinmormann-44870/)
  assert.match(out, /Valid\./)
  const plan = JSON.parse(fs.readFileSync(path.join(ws, 'projects/p1/agent/plan.json'), 'utf8'))
  assert.equal(plan.mode, 'performance')
  assert.equal(plan.template.name, 'kathrinmormann-44870')
  assert.match(plan.template.hash, /^sha256:/)
  assert.equal(plan.request, 'Cut my rant like that video')
  assert.match(plan.story.arc, /Challenge popular trend → Offer critical thinking framework/)
  const kept = plan.performance.lines.filter((line) => line.keep)
  assert.match(kept[0].onScreen.text, /^DON'T BELIEVE THE HYPE: \[HYPED THING\]/)
  const visuals = kept.flatMap((line) => line.visuals)
  // 8 cutaway shots + 1 graphic in the reference, on Images, with the photos as candidates.
  assert.equal(visuals.length, 9)
  assert.ok(visuals.every((v) => v.track === 'images' && v.toSource))
  assert.deepEqual([...new Set(visuals.map((v) => v.asset))].sort(), ['photo1', 'photo2'])
  const labels = kept.map((line) => line.onScreen).filter((s) => s?.role === 'labels')
  assert.deepEqual(
    labels.map((s) => s.text),
    ['1. [POINT]', '2. [POINT]', '3. [POINT]'],
  )
  const record = JSON.parse(
    fs.readFileSync(path.join(ws, 'projects/p1/agent/template.json'), 'utf8'),
  )
  assert.equal(record.name, 'kathrinmormann-44870')
  assert.equal(record.via, 'plan')
  // A second run never overwrites the plan.
  const again = commands(ws, { opt: { template: 'kathrinmormann-44870' }, project })
  await templatePlan(again.deps, ['p1'])
  assert.match(again.said.join('\n'), /plan\.json exists: not overwritten/)
  assert.match(again.said.join('\n'), /request  ".*" \(the default; --request puts the user.s own words in the plan\)/)
})

test('plan --template: a story format gets one beat per shot slot, with candidates, and validates', async () => {
  const ws = workspace()
  const montage = {
    data: {
      video_id: 7,
      creator: '@city',
      description: 'Five streets',
      fields: { video_format: { value: '10 Shot' } },
      timeline: {
        shots: Array.from({ length: 12 }, (_, i) => ({
          id: `S${i + 1}`,
          start: i * 1.1,
          end: (i + 1) * 1.1,
          boundary: i ? 'hard_cut' : 'start',
          shot_type: i === 4 ? 'photo_or_still' : 'b_roll',
          speech: 'none',
          description: `street ${i + 1}`,
        })),
        texts: [
          {
            id: 'T1',
            start: 0,
            end: 3,
            kind: 'title_hook',
            description: 'Five streets in one day',
          },
        ],
      },
    },
  }
  const file = path.join(ws, 'dna.json')
  fs.writeFileSync(file, JSON.stringify(montage))
  await templateCommand(commands(ws).deps, ['from-vdb', file, '--name', 'x'])
  for (const i of [1, 2, 3]) addMedia(ws, `street${i}`, video(`street${i}.mp4`, 5, 'b-roll'))
  const project = {
    id: 'p1',
    metadata: { fps: 30, width: 1080, height: 1920 },
    format: { id: 'ten-shot' },
    timeline: { tracks: [], items: [] },
  }
  const run = commands(ws, {
    opt: { template: 'city-7', request: 'A montage of my streets' },
    project,
  })
  await templatePlan(run.deps, ['p1'])
  const out = run.said.join('\n')
  assert.match(out, /Valid\./, out)
  const plan = JSON.parse(fs.readFileSync(path.join(ws, 'projects/p1/agent/plan.json'), 'utf8'))
  assert.equal(plan.mode, 'story')
  assert.equal(plan.beats.length, 12)
  assert.deepEqual(plan.beats[0].edit, [0, 33])
  assert.deepEqual([plan.beats[0].role, plan.beats[11].role], ['hook', 'close'])
  assert.deepEqual(plan.beats[0].text, {
    text: 'Five streets in one day',
    role: 'title',
    edit: [0, 90],
  })
  // The photo slot has no image media: it takes b-roll; the clips are walked through, not repeated.
  assert.ok(plan.beats.every((beat) => beat.source.mediaId?.startsWith('street')))
  assert.deepEqual(
    plan.beats.slice(0, 4).map((b) => [b.source.mediaId, b.source.in]),
    [
      ['street1', 0],
      ['street2', 0],
      ['street3', 0],
      ['street1', 1.1],
    ],
  )
  assert.deepEqual([plan.beats[4].slot, plan.beats[4].targetSeconds], ['S5', 1.1])
  const checked = checkPlan(ws, 'p1', project)
  assert.deepEqual(checked.errors, [])
})

// ---------------------------------------------------------------------------
// Whole-project reuse: new --from-template, then fill
// ---------------------------------------------------------------------------

test('new --from-template rebuilds the structure through ops; fill swaps media keeping ids', async () => {
  const ws = workspace()
  addMedia(ws, 'talk', video('talk.mov', 20, 'speaker'))
  addMedia(ws, 'loaf', png('loaf.png'))
  addMedia(ws, 'new-talk', video('new.mov', 4, 'speaker'), { project: 'p2' })
  addMedia(ws, 'tiny', video('tiny.mov', 1, 'speaker'), { project: 'p2' })
  await templateCommand(commands(ws, { project: yapProject() }).deps, ['from-project', 'p1'])
  const created = []
  const fake = commands(ws, {
    opt: { 'from-template': 'bread-rant', name: 'Bread rant 2' },
    created,
  })
  await newFromTemplate(fake.deps)
  assert.deepEqual(created[0], {
    name: 'Bread rant 2',
    width: 1080,
    height: 1920,
    fps: 30,
    format: { id: 'graphic-yap', variant: 'standard' },
  })
  const ops = fake.batches[0].ops
  // The new project lacks Speaker audio: one addTrack; both used styles come in; no captions.
  assert.deepEqual(
    ops.filter((op) => op.op === 'addTrack').map((op) => op.name),
    ['Speaker audio'],
  )
  assert.deepEqual(
    ops.filter((op) => op.op === 'upsertTextStyle').map((op) => op.style.id),
    ['style-hook', 'style-caps'],
  )
  const clips = ops.filter((op) => op.op === 'addClip')
  assert.deepEqual(
    clips.map((op) => [op.callerId, op.mediaId, op.trackId, op.from, op.durationInFrames]),
    [
      ['s01', 'talk', 'track-speaker', 0, 90],
      ['s02', 'talk', 'track-speaker', 90, 60],
      ['s03', 'loaf', 'track-images', 100, 40],
      ['s04', 'talk', 'track-speaker', 150, 90],
    ],
  )
  const window = ops.find(
    (op) => op.op === 'updateItem' && op.id.$ref === 's02#/detail/created/0/id',
  )
  assert.deepEqual(
    [window.updates.sourceStart, window.updates.sourceEnd, window.updates.label],
    [120, 180, 's02 · talk.mov'],
  )
  // s02 had no audio of its own in the original: its new companion goes.
  assert.ok(
    ops.some((op) => op.op === 'removeItems' && op.ids[0].$ref === 's02#/detail/created/1/id'),
  )
  const text = ops.find((op) => op.op === 'addText')
  assert.deepEqual(
    [text.text, text.styleId, text.trackId, text.from],
    ['You store bread wrong', 'style-hook', 'track-title', 0],
  )
  assert.match(fake.said.join('\n'), /Captions are not copied/)
  const record = JSON.parse(
    fs.readFileSync(path.join(ws, 'projects/p2/agent/template.json'), 'utf8'),
  )
  assert.deepEqual(record.slots.s01.itemIds, ['s01-v', 's01-a'])
  assert.equal(record.slots.s01.filled, false)

  // Fill: replaceMedia on the slot's item, timing kept by the op; too-short media refused up front.
  const timeline = { tracks: yapTracks, items: [clip('s01-v', 'talk', 'track-speaker', 0, 90)] }
  fake.projects.set('p2', { ...fake.projects.get('p2'), timeline })
  const filled = commands(ws, { opt: { slot: ['s01=new-talk@0.5'] } })
  filled.deps.getProject = fake.deps.getProject
  await templateCommand(filled.deps, ['fill', 'p2'])
  assert.deepEqual(filled.batches[0].ops, [
    {
      op: 'replaceMedia',
      id: 's01-v',
      mediaId: 'new-talk',
      sourceStart: 15,
      label: 's01 · new.mov',
    },
  ])
  assert.match(filled.said.join('\n'), /Still placeholders \(3\): s02, s03, s04/)
  const short = commands(ws, { opt: { slot: ['s01=tiny'] } })
  short.deps.getProject = fake.deps.getProject
  await assert.rejects(
    templateCommand(short.deps, ['fill', 'p2']),
    /tiny\.mov is 1\.00 s; the slot needs 3\.00 s from 0\.00 s/,
  )
  const unknown = commands(ws, { opt: { slot: ['s99=tiny'] } })
  unknown.deps.getProject = fake.deps.getProject
  await assert.rejects(
    templateCommand(unknown.deps, ['fill', 'p2']),
    /s99 is not a slot of this project/,
  )
})

// ---------------------------------------------------------------------------
// shred check: the Template section
// ---------------------------------------------------------------------------

test('check: templateCheck reads the record a plan or new --from-template left on the project', async () => {
  const ws = workspace()
  await templateCommand(commands(ws).deps, ['from-vdb', path.join(FIXTURES, 'vdb-44870-dna.json')])
  const project = yapProject()
  const deps = { workspace: () => ws, readDrafts: () => ({ d1: { targetId: 'p1' } }) }
  assert.equal(templateCheck(deps, 'd1', project, yapMedia), null)
  const t = JSON.parse(
    fs.readFileSync(path.join(ws, 'app/edit-templates/kathrinmormann-44870.json'), 'utf8'),
  )
  fs.writeFileSync(
    path.join(ws, 'projects/p1/agent/template.json'),
    JSON.stringify({ name: t.name, template: t }),
  )
  const report = templateCheck(deps, 'd1', project, yapMedia)
  assert.equal(report.template, 'kathrinmormann-44870')
  assert.match(report.file, /projects\/p1\/agent\/template\.json$/)
  assert.ok(report.checks.length >= 8)
  assert.ok(report.checks.every((c) => ['close', 'differs', 'info', 'na'].includes(c.status)))
})
