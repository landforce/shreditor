import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  builtinTextStyles,
  collectTextStyleInput,
  findStyle,
  mergeStyles,
  readTextStyleLibrary,
  textStylePackSchema,
  updateTextStyleLibrary,
} from './lib/text-styles.mjs'
import { collectEditResources } from './lib/workspace.mjs'

const title = {
  id: 'kit-title',
  name: 'Kit Title',
  role: 'title',
  variants: [{ aspect: '9:16', style: { fontSize: 120 } }],
  version: 1,
  updatedAt: 1,
}
const BUILTIN_IDS = builtinTextStyles().map((style) => style.id)
const libraryFile = (root) => path.join(root, 'app', 'text-styles.json')
const ownIds = (styles) => styles.map((s) => s.id).filter((id) => !BUILTIN_IDS.includes(id))

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shred-styles-'))
}

test('the library is written atomically and re-read on every change', () => {
  const root = workspace()
  try {
    updateTextStyleLibrary(root, (styles) => [...styles, title])
    // Someone else (the editor) adds a style between our reads.
    const file = path.join(root, 'app', 'text-styles.json')
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    onDisk.styles.push({ ...title, id: 'other', name: 'Other' })
    fs.writeFileSync(file, JSON.stringify(onDisk))
    updateTextStyleLibrary(root, (styles) => styles.filter((style) => style.id !== 'kit-title'))
    assert.deepEqual(ownIds(readTextStyleLibrary(root)), ['other'])
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['text-styles.json'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a fresh library is seeded with the built-in styles once', () => {
  const root = workspace()
  try {
    const seeded = readTextStyleLibrary(root)
    assert.equal(seeded.length, 18)
    assert.deepEqual(
      seeded.map((style) => style.id),
      BUILTIN_IDS,
    )
    for (const style of seeded)
      assert.deepEqual(
        style.variants.map((variant) => variant.aspect),
        ['9:16', '16:9'],
      )
    assert.equal(JSON.parse(fs.readFileSync(libraryFile(root), 'utf8')).seeded, 1)
    // Deleting a built-in does not bring it back.
    updateTextStyleLibrary(root, (styles) => styles.filter((style) => style.id !== 'poster'))
    assert.equal(findStyle(readTextStyleLibrary(root), 'poster'), undefined)
    assert.equal(readTextStyleLibrary(root).length, 17)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('an old library becomes families, keeps its styles and gets the built-ins', () => {
  const root = workspace()
  try {
    fs.mkdirSync(path.dirname(libraryFile(root)), { recursive: true })
    const old = {
      id: 'mine',
      name: 'Clean',
      role: 'title',
      style: { fontSize: 90 },
      version: 4,
      updatedAt: 1,
    }
    fs.writeFileSync(libraryFile(root), JSON.stringify({ version: 1, styles: [old] }))
    const styles = readTextStyleLibrary(root)
    assert.deepEqual(findStyle(styles, 'mine').variants, [
      { aspect: '9:16', style: { fontSize: 90 } },
    ])
    // The user's "Clean" keeps its name; the built-in Clean is not added beside it.
    assert.equal(findStyle(styles, 'clean-title'), undefined)
    assert.equal(styles.length, 18)
    const file = JSON.parse(fs.readFileSync(libraryFile(root), 'utf8'))
    assert.deepEqual([file.version, file.seeded, file.styles[0].variants?.length], [2, 1, 1])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('merging a pack replaces by id or name, keeps ids, variants and bumps versions', () => {
  const merged = mergeStyles(
    [title],
    [
      { name: 'kit title', role: 'title', aspect: '16:9', style: { fontSize: 100 } },
      { name: 'Kit Captions', role: 'caption', style: {} },
      {
        id: 'kit-title',
        name: 'Renamed',
        role: 'title',
        variants: [{ aspect: '9:16', style: { fontSize: 140 } }],
      },
    ],
    9,
  )
  assert.deepEqual(
    merged.map((style) => [style.id, style.name, style.version]),
    [
      ['kit-title', 'Renamed', 3],
      ['kit-captions', 'Kit Captions', 1],
    ],
  )
  // Each merge replaced its own aspect's look; the other stayed.
  assert.deepEqual(
    merged[0].variants.map((variant) => [variant.aspect, variant.style.fontSize]),
    [
      ['9:16', 140],
      ['16:9', 100],
    ],
  )
  assert.deepEqual(merged[1].variants[0].aspect, '9:16')
  assert.equal(findStyle(merged, 'KIT CAPTIONS')?.id, 'kit-captions')
  assert.equal(
    textStylePackSchema.safeParse({ kind: 'shreditor-text-styles', version: 1, styles: [title] })
      .success,
    true,
  )
  assert.equal(
    textStylePackSchema.safeParse({ kind: 'shreditor-text-styles', version: 1, styles: [] })
      .success,
    false,
  )
  const twice = { ...title, variants: [...title.variants, ...title.variants] }
  assert.equal(
    textStylePackSchema.safeParse({ kind: 'shreditor-text-styles', version: 1, styles: [twice] })
      .success,
    false,
  )
})

test('style ops get the library styles they name and the clip transcripts', () => {
  const root = workspace()
  try {
    updateTextStyleLibrary(root, () => [title])
    const mediaId = 'media-1'
    const dir = path.join(root, 'media', mediaId, 'cache', 'ai')
    fs.mkdirSync(dir, { recursive: true })
    const segments = [{ text: 'hi', start: 0, end: 1, words: [{ text: 'hi', start: 0, end: 1 }] }]
    fs.writeFileSync(
      path.join(dir, 'transcript.json'),
      JSON.stringify({ service: 'whisper.cpp', data: { segments } }),
    )
    const project = {
      timeline: { items: [{ id: 'clip', type: 'video', mediaId }], textStyles: [] },
    }
    const ops = [
      { op: 'addText', text: 'x', styleId: 'Kit Title' },
      { op: 'addCaptions', clipId: 'clip', styleId: 'kit-title' },
    ]
    assert.deepEqual(collectTextStyleInput(root, project, ops), {
      textStyleLibrary: [{ ...title, updatedAt: 1 }],
      transcripts: [{ mediaId, segments }],
    })
    assert.equal(collectEditResources(root, ops, project).transcripts?.length, 1)
    // A project that already has the style needs nothing from the library.
    assert.deepEqual(
      collectTextStyleInput(root, { timeline: { items: [], textStyles: [title] } }, [ops[0]]),
      {},
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
