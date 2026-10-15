import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeNote,
  markRead,
  openNotes,
  timecode,
} from '../skills/shreditor-edit/scripts/notes.mjs'

const note = (id, extra = {}) => ({
  id,
  text: `note ${id}`,
  createdAt: '2026-10-01T00:00:00Z',
  status: 'open',
  ...extra,
})

const timeline = {
  tracks: [
    { id: 'tt', name: 'Captions', order: 0 },
    { id: 'tv', name: 'Shots', order: 1 },
  ],
  items: [
    { id: 'v1', type: 'video', trackId: 'tv', from: 0, durationInFrames: 90, label: 'beach.mov' },
    { id: 'v2', type: 'video', trackId: 'tv', from: 90, durationInFrames: 60, label: 'pier.mov' },
    { id: 't1', type: 'text', trackId: 'tt', from: 80, durationInFrames: 30, text: 'Hi' },
  ],
}

test('timecode reads like the editor', () => {
  assert.equal(timecode(95, 30), '00:03:05')
  assert.equal(timecode(30 * 3725 + 2, 30), '01:02:05:02')
})

test('open notes come by frame, then general ones', () => {
  const ordered = openNotes([
    note('aaaa1111'),
    note('bbbb2222', { frame: 200 }),
    note('cccc3333', { frame: 5, status: 'read' }),
    note('dddd4444', { frame: 10 }),
  ])
  assert.deepEqual(
    ordered.map((n) => n.id),
    ['dddd4444', 'bbbb2222', 'aaaa1111'],
  )
})

test('a timed note lists what sits at its frame and what was selected', () => {
  const lines = describeNote(
    note('abcdef123456', { frame: 85, itemIds: ['v1', 'gone'] }),
    timeline,
    30,
  )
  assert.equal(lines[0], '[abcdef12] 00:02:25 (frame 85)  "note abcdef123456"')
  assert.match(lines[2], /Captions: text "Hi" 80-110 \[t1\]/)
  assert.match(lines[3], /Shots: video beach\.mov 0-90 \[v1\]/)
  assert.ok(lines.some((l) => l.includes('[gone] (no longer on the timeline)')))
})

test('a general note has no frame context', () => {
  assert.deepEqual(describeNote(note('12345678abc'), timeline, 30), [
    '[12345678] general  "note 12345678abc"',
  ])
})

test('markRead takes short ids or all, and reports unknown ones', () => {
  const notes = [note('aaaa1111xyz'), note('bbbb2222xyz'), note('cccc3333', { status: 'read' })]
  const some = markRead(notes, 'aaaa1111, zzzz')
  assert.equal(some.marked, 1)
  assert.deepEqual(some.unknown, ['zzzz'])
  assert.equal(some.notes[0].status, 'read')
  assert.equal(some.notes[1].status, 'open')
  assert.equal(markRead(notes, 'all').marked, 2)
})
