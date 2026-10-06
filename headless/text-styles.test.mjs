import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
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
  style: { fontSize: 120 },
  version: 1,
  updatedAt: 1,
}

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
    assert.deepEqual(
      readTextStyleLibrary(root).map((style) => style.id),
      ['other'],
    )
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['text-styles.json'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('merging a pack replaces by id or name, keeps ids and bumps versions', () => {
  const merged = mergeStyles(
    [title],
    [
      { name: 'kit title', role: 'title', style: { fontSize: 140 } },
      { name: 'Kit Captions', role: 'caption', style: {} },
      { id: 'kit-title', name: 'Renamed', role: 'title', style: {} },
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
      textStyleLibrary: [title],
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
