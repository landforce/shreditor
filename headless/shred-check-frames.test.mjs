import assert from 'node:assert/strict'
import { test } from 'node:test'
import { flaggedFrames } from '../skills/shreditor-edit/scripts/check-frames.mjs'

const range = (startFrame, endFrame) => ({ startFrame, endFrame })

test('one frame per flagged range, format and kit together, in frame order', () => {
  const card = {
    checks: [
      { key: 'firstImageSec', status: 'warn', ranges: [range(0, 90)] },
      { key: 'transitions', status: 'fail', ranges: [range(300, 310)] },
      { key: 'lengthSec', status: 'pass', ranges: [range(0, 900)] },
    ],
  }
  const kit = {
    checks: [
      { id: 'caption.no-face', status: 'look', ranges: [range(40, 50), range(300, 310)] },
      { id: 'caption.transcript', status: 'listen', ranges: [range(0, 900)] },
    ],
  }
  assert.deepEqual(flaggedFrames(card, kit), [
    { frame: 45, ids: ['firstImageSec', 'caption.no-face'] },
    { frame: 305, ids: ['transitions', 'caption.no-face'] },
  ])
})

test('no card, no kit, or nothing flagged gives nothing; at most 20 frames', () => {
  assert.deepEqual(flaggedFrames(null, null), [])
  const many = {
    checks: [
      {
        key: 'x',
        status: 'warn',
        ranges: Array.from({ length: 30 }, (_, i) => range(i * 10, i * 10)),
      },
    ],
  }
  assert.equal(flaggedFrames(many).length, 20)
})
