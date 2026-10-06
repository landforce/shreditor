import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Kit } from './kit.mjs'
import {
  anchorBoxToLayout,
  fontWeightFromKit,
  kitTextStyles,
  kitWeightFromFontWeight,
  layoutToAnchorBox,
} from './mapping.mjs'
import { kitWithStyles, withChangelogEntry } from './save-back.mjs'
import { normalizeTextStyleInput } from '@/shared/typography/text-styles/text-style-schema'
import { buildApplyTextStyleUpdates } from '@/shared/typography/text-styles/text-style-resolve'
import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../kit-fixtures')
const v3 = (): Kit =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, 'stock-kit.v3.json'), 'utf8')) as Kit
const familyFor = () => 'Figtree'
const VERTICAL = { width: 1080, height: 1920 }
const LANDSCAPE = { width: 1920, height: 1080 }

const styleOf = (kit: Kit, id: string) =>
  kitTextStyles(kit, { familyFor }).find((s) => s.id === id)!
const variant = (kit: Kit, id: string, aspect = '9:16') =>
  styleOf(kit, id).variants.find((v) => v.aspect === aspect)!

test('weights map both ways', () => {
  assert.deepEqual([400, 500, 600, 700].map(fontWeightFromKit), [
    'normal',
    'medium',
    'semibold',
    'bold',
  ])
  assert.deepEqual(
    ['normal', 'medium', 'semibold', 'bold'].map(kitWeightFromFontWeight),
    [400, 500, 600, 700],
  )
  assert.equal(kitWeightFromFontWeight(undefined), 400)
})

test('anchors become box centres from the canvas centre, and back', () => {
  const box = { x: 70, width: 860, y: 320, height: 640 }
  const top = anchorBoxToLayout({ ...box, anchor: 'top' }, VERTICAL)
  assert.deepEqual(top, {
    xRatio: -0.037037,
    yRatio: -0.166667,
    widthRatio: 0.796296,
    heightRatio: 0.333333,
  })
  assert.equal(
    anchorBoxToLayout({ ...box, anchor: 'center' }, VERTICAL).yRatio,
    round6((320 - 960) / 1920),
  )
  assert.equal(
    anchorBoxToLayout({ ...box, anchor: 'bottom' }, VERTICAL).yRatio,
    round6((320 - 320 - 960) / 1920),
  )
  for (const anchor of ['top', 'center', 'bottom'])
    assert.deepEqual(
      layoutToAnchorBox(anchorBoxToLayout({ ...box, anchor }, VERTICAL), anchor, VERTICAL),
      {
        x: 70,
        width: 860,
        y: 320,
      },
    )
  const wide = anchorBoxToLayout({ ...box, anchor: 'top' }, LANDSCAPE)
  assert.deepEqual(layoutToAnchorBox(wide, 'top', LANDSCAPE), { x: 70, width: 860, y: 320 })
})

const round6 = (value: number) => Math.round(value * 1e6) / 1e6

test('kit:title: per-line white bars, split padding, top-anchored box to the zone edge', () => {
  const title = variant(v3(), 'kit:title')
  assert.deepEqual(title.style, {
    fontFamily: 'Figtree',
    fontWeight: 'bold',
    fontStyle: 'normal',
    underline: false,
    fontSize: 88,
    color: '#000000',
    letterSpacing: -1,
    lineHeight: 1.2,
    textAlign: 'center',
    verticalAlign: 'top',
    backgroundColor: '#FFFFFF',
    backgroundRadius: 16,
    backgroundMode: 'lines',
    textPadding: 4,
    textPaddingX: 29,
    textPaddingY: 4,
  })
  // x 70, width 860, top 320, to the zone's bottom (960): 640 tall.
  assert.deepEqual(layoutToAnchorBox(title.layout!, 'top', VERTICAL), { x: 70, width: 860, y: 320 })
  assert.equal(Math.round(title.layout!.heightRatio! * 1920), 640)
  assert.equal(styleOf(v3(), 'kit:title').role, 'title')
  assert.match(styleOf(v3(), 'kit:title').description!, /use 72px when it wraps past 3 lines/)
})

test('kit:caption and kit:caption-low: outline as padding, chunking rules, both positions', () => {
  const caption = variant(v3(), 'kit:caption')
  assert.deepEqual(caption.style.stroke, { width: 10, color: '#000000', join: 'round' })
  assert.equal(caption.style.textPadding, 10)
  assert.equal(caption.style.backgroundColor, undefined)
  assert.deepEqual(caption.caption, {
    maxWordsPerChunk: 3,
    maxCharsPerLine: 23,
    maxLines: 1,
    minChunkFrames: 9,
    case: 'as-is',
    punctuation: 'keep',
  })
  assert.equal(layoutToAnchorBox(caption.layout!, 'top', VERTICAL).y, 720)
  assert.equal(layoutToAnchorBox(variant(v3(), 'kit:caption-low').layout!, 'top', VERTICAL).y, 1250)
  // One line at 64 x 1.1 plus 10 padding and 10 outline each side: the renderer won't grow it.
  assert.equal(Math.round(caption.layout!.heightRatio! * 1920), 110)
})

test('overlays, the listicle headline and the emphasis label', () => {
  const kit = v3()
  const overlay = variant(kit, 'kit:overlay')
  assert.equal(overlay.style.fontWeight, 'semibold')
  assert.equal(overlay.style.verticalAlign, 'middle')
  assert.equal(overlay.layout!.yRatio, 0)
  const listicle = variant(kit, 'kit:listicle-headline')
  assert.equal(listicle.style.fontSize, 72)
  assert.equal(listicle.style.textAlign, 'left')
  assert.deepEqual(layoutToAnchorBox(listicle.layout!, 'center', VERTICAL), {
    x: 150,
    width: 780,
    y: 960,
  })
  assert.equal(styleOf(kit, 'kit:listicle-headline').role, 'label')
  const emphasis = styleOf(kit, 'kit:emphasis')
  assert.equal(emphasis.role, 'label')
  assert.equal(emphasis.variants[0]!.style.backgroundMode, 'lines')
})

test('16:9: the section variant when the kit has one, else the editor clone', () => {
  const kit = v3()
  const cloned = variant(kit, 'kit:title', '16:9')
  assert.equal(cloned.style.fontSize, 88)
  assert.equal(Math.round(cloned.layout!.widthRatio! * 1920), 860)
  kit.titles.variants = {
    '16:9': { style: { size: 64 }, placement: { y: 100, x: 460, width: 1000 } },
  }
  const own = variant(kit, 'kit:title', '16:9')
  assert.equal(own.style.fontSize, 64)
  assert.deepEqual(layoutToAnchorBox(own.layout!, 'top', LANDSCAPE), {
    x: 460,
    width: 1000,
    y: 100,
  })
})

const stored = (input: ReturnType<typeof styleOf>) =>
  normalizeTextStyleInput(input, [], { now: 1 }) as TextStyleDefinition

test('every kit style is a valid stored style and styles a title as the kit says', () => {
  const styles = kitTextStyles(v3(), { familyFor }).map(stored)
  assert.equal(styles.length, 6)
  const title = styles.find((s) => s.id === 'kit:title')!
  const item = {
    id: 't',
    type: 'text',
    trackId: 'x',
    from: 0,
    durationInFrames: 90,
    label: '',
    text: 'Hi',
    color: '#fff',
  } as TextItem
  const updates = buildApplyTextStyleUpdates(item, title, VERTICAL)
  assert.equal(updates.fontSize, 88)
  assert.equal(updates.textPaddingX, 29)
  assert.equal(updates.backgroundMode, 'lines')
  // Box 70-930 (clear of the rail): its centre is 40 px left of the canvas centre.
  assert.deepEqual(updates.transform, { x: -40, y: -320, width: 860, height: 640 })
  // On a 720x1280 canvas everything scales by 2/3.
  const small = buildApplyTextStyleUpdates(item, title, { width: 720, height: 1280 })
  assert.equal(small.textPaddingX, 19.33)
  assert.equal(small.fontSize, 58.67)
})

test('a changed kit restyles: the mapped look follows the kit value', () => {
  const kit = v3()
  ;(kit.titles.style as { size: number }).size = 92
  const before = stored(styleOf(v3(), 'kit:title'))
  const after = normalizeTextStyleInput(styleOf(kit, 'kit:title'), [before], { now: 2 })
  assert.equal(after.version, 2)
  assert.equal(after.variants.find((v) => v.aspect === '9:16')!.style.fontSize, 92)
})

test('save-back: no change round-trips to no diff; tweaks land in kit units with a changelog entry', () => {
  const kit = v3()
  const styles = kitTextStyles(kit, { familyFor })
  const same = kitWithStyles(kit, styles, { familyFor })
  assert.deepEqual(same.changes, [])
  assert.deepEqual(same.kit, kit)

  const tweaked = structuredClone(styles)
  const title = tweaked.find((s) => s.id === 'kit:title')!.variants[0]!
  title.style.fontSize = 96
  title.style.fontWeight = 'semibold'
  title.style.textPaddingX = 36
  title.layout!.yRatio! += 20 / 1920
  const low = tweaked.find((s) => s.id === 'kit:caption-low')!.variants[0]!
  low.layout!.yRatio! -= 50 / 1920
  const caption = tweaked.find((s) => s.id === 'kit:caption')!.variants[0]!
  caption.style.fontFamily = 'Inter'
  const result = kitWithStyles(kit, tweaked, { familyFor })
  assert.deepEqual(
    result.changes.map((c) => [c.path, c.from, c.to]),
    [
      ['titles.style.size', 88, 96],
      ['titles.style.weight', 700, 600],
      ['titles.style.box.padX', 29, 36],
      ['titles.placement.y', 320, 340],
      ['captions.placement.positions.belowChin.y', 1250, 1200],
    ],
  )
  assert.ok(result.notes.some((n) => /font family "Inter" not written/.test(n)))
  const saved = withChangelogEntry(result.kit, result.changes, {
    now: new Date('2026-10-07T10:00:00Z'),
  })
  assert.equal(saved.kitVersion, '0.3.1')
  assert.equal(saved.updatedAt, '2026-10-07T10:00:00Z')
  assert.deepEqual(saved.changelog!.at(-1), {
    date: '2026-10-07',
    version: '0.3.1',
    change:
      'titles.style.size 88 -> 96; titles.style.weight 700 -> 600; titles.style.box.padX 29 -> 36; titles.placement.y 320 -> 340; captions.placement.positions.belowChin.y 1250 -> 1200',
    why: 'from Shreditor',
  })
  // The saved kit maps back to the tweaked looks (round trip).
  assert.deepEqual(
    kitWithStyles(saved, kitTextStyles(saved, { familyFor }), { familyFor }).changes,
    [],
  )
})

test('save-back adds a box or removes an outline when the style does', () => {
  const kit = v3()
  const styles = kitTextStyles(kit, { familyFor })
  const caption = styles.find((s) => s.id === 'kit:caption')!.variants[0]!.style
  delete caption.stroke
  caption.backgroundColor = '#000000'
  caption.backgroundMode = 'text'
  caption.textPadding = 12
  const { changes } = kitWithStyles(kit, styles, { familyFor })
  assert.deepEqual(
    changes.map((c) => c.path),
    ['captions.style.outline', 'captions.style.box'],
  )
  assert.deepEqual(changes[1]!.to, {
    color: '#000000',
    radius: 0,
    padX: 12,
    padY: 12,
    perLine: false,
  })
})
