import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { qcMedia } from '../skills/shreditor-edit/scripts/qc.mjs'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
let dir

// Speech-like: a 300 Hz tone gated on and off every half second, over a chosen background.
const SPEECH = "aevalsrc='0.3*sin(2*PI*300*t)*lt(mod(t,1),0.5)':s=48000:d=6"

function make(name, args) {
  const file = path.join(dir, name)
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, file])
  assert.equal(r.status, 0, r.stderr?.toString())
  return file
}

function audioWith(name, extra) {
  return make(name, ['-f', 'lavfi', '-i', SPEECH, ...extra, '-c:a', 'pcm_s16le'])
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shred-qc-'))
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

const audioMeta = { mimeType: 'audio/wav', category: 'voiceover' }
const hinted = (row, word) => row.hints.some((h) => h.includes(word))

test('clean voice: no noise, rumble or pop hints', { skip: !hasFfmpeg }, () => {
  const row = qcMedia(audioMeta, audioWith('clean.wav', []))
  assert.ok(row.sound.noiseFloorDb < -80, `floor ${row.sound.noiseFloorDb}`)
  assert.equal(row.hints.length, 0, row.hints.join('; '))
})

test('noise under the voice is flagged as audible background noise', { skip: !hasFfmpeg }, () => {
  const file = audioWith('noisy.wav', [
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=a=0.02:c=white:d=6:r=48000',
    '-filter_complex',
    'amix=inputs=2:normalize=0',
  ])
  const row = qcMedia(audioMeta, file)
  assert.ok(hinted(row, 'background noise'), row.hints.join('; '))
})

test('low-frequency bursts are flagged as likely pops', { skip: !hasFfmpeg }, () => {
  const pops = "aevalsrc='0.9*sin(2*PI*40*t)*lt(mod(t,1.5),0.03)':s=48000:d=6"
  const file = audioWith('pops.wav', [
    '-f',
    'lavfi',
    '-i',
    pops,
    '-filter_complex',
    'amix=inputs=2:normalize=0',
  ])
  assert.ok(hinted(qcMedia(audioMeta, file), 'pops'))
})

test('music and SFX get measurements but no clean-up hints', { skip: !hasFfmpeg }, () => {
  const file = audioWith('sfx.wav', [
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=a=0.05:c=white:d=6:r=48000',
    '-filter_complex',
    'amix=inputs=2:normalize=0',
  ])
  const row = qcMedia({ mimeType: 'audio/wav', category: 'sfx' }, file)
  assert.ok(row.sound)
  assert.equal(row.hints.length, 0)
})

const videoOf = (name, color) =>
  make(name, [
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=320x568:d=3:r=30`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
  ])

test('a dark clip is flagged as underexposed', { skip: !hasFfmpeg }, () => {
  const row = qcMedia(
    { mimeType: 'video/mp4', duration: 3, category: 'b-roll' },
    videoOf('dark.mp4', '0x303030'),
  )
  assert.equal(row.sound, null)
  assert.ok(hinted(row, 'underexposed'), row.hints.join('; '))
})

test('a blue cast is named', { skip: !hasFfmpeg }, () => {
  const row = qcMedia(
    { mimeType: 'video/mp4', duration: 3, category: 'b-roll' },
    videoOf('blue.mp4', '0x7080b0'),
  )
  assert.ok(hinted(row, 'blue cast') || hinted(row, 'cool/cyan cast'), row.hints.join('; '))
})

test('a neutral, well-exposed clip has no picture hints', { skip: !hasFfmpeg }, () => {
  const file = make('neutral.mp4', [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x568:d=3:r=30,hue=s=0.6',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
  ])
  const row = qcMedia({ mimeType: 'video/mp4', duration: 3, category: 'b-roll' }, file)
  assert.deepEqual(row.hints, [])
})

test('stills are skipped', () => {
  assert.deepEqual(qcMedia({ mimeType: 'image/png', category: 'graphics' }, '/nope.png'), {
    category: 'graphics',
    skipped: 'still image',
  })
})
