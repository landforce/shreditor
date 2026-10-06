import test from 'node:test'
import assert from 'node:assert/strict'
import {
  changesSincePass,
  countChanges,
  describeChange,
  describeChangesSincePass,
  diffTimelines,
} from '../skills/shreditor-edit/scripts/timeline-diff.mjs'

const text = {
  id: 't1',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 60,
  text: 'Hook',
}
const marker = (id, frame, label, color = '#3B82F6') => ({
  id,
  frame,
  color,
  ...(label === undefined ? {} : { label }),
})
const timeline = (overrides = {}) => ({ tracks: [], items: [text], markers: [], ...overrides })

test('a marker-only tweak is reported, not "0 changes"', () => {
  const before = timeline({ markers: [marker('m1', 30, 'tighten')] })
  const after = timeline({ markers: [marker('m1', 45, 'tighten here')] })
  const diff = diffTimelines(before, after)
  assert.equal(diff.length, 1)
  assert.deepEqual(diff[0], {
    id: 'm1',
    kind: 'changed',
    type: 'marker',
    name: 'tighten here',
    from: 45,
    label: 'tighten here',
    color: '#3B82F6',
    fields: ['frame', 'label'],
    was: { frame: 30, label: 'tighten', color: '#3B82F6' },
  })
  assert.equal(
    describeChange(diff[0]),
    'changed    45  marker "tighten here"  (moved from 30, label was "tighten")',
  )
  assert.equal(countChanges(diff), '0 item(s), 1 marker(s)')
})

test('markers added and removed, unlabelled ones named by position', () => {
  const before = timeline({ markers: [marker('a', 100), marker('gone', 200, 'old note')] })
  const after = timeline({
    markers: [marker('a', 100), marker('new', 20), marker('c', 300, 'cut music')],
  })
  const lines = diffTimelines(before, after).map(describeChange)
  assert.deepEqual(lines, [
    'added      20  marker "Marker 1"',
    'removed   200  marker "old note"',
    'added     300  marker "cut music"',
  ])
})

test('marker color change and an unchanged marker', () => {
  const before = timeline({ markers: [marker('a', 10, 'x'), marker('b', 20, 'y')] })
  const after = timeline({ markers: [marker('a', 10, 'x', '#ff0000'), marker('b', 20, 'y')] })
  const diff = diffTimelines(before, after)
  assert.equal(diff.length, 1)
  assert.equal(describeChange(diff[0]), 'changed    10  marker "x"  (color was #3B82F6)')
})

test('in/out points set, moved and cleared', () => {
  const set = diffTimelines(timeline({ inPoint: null }), timeline({ inPoint: 15, outPoint: 90 }))
  assert.deepEqual(set.map(describeChange), ['added      15  In point', 'added      90  Out point'])
  assert.equal(countChanges(set), '0 item(s), the in/out points')

  const moved = diffTimelines(
    timeline({ inPoint: 15, outPoint: 90 }),
    timeline({ inPoint: 15, outPoint: 120 }),
  )
  assert.deepEqual(moved.map(describeChange), ['changed   120  Out point  (moved from 90)'])

  const cleared = diffTimelines(timeline({ inPoint: 15 }), timeline({}))
  assert.deepEqual(cleared.map(describeChange), ['removed    15  In point'])
})

test('items still diff as before, sorted by frame with markers', () => {
  const before = timeline({ markers: [] })
  const after = timeline({
    items: [
      { ...text, from: 40 },
      { id: 'v1', type: 'video', trackId: 'track-1', from: 0, durationInFrames: 30, label: 'Clip' },
    ],
    markers: [marker('m', 10, 'note')],
  })
  const lines = diffTimelines(before, after).map(describeChange)
  assert.deepEqual(lines, [
    'added       0  Clip',
    'added      10  marker "note"',
    'changed    40  Hook  (timing)',
  ])
  assert.equal(countChanges(diffTimelines(before, after)), '2 item(s), 1 marker(s)')
})

test('timelines without markers or points diff cleanly', () => {
  assert.deepEqual(diffTimelines({ items: [text] }, { items: [text] }), [])
  assert.deepEqual(diffTimelines(undefined, undefined), [])
})

// A pass that trims the hook, adds a clip and a marker, published over `base`.
const passBase = timeline({ markers: [marker('m-user', 5, 'mine')] })
const passResult = timeline({
  items: [
    { ...text, durationInFrames: 40 },
    { id: 'v1', type: 'video', trackId: 'track-1', from: 60, durationInFrames: 30, label: 'Clip' },
  ],
  markers: [marker('m-user', 5, 'mine'), marker('m-agent', 70, 'check')],
})
const pass = (extra = {}) => ({
  id: '002',
  label: 'Tighten the hook',
  baseRevision: 'sha256:base',
  resultRevision: 'sha256:result',
  changes: diffTimelines(passBase, passResult),
  timeline: passResult,
  baseTimeline: passBase,
  ...extra,
})

test('a pass the user undid (Cmd+Z) is reported as undone, not as edits', () => {
  const since = changesSincePass(pass(), null, passBase)
  assert.equal(since.undone.all, true)
  assert.equal(since.undone.total, 3)
  assert.deepEqual(since.diff, [])
  assert.deepEqual(describeChangesSincePass(pass(), since), [
    'The user undid pass #2 "Tighten the hook" in the editor (Cmd+Z): all 3 of its changes are reverted, so the project is back to how it was before that pass. That is a decision: don\'t reapply the pass unless the user asks for it.',
    'No other changes since.',
  ])
})

test('edits after undoing a pass are measured from the state before it', () => {
  const after = timeline({
    markers: [marker('m-user', 5, 'mine'), marker('m-new', 30, 'redo this')],
  })
  const since = changesSincePass(pass(), null, after)
  assert.equal(since.undone.all, true)
  const lines = describeChangesSincePass(pass(), since)
  assert.equal(
    lines[1],
    'After that the user changed 0 item(s), 1 marker(s). Treat these as decisions:',
  )
  assert.equal(lines[2], '  added      30  marker "redo this"')
})

test('older pass records without a base use the pass before them', () => {
  const previous = { id: '001', resultRevision: 'sha256:base', timeline: passBase }
  const since = changesSincePass(pass({ baseTimeline: undefined }), previous, passBase)
  assert.equal(since.undone.all, true)
  const unrelated = { ...previous, resultRevision: 'sha256:other' }
  assert.equal(
    changesSincePass(pass({ baseTimeline: undefined }), unrelated, passBase).undone,
    null,
  )
})

test('a partly reverted pass lists the user changes and names what was put back', () => {
  const current = timeline({
    items: passResult.items,
    markers: [marker('m-user', 5, 'mine')],
  })
  const since = changesSincePass(pass(), null, current)
  assert.equal(since.undone.all, false)
  const lines = describeChangesSincePass(pass(), since)
  assert.equal(
    lines[0],
    'Since pass #2 "Tighten the hook" the user changed 0 item(s), 1 marker(s). Treat these as decisions:',
  )
  assert.equal(
    lines.at(-1),
    "1 of the pass's 3 changes are back to how they were before it (the user undid them): check.",
  )
})

test('undo then redo of a pass, saved again, is no change', () => {
  const since = changesSincePass(pass(), null, passResult)
  assert.equal(since.undone, null)
  assert.deepEqual(describeChangesSincePass(pass(), since), [
    'No changes since pass #2 "Tighten the hook".',
  ])
})
