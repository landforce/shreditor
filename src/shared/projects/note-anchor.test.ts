import { describe, expect, it } from 'vite-plus/test'
import { noteAnchorFor, resolveNoteSpan } from './note-anchor.mjs'

const shot = {
  id: 'shot',
  type: 'video',
  from: 100,
  durationInFrames: 60,
  sourceStart: 200,
  sourceFps: 60,
  speed: 1,
}
const title = { id: 'title', type: 'text', from: 0, durationInFrames: 300 }
const music = { id: 'music', type: 'audio', from: 0, durationInFrames: 300, sourceStart: 0 }

describe('noteAnchorFor', () => {
  it('anchors to the picture under the frame, by source frame', () => {
    expect(noteAnchorFor(110, [], [title, music, shot], 30)).toEqual({
      itemId: 'shot',
      offset: 10,
      sourceFrame: 220,
    })
  })

  it('prefers a selected clip covering the frame', () => {
    expect(noteAnchorFor(110, ['title'], [title, shot], 30)).toEqual({
      itemId: 'title',
      offset: 110,
    })
  })

  it('ignores a selected clip that does not cover the frame', () => {
    expect(
      noteAnchorFor(110, ['other'], [shot, { ...shot, id: 'other', from: 0 }], 30)?.itemId,
    ).toBe('shot')
  })

  it('has no anchor where nothing plays', () => {
    expect(noteAnchorFor(400, [], [title, shot], 30)).toBeUndefined()
  })
})

describe('resolveNoteSpan', () => {
  const note = { frame: 110, endFrame: 130, anchor: noteAnchorFor(110, [], [shot], 30) }

  it('follows a clip that moved', () => {
    expect(resolveNoteSpan(note, [{ ...shot, from: 87 }], 30)).toEqual({
      frame: 97,
      endFrame: 117,
      state: 'anchored',
    })
  })

  it('stays on the moment when the clip head is trimmed', () => {
    // 6 source frames (3 timeline frames at 60 -> 30 fps) cut from the head.
    const trimmed = { ...shot, sourceStart: 206, durationInFrames: 57 }
    expect(resolveNoteSpan(note, [trimmed], 30)?.frame).toBe(107)
  })

  it('sits on the nearest edge when its moment was trimmed out', () => {
    const trimmed = { ...shot, sourceStart: 230, durationInFrames: 45 }
    expect(resolveNoteSpan(note, [trimmed], 30)).toMatchObject({ frame: 100, state: 'trimmed' })
  })

  it('keeps the frame as written when the clip is gone or there is no anchor', () => {
    expect(resolveNoteSpan(note, [], 30)).toMatchObject({ frame: 110, state: 'detached' })
    expect(resolveNoteSpan({ frame: 5 }, [shot], 30)).toEqual({ frame: 5, state: 'fixed' })
    expect(resolveNoteSpan({}, [shot], 30)).toBeUndefined()
  })

  it('follows a text clip by its offset', () => {
    const anchored = { frame: 50, anchor: { itemId: 'title', offset: 50 } }
    expect(resolveNoteSpan(anchored, [{ ...title, from: 20 }], 30)?.frame).toBe(70)
  })
})
