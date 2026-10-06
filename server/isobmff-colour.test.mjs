import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isCompleteColour, readContainerColour } from './isobmff-colour.mjs'

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { timeout: 30_000 })

test('reads the first video track colr box of MP4 and MOV files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shreditor-colr-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const src = ['-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10:d=0.2', '-f', 'lavfi', '-i', 'sine=d=0.2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest']
  const tags = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt470bg', '-color_range', 'pc']
  const plain = path.join(dir, 'plain.mp4')
  ffmpeg(...src, plain)
  // Container tags only, as the compatibility rewrap writes them.
  const file = (name, ...extra) => {
    const out = path.join(dir, name)
    ffmpeg('-i', plain, '-c', 'copy', ...extra, out)
    return out
  }
  assert.deepEqual(readContainerColour(plain), [])
  const mp4 = readContainerColour(file('tagged.mp4', ...tags))
  assert.deepEqual(mp4, [{ type: 'nclx', primaries: 1, transfer: 1, matrix: 5, fullRange: true }])
  assert.equal(isCompleteColour(mp4[0]), true)
  const mov = readContainerColour(file('tagged.mov', ...tags))
  assert.deepEqual(mov, [{ type: 'nclc', primaries: 1, transfer: 1, matrix: 5 }])
  const partial = readContainerColour(file('partial.mp4', '-colorspace', 'bt470bg', '-movflags', '+write_colr'))
  assert.equal(partial[0].primaries, 2)
  assert.equal(isCompleteColour(partial[0]), false)
  assert.equal(isCompleteColour({ type: 'prof' }), false)
  const text = path.join(dir, 'not-media.mp4')
  fs.writeFileSync(text, 'not an mp4 file at all')
  assert.equal(readContainerColour(text), null)
  assert.equal(readContainerColour(path.join(dir, 'missing.mp4')), null)
  assert.equal(readContainerColour(undefined), null)
})
