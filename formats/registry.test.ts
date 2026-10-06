import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHOOSING_GUIDE,
  FORMAT_IDS,
  FORMAT_ROLES,
  FORMATS,
  STRUCTURE_ROLES,
  createFormatTracks,
  getFormat,
  projectFormat,
  projectFormatRecord,
  resolveFormat,
} from './registry.mjs'
import { suggestFormat } from './suggest.mjs'
import type { FootageEntry } from './suggest.mjs'
import type { FormatTarget, ResolvedFormat } from './registry.mjs'
import { hasForbiddenWord, readVendoredHash } from '../scripts/sync-formats.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => fs.readFileSync(path.join(REPO, file), 'utf8')

test('the four formats, each 9:16 1080x1920', () => {
  assert.deepEqual([...FORMAT_IDS], ['graphic-yap', 'greenscreen', 'vlog', 'ten-shot'])
  for (const format of FORMATS) {
    assert.deepEqual({ ...format.canvas }, { width: 1080, height: 1920, fps: 30 })
    assert.ok(format.name && format.tagline && format.description && format.useWhen)
    assert.ok(format.checklist.length >= 4)
  }
})

test('every format and variant resolves; unknown ones throw', () => {
  for (const format of FORMATS) {
    const base = resolveFormat(format.id)
    assert.equal(base.variant?.id ?? null, format.defaultVariant)
    for (const variant of format.variants) {
      const resolved = resolveFormat(format.id, variant.id)
      assert.equal(resolved.variant?.id, variant.id)
      const keys = resolved.targets.map((target) => target.key)
      assert.equal(
        new Set(keys).size,
        keys.length,
        `${format.id}/${variant.id} target keys are unique`,
      )
    }
  }
  assert.throws(() => resolveFormat('yap'), /Unknown format "yap"/)
  assert.throws(() => resolveFormat('vlog', 'medium'), /Unknown variant "medium" for Vlog/)
  assert.throws(() => resolveFormat('greenscreen', 'fast'), /Variants: none/)
})

test('formats are found by id, name and common aliases', () => {
  assert.equal(getFormat('10 Shot')?.id, 'ten-shot')
  assert.equal(getFormat('ten shot')?.id, 'ten-shot')
  assert.equal(getFormat('Graphic Yap')?.id, 'graphic-yap')
  assert.equal(getFormat('Greenscreen Talking Head')?.id, 'greenscreen')
  assert.equal(getFormat('nope'), undefined)
  assert.equal(getFormat(undefined), undefined)
})

test('variant overrides merge into the base targets, rules and checklist', () => {
  const standard = resolveFormat('graphic-yap')
  const intense = resolveFormat('graphic-yap', 'intense')
  const byKey = (format: ResolvedFormat, key: string): FormatTarget => {
    const found = format.targets.find((target) => target.key === key)
    assert.ok(found, `${format.id} has ${key}`)
    return found
  }
  assert.equal(standard.variant?.id, 'standard')
  assert.deepEqual(
    [byKey(standard, 'imagesPerMin').min, byKey(standard, 'imagesPerMin').max],
    [17, 22],
  )
  assert.equal(byKey(intense, 'imagesPerMin').min, 27)
  assert.equal(byKey(intense, 'visualChangesPerMin').min, 43)
  assert.ok(!standard.targets.some((target) => target.key === 'visualChangesPerMin'))
  assert.ok(intense.checklist.length > standard.checklist.length)

  const fast = resolveFormat('vlog', 'fast')
  const slow = resolveFormat('vlog', 'slow')
  assert.equal(byKey(fast, 'cutsPerMin').min, 41)
  assert.equal(byKey(slow, 'cutsPerMin').max, 26)
  assert.ok(
    !resolveFormat('vlog').targets.some((target) => target.key === 'medianShotSec'),
    'pooled base has no median target',
  )
  assert.equal(byKey(slow, 'finalShotSec').ideal, 7.5)

  const shaped = resolveFormat('ten-shot', 'shaped')
  assert.deepEqual(
    [byKey(shaped, 'finalShotRatio').min, byKey(shaped, 'finalShotRatio').max],
    [1.1, 2.6],
  )
  assert.equal(byKey(resolveFormat('ten-shot'), 'finalShotRatio').min, null)
  // Definitions are frozen; resolving never mutates them.
  assert.ok(Object.isFrozen(FORMATS[0]?.targets[0]))
})

// The numbers each format's guide states, by target key: [min, max] (null = open).
const EXPECTED = {
  'graphic-yap': {
    lengthSec: [40, 80],
    imagesPerMin: [17, null],
    imageOnScreenSec: [1.2, 2.4],
    imageGapSec: [1.3, 2.4],
    firstImageSec: [null, 2],
    longestNoNewImageSec: [null, 5],
    speechWpm: [160, 270],
    pauseMaxSec: [null, 1],
  },
  greenscreen: {
    lengthSec: [20, 65],
    plateChangesPerMin: [8, null],
    visualChangesPerMin: [16, 18],
    medianChangeGapSec: [2.6, 3],
    speechWpm: [198, 265],
    plateCoveragePct: [100, null],
    firstPlateChangeSec: [null, 3],
    pauseMaxSec: [null, 0.5],
  },
  vlog: {
    lengthSec: [41, 178],
    shotCount: [19, 109],
    cutsPerMin: [11, 63],
    longestShotSec: [2.3, 16],
    firstCutSec: [null, 1.5],
    voStartSec: [null, 0.25],
    voCoveragePct: [98, null],
    speechWpm: [152, 244],
    pauseMaxSec: [null, 0.5],
  },
  'ten-shot': {
    lengthSec: [13, 15],
    shotCount: [12, 16],
    shotCountMin: [8, null],
    cutsPerMin: [null, null],
    titleWords: [5, 7],
    labelCount: [null, 2],
    graphicsCount: [null, 0],
  },
}

test('targets match the numbers in the guides', () => {
  for (const [id, expected] of Object.entries(EXPECTED)) {
    const format = getFormat(id)
    assert.ok(format)
    for (const [key, [min, max]] of Object.entries(expected)) {
      const target: FormatTarget | undefined = format.targets.find((c) => c.key === key)
      assert.ok(target, `${id}.${key} exists`)
      assert.deepEqual([target.min, target.max], [min, max], `${id}.${key}`)
    }
  }
  // Every number a target carries appears in its vendored guide or research.
  const numberIn = (text: string, value: number) => {
    const pattern = String(value).replace('.', '\\.')
    return new RegExp(`(^|[^\\d.])${pattern}(?![\\d])`).test(text)
  }
  for (const format of FORMATS) {
    const text = `${read(format.guide.path)}\n${read(format.guide.research)}`
    const variants = format.variants.flatMap((v) => Object.values(v.overrides.targets ?? {}))
    const targets = [...format.targets, ...variants].filter(Boolean) as Partial<FormatTarget>[]
    for (const target of targets) {
      for (const field of ['min', 'max', 'ideal'] as const) {
        const value = target[field]
        if (typeof value === 'number') {
          assert.ok(
            numberIn(text, value),
            `${format.id} ${target.key ?? ''}.${field} = ${value} is in the guide`,
          )
        }
      }
    }
  }
})

test('rules follow the guides', () => {
  const rules = (id: string) => getFormat(id)!.rules
  for (const format of FORMATS) {
    assert.equal(format.rules.titleHook.required, true, `${format.id}: always a title hook`)
    assert.equal(format.rules.titleHook.fromSec, 0)
    assert.equal(format.rules.transitions, 'none')
  }
  assert.equal(rules('ten-shot').captions, 'none')
  assert.equal(rules('ten-shot').speech, 'none')
  assert.equal(rules('ten-shot').music, 'required')
  assert.equal(rules('ten-shot').syncSound, 'none')
  assert.equal(rules('vlog').voiceover, 'required')
  assert.equal(rules('vlog').captions, 'required')
  assert.equal(rules('greenscreen').music, 'none')
  assert.equal(rules('greenscreen').voiceover, 'none')
  assert.deepEqual({ ...rules('vlog').titleHook.holdSec }, { min: 3, max: 5 })
  assert.deepEqual({ ...rules('ten-shot').titleHook.holdSec }, { min: 1.9, max: 4.8 })
})

test('track layouts: valid roles, video lanes above audio, layout tracks with formatRole', () => {
  for (const format of FORMATS) {
    const kinds = format.tracks.map((track) => track.kind)
    assert.equal(
      kinds.indexOf('audio'),
      kinds.lastIndexOf('video') + 1,
      `${format.id}: video then audio`,
    )
    for (const track of format.tracks) assert.ok(FORMAT_ROLES.includes(track.role))
    const tracks = createFormatTracks(format.id)
    assert.deepEqual(
      tracks.map((track) => [track.id, track.order, track.formatRole]),
      format.tracks.map((spec, index) => [
        `track-${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        index,
        spec.role,
      ]),
    )
    assert.equal(new Set(tracks.map((track) => track.id)).size, tracks.length)
  }
  const custom = createFormatTracks('vlog', { idFor: (_, index) => `t${index}`, height: 80 })
  assert.equal(custom[0]?.id, 't0')
  assert.equal(custom[0]?.height, 80)
  assert.throws(() => createFormatTracks('nope'), /Unknown format/)
})

test('project format record and lookup', () => {
  const record = projectFormatRecord('vlog', 'fast')
  assert.deepEqual(record, {
    id: 'vlog',
    variant: 'fast',
    reviewedHash: getFormat('vlog')?.guide.reviewedHash,
  })
  assert.deepEqual(projectFormatRecord('graphic-yap').variant, 'standard')
  assert.equal(projectFormat({ format: record })?.variant?.id, 'fast')
  assert.equal(projectFormat({}), null)
  assert.equal(projectFormat({ format: { id: 'gone' as never } }), null)
})

test('vendored guides: present, clean, and the hash the targets were reviewed against', () => {
  for (const format of FORMATS) {
    const guide = read(format.guide.path)
    assert.equal(readVendoredHash(guide), format.guide.reviewedHash, `${format.id} guide reviewed`)
    assert.ok(guide.includes(format.guide.source))
    assert.ok(readVendoredHash(read(format.guide.research)))
    assert.equal(hasForbiddenWord(guide), false)
    assert.equal(hasForbiddenWord(read(format.guide.research)), false)
  }
  assert.equal(readVendoredHash(read(CHOOSING_GUIDE.path)), CHOOSING_GUIDE.reviewedHash)
})

test('format suggestion follows the decision guide', () => {
  const head: FootageEntry = { kind: 'video', speech: 'so here is the thing' }
  const broll: FootageEntry = { kind: 'video', speech: null }
  const vo: FootageEntry = { kind: 'audio', speech: 'we started with the walls' }
  const music: FootageEntry = { kind: 'audio', speech: null }
  const suggest = (entries: FootageEntry[]) => {
    const suggestion = suggestFormat(entries)
    assert.ok(suggestion, 'a suggestion')
    return suggestion
  }
  assert.equal(suggest([head, head]).id, 'graphic-yap')
  assert.deepEqual(suggest([head, broll]).alternatives, ['vlog'])
  assert.equal(suggest([{ ...head, greenShare: 0.6 }]).id, 'greenscreen')
  assert.equal(suggest([{ ...head, alpha: true }]).id, 'greenscreen')
  assert.equal(suggest([vo, broll, broll, music]).id, 'vlog')
  const tenShot = suggest([broll, broll, broll, music])
  assert.equal(tenShot.id, 'ten-shot')
  assert.match(tenShot.reason, /music \(1\)/)
  assert.match(suggest([broll]).reason, /no music yet/)
  // Categories set by the agent win over the probe.
  assert.equal(suggest([{ kind: 'video', speech: null, category: 'speaker' }]).id, 'graphic-yap')
  const stills = suggest([head, { kind: 'image' }, { kind: 'image' }])
  assert.equal(stills.id, 'graphic-yap')
  assert.deepEqual(stills.alternatives, [], 'images are not b-roll')
  assert.equal(stills.signals.stills, 2)
  assert.equal(suggestFormat([music]), null)
  assert.equal(suggestFormat([]), null)
})

test("each format's story structure opens on the hook and keeps story order", () => {
  for (const format of FORMATS) {
    const roles = format.structure.map((part) => part.role)
    assert.equal(roles[0], 'hook', format.id)
    const order = roles.map((role) => STRUCTURE_ROLES.indexOf(role))
    assert.ok(
      order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]!)),
      format.id,
    )
    assert.ok(
      format.structure.some((part) => part.role === 'body' && part.required),
      format.id,
    )
    // Every section is named in the guide's own Structure list.
    const guide = read(format.guide.path)
    for (const part of format.structure)
      assert.ok(guide.includes(part.name.split(' ')[0]!), part.name)
  }
})
