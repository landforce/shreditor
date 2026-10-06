import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  MAX_LUT_BYTES,
  checkCubeText,
  collectLuts,
  listLutNames,
  readCubeHeader,
  resolveLutFile,
} from './lib/luts.mjs'
import { collectEditResources } from './lib/workspace.mjs'

const CUBE = 'TITLE "Warm"\nLUT_3D_SIZE 2\n' + '0.5 0.5 0.5\n'.repeat(8)

function workspaceWith(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-luts-'))
  fs.mkdirSync(path.join(root, 'luts'))
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(root, 'luts', name), text)
  return root
}

const fails = (code) => (error) => error.code === code

test('resolveLutFile finds a .cube in luts/', () => {
  const root = workspaceWith({ 'warm.cube': CUBE })
  try {
    assert.equal(
      resolveLutFile(root, 'warm.cube'),
      path.join(fs.realpathSync(root), 'luts', 'warm.cube'),
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveLutFile refuses names that are not a single .cube file name', () => {
  const root = workspaceWith({ 'warm.cube': CUBE, 'notes.txt': 'x' })
  try {
    for (const name of ['../warm.cube', 'luts/warm.cube', '/etc/passwd', '..', ''])
      assert.throws(() => resolveLutFile(root, name), fails('INVALID_ID'), name)
    assert.throws(() => resolveLutFile(root, 'notes.txt'), fails('INVALID_LUT'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveLutFile refuses a symlink that leaves the workspace', () => {
  const root = workspaceWith()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-luts-outside-'))
  try {
    fs.writeFileSync(path.join(outside, 'secret.cube'), CUBE)
    fs.symlinkSync(path.join(outside, 'secret.cube'), path.join(root, 'luts', 'escape.cube'))
    assert.throws(() => resolveLutFile(root, 'escape.cube'), fails('PATH_OUTSIDE_ROOT'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('a missing LUT names what luts/ has', () => {
  const root = workspaceWith({ 'b.cube': CUBE, 'a.cube': CUBE })
  try {
    assert.throws(
      () => resolveLutFile(root, 'nope.cube'),
      (error) =>
        error.code === 'LUT_NOT_FOUND' &&
        error.statusCode === 404 &&
        /luts\/ has: a\.cube, b\.cube/.test(error.message),
    )
    fs.rmSync(path.join(root, 'luts'), { recursive: true })
    assert.throws(() => resolveLutFile(root, 'nope.cube'), /luts\/ is empty/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveLutFile refuses files over the size cap', () => {
  const root = workspaceWith()
  try {
    const big = path.join(root, 'luts', 'big.cube')
    fs.writeFileSync(big, '')
    fs.truncateSync(big, MAX_LUT_BYTES + 1)
    assert.throws(() => resolveLutFile(root, 'big.cube'), fails('LUT_TOO_LARGE'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('collectEditResources reads each named LUT once, alongside media', () => {
  const root = workspaceWith({ 'warm.cube': CUBE, 'other.cube': CUBE })
  try {
    const ops = [
      { op: 'addLut', itemId: 'a', lut: 'warm.cube' },
      { op: 'addLut', itemId: 'b', lut: 'warm.cube' },
      { op: 'addText', text: 'x' },
    ]
    assert.deepEqual(collectLuts(root, ops), [{ name: 'warm.cube', text: CUBE }])
    assert.deepEqual(collectEditResources(root, ops), {
      media: [],
      luts: [{ name: 'warm.cube', text: CUBE }],
    })
    assert.deepEqual(listLutNames(root), ['other.cube', 'warm.cube'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('readCubeHeader reads TITLE and size and spots 1D LUTs', () => {
  assert.deepEqual(readCubeHeader(CUBE), { title: 'Warm', size: 2, oneDimensional: false })
  assert.deepEqual(readCubeHeader('# c\nTITLE plain name\nLUT_1D_SIZE 4\n0 0 0'), {
    title: 'plain name',
    size: null,
    oneDimensional: true,
  })
})

test('checkCubeText accepts a whole 3D LUT and says why it refuses others', () => {
  assert.equal(checkCubeText(CUBE).size, 2)
  assert.throws(() => checkCubeText('LUT_1D_SIZE 2\n0 0 0\n1 1 1'), /1D LUT/)
  assert.throws(() => checkCubeText('TITLE "x"\n0 0 0'), /no LUT_3D_SIZE/)
  assert.throws(() => checkCubeText('LUT_3D_SIZE 200\n0 0 0'), /no LUT_3D_SIZE between 2 and 129/)
  assert.throws(() => checkCubeText('LUT_3D_SIZE 2\n0 0 0'), /needs 8 data lines, found 1/)
})
