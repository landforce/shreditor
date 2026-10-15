import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Kit } from './kit.mjs'
import { kitPairs, kitPath, kitValue, kitWithValues } from './set.mjs'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../kit-fixtures')
/** A value in a kit by dotted path. */
const at = (kit: Kit, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], kit)

const stock = (): Kit =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, 'stock-kit.v3.json'), 'utf8'))

test('values set by path, typed like the field they replace', () => {
  const { kit, changes } = kitWithValues(stock(), [
    ['titles.style.size', '104'],
    ['titles.style.color', '#111111'],
    ['fonts.classic.stack.0', 'TikTok Sans'],
    ['preferences.punchIns.on', 'false'],
    ['preferences.punchIns.scale', '[1.1, 1.2]'],
  ])
  assert.equal(at(kit, 'titles.style.size'), 104)
  assert.equal(at(kit, 'fonts.classic.stack.0'), 'TikTok Sans')
  assert.equal(at(kit, 'preferences.punchIns.on'), false)
  assert.deepEqual(at(kit, 'preferences.punchIns.scale'), [1.1, 1.2])
  assert.deepEqual(
    changes.map((c) => c.path),
    [
      'titles.style.size',
      'titles.style.color',
      'fonts.classic.stack.0',
      'preferences.punchIns.on',
      'preferences.punchIns.scale',
    ],
  )
  assert.deepEqual(changes[0], { path: 'titles.style.size', from: 88, to: 104 })
})

test('a string field keeps text as text; JSON parses elsewhere', () => {
  assert.equal(kitValue('700', 'x'), '700')
  assert.equal(kitValue('"quoted"', 'x'), 'quoted')
  assert.equal(kitValue('700', 400), 700)
  assert.equal(kitValue('Neue Haas', 1), 'Neue Haas')
})

test('typos and type changes are refused unless forced', () => {
  assert.throws(() => kitWithValues(stock(), [['titles.style.sise', '90']]), /not in the kit/)
  assert.throws(
    () => kitWithValues(stock(), [['titels.style.size', '90']]),
    /titels is not in the kit/,
  )
  assert.throws(() => kitWithValues(stock(), [['titles.style.size', 'big']]), /is a number/)
  assert.equal(
    at(
      kitWithValues(stock(), [['titles.style.sise', '90']], { force: true }).kit,
      'titles.style.sise',
    ),
    90,
  )
  assert.throws(() => kitWithValues(stock(), [['kitVersion', '9.0.0']]), /kept by the kit itself/)
  assert.throws(() => kitPath('titles..size'), /not a kit path/)
})

test('null switches on and off without --force', () => {
  const { kit } = kitWithValues(stock(), [
    ['titles.style.outline', '{"width":3,"color":"#000000"}'],
  ])
  assert.deepEqual(at(kit, 'titles.style.outline'), { width: 3, color: '#000000' })
  assert.equal(
    at(kitWithValues(kit, [['titles.style.outline', 'null']]).kit, 'titles.style.outline'),
    null,
  )
})

test('the result is checked against the kit schema; unchanged values are no change', () => {
  assert.throws(() => kitWithValues(stock(), [['titles.style.weight', '650']]))
  assert.deepEqual(kitWithValues(stock(), [['titles.style.size', '88']]).changes, [])
})

test('pairs come as path value or path=value', () => {
  assert.deepEqual(kitPairs(['titles.style.size', '104', 'titles.style.letterSpacing=-2']), [
    ['titles.style.size', '104'],
    ['titles.style.letterSpacing', '-2'],
  ])
  assert.deepEqual(kitPairs(['titles.style.color', 'a=b']), [['titles.style.color', 'a=b']])
  assert.throws(() => kitPairs(['titles.style.size']), /has no value/)
})
