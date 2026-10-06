import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bumpPatch, canonicalJson, kitAspect, kitRules, kitSectionFor, parseKit } from './kit.mjs'
import type { Kit } from './kit.mjs'
import { kitHash, readKitFile, resolveKitPath, writeKitFile } from './node.mjs'
import { describeKitDiff, diffKits } from './diff.mjs'
import { describeKitFonts, resolveKitFonts } from './fonts.mjs'
import {
  describePreferences,
  describeReferenceFrames,
  kitBrandColors,
  kitReferenceFrames,
  kitTargetOverrides,
  summarizeKit,
} from './report.mjs'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../kit-fixtures')
const read = (name: string): Kit =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Kit
const v2 = () => read('stock-kit.v2.json')
const v3 = () => read('stock-kit.v3.json')

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-'))
}

test('both stock kits load, keep unknown fields and list every rule', () => {
  for (const kit of [v2(), v3()]) {
    const { kit: parsed, warnings } = parseKit({ ...kit, somethingNew: { a: 1 } })
    assert.deepEqual(warnings, [])
    assert.deepEqual(parsed.somethingNew, { a: 1 })
    assert.equal(kitAspect(parsed), '9:16')
  }
  const ids = kitRules(v3()).map((rule) => rule.id)
  assert.ok(ids.includes('title.clear-rail') && ids.includes('image.clear-title'))
  assert.equal(kitRules(v3()).find((r) => r.id === 'title.top-half')?.section, 'titles')
})

test('missing required parts fail with every problem named', () => {
  const kit = v3() as Record<string, unknown>
  delete kit.kitVersion
  delete kit.canvas
  ;(kit.titles as { style: { weight: number } }).style.weight = 650
  delete (kit.captions as Record<string, unknown>).placement
  ;(kit.overlays as { must: unknown[] }).must.push({ text: 'no id' })
  assert.throws(
    () => parseKit(kit, { source: 'kit.json' }),
    (error: Error & { problems?: string[] }) => {
      assert.match(error.message, /^kit\.json: not a usable kit\.json/)
      const problems = error.problems ?? []
      for (const part of [
        'kitVersion',
        'canvas',
        'titles.style.weight',
        'captions.placement',
        'overlays.must[4].id',
      ])
        assert.ok(
          problems.some((p) => p.startsWith(part)),
          `${part} in ${problems.join(' | ')}`,
        )
      return true
    },
  )
  assert.throws(() => parseKit([]), /not a JSON object/)
  assert.deepEqual(parseKit({ ...v3(), schemaVersion: 3 }).warnings.length, 1)
})

test('the hash ignores formatting and key order, and changes with any value', () => {
  const kit = v3()
  const shuffled = Object.fromEntries(Object.entries(kit).reverse()) as Kit
  assert.equal(kitHash(kit), kitHash(shuffled))
  assert.equal(canonicalJson({ b: 1, a: [1, { d: 2, c: undefined }] }), '{"a":[1,{"d":2}],"b":1}')
  const changed = v3()
  ;(changed.titles.style as { size: number }).size = 90
  assert.notEqual(kitHash(changed), kitHash(kit))
  assert.match(kitHash(kit), /^sha256:[0-9a-f]{64}$/)
})

test('a kit folder reads its kit.json; writes are atomic and drift shows as a diff', () => {
  const dir = tempDir()
  const file = path.join(dir, 'kit.json')
  fs.copyFileSync(path.join(FIXTURES, 'stock-kit.v3.json'), file)
  assert.equal(resolveKitPath(dir), file)
  const first = readKitFile(dir)
  const changed = structuredClone(first.kit)
  ;(changed.titles.style as { size: number }).size = 92
  writeKitFile(file, changed)
  assert.deepEqual(fs.readdirSync(dir), ['kit.json'])
  const second = readKitFile(file)
  assert.notEqual(second.hash, first.hash)
  const changes = diffKits(first.kit, second.kit)
  assert.deepEqual(changes, [{ path: 'titles.style.size', from: 88, to: 92 }])
  assert.deepEqual(describeKitDiff(changes), ['titles.style.size: 88 -> 92'])
  assert.throws(() => resolveKitPath(path.join(dir, 'missing')), /No kit at/)
  assert.throws(() => resolveKitPath(FIXTURES), /without a kit\.json/)
})

test('v2 -> v3 diff names the title changes', () => {
  const paths = diffKits(v2(), v3()).map((c) => c.path)
  for (const p of [
    'kitVersion',
    'titles.style.size',
    'titles.style.sizeSmall',
    'titles.placement.width',
  ])
    assert.ok(paths.includes(p), p)
})

test('16:9 variants merge over the section with a landscape canvas', () => {
  const kit = v3()
  assert.equal(kitSectionFor(kit, 'titles', '16:9'), undefined)
  kit.titles.variants = { '16:9': { style: { size: 64 }, placement: { y: 120 } } }
  const view = kitSectionFor(kit, 'titles', '16:9')!
  assert.deepEqual(view.canvas, { width: 1920, height: 1080 })
  assert.equal((view.section.style as { size: number }).size, 64)
  assert.equal((view.section.style as { color: string }).color, '#000000')
  assert.equal((view.section.placement as { y: number; x: number }).y, 120)
  assert.equal((view.section.placement as { x: number }).x, 70)
  assert.equal(bumpPatch('0.3.0'), '0.3.1')
  assert.equal(bumpPatch('1.2.9-beta'), '1.2.10')
})

test('fonts resolve to the first family that renders here, with licences', () => {
  const kit = v3()
  const fonts = resolveKitFonts(kit, {
    installed: new Set(['arial']),
    catalog: new Set(['figtree']),
  })
  assert.equal(fonts.classic!.family, 'Figtree')
  assert.equal(fonts.classic!.source, 'catalog')
  const lines = describeKitFonts(fonts)
  assert.match(lines[0]!, /^classic: Figtree \(from Shreditor's font catalog/)
  assert.ok(lines.some((l) => /Instagram Sans: missing, licence: Personal use only/.test(l)))
  const installed = resolveKitFonts(kit, {
    installed: new Set(['instagram sans']),
    catalog: new Set(),
  })
  assert.equal(installed.classic!.family, 'Instagram Sans')
  assert.equal(installed.classic!.source, 'installed')
  const none = resolveKitFonts(kit, { installed: new Set(), catalog: new Set() })
  assert.equal(none.classic!.source, 'missing')
  assert.equal(none.classic!.family, 'Figtree')
})

test('preferences in words, the pause target they replace, brand colours', () => {
  const kit = v3()
  const lines = describePreferences(kit.preferences)
  assert.match(lines[1]!, /no pause over 300 ms/)
  assert.deepEqual(kitTargetOverrides(kit).pauseMaxSec?.max, 0.3)
  kit.preferences!.tightCuts!.on = false
  assert.deepEqual(kitTargetOverrides(kit).pauseMaxSec?.max, 0.8)
  kit.preferences!.musicBed = { on: true, source: 'bed.wav', levelDb: -22, duckDb: -6 }
  assert.match(
    describePreferences(kit.preferences).join('\n'),
    /-22 dB under the voice in gaps, -28 dB while the voice speaks.*duckOthersDb: -6/,
  )
  assert.deepEqual(kitBrandColors(kit), [])
  kit.preferences!.brandColors = {
    on: true,
    colors: [{ hex: '#FF0055', job: 'accent' }, { hex: 'red' }],
  }
  assert.deepEqual(kitBrandColors(kit), [{ hex: '#FF0055', job: 'accent' }])
  assert.ok(summarizeKit(kit).some((line) => line.includes('title.clear-rail')))
})

test('reference frames read both forms; placeholders are never to compare against', () => {
  const frames = kitReferenceFrames(v3())
  assert.ok(frames.every((frame) => frame.placeholder === true))
  assert.equal(frames.filter((frame) => frame.format === 'greenscreen').length, 6)
  assert.ok(!frames.some((frame) => frame.format === 'note'))
  const old = kitReferenceFrames(v2())
  assert.equal(old[0]!.placeholder, null)
  const kit = v3()
  kit.referenceFrames = { 'graphic-yap': { path: 'frames/real.jpg', placeholder: false } }
  assert.deepEqual(describeReferenceFrames(kit, '/kits/me'), [
    "graphic-yap: /kits/me/frames/real.jpg (the creator's frame: compare your frames against it)",
  ])
  assert.match(describeReferenceFrames(v3())[0]!, /placeholder: don't compare/)
})
