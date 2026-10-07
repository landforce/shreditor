// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem, TextItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useKeyframesStore } from '../../keyframes-store'
import { useTimelineCommandStore } from '../../timeline-command-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { splitItemsAtFrame } from './split-actions'
import { duplicateItemsAfterSelf, rippleTrimItemsToFrame } from './playhead-edit-actions'

function makeTrack(
  id: string,
  order: number,
  overrides: Partial<TimelineTrack> = {},
): TimelineTrack {
  return {
    id,
    name: id,
    kind: id.startsWith('a') ? 'audio' : 'video',
    order,
    height: 60,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    items: [],
    ...overrides,
  }
}

function makeVideo(id: string, from: number, overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'v1',
    from,
    durationInFrames: 60,
    label: id,
    src: 'blob:video',
    mediaId: `media-${id}`,
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 600,
    ...overrides,
  }
}

function makeAudio(id: string, from: number, overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id,
    type: 'audio',
    trackId: 'a1',
    from,
    durationInFrames: 60,
    label: id,
    src: 'blob:audio',
    mediaId: `media-${id}`,
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 600,
    ...overrides,
  }
}

function makeCaption(id: string, from: number, clipId: string, duration = 10): TextItem {
  return {
    id,
    type: 'text',
    trackId: 'c1',
    from,
    durationInFrames: duration,
    label: id,
    text: id,
    color: '#fff',
    textRole: 'caption',
    captionSource: { type: 'transcript', clipId, mediaId: 'media-v' },
  }
}

function setTimeline(items: TimelineItem[], tracks: TimelineTrack[]) {
  useItemsStore.getState().setTracks(tracks)
  useItemsStore.getState().setItems(items)
}

function layout(): Array<[string, number, number, number | undefined]> {
  return useItemsStore
    .getState()
    .items.toSorted((left, right) =>
      left.trackId === right.trackId
        ? left.from - right.from
        : left.trackId.localeCompare(right.trackId),
    )
    .map((item) => [
      item.trackId,
      item.from,
      item.durationInFrames,
      'sourceStart' in item ? item.sourceStart : undefined,
    ])
}

function undoCount() {
  return useTimelineCommandStore.getState().undoStack.length
}

beforeEach(() => {
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  useTransitionsStore.getState().setTransitions([])
  useKeyframesStore.getState().setKeyframes([])
  useEditorStore.setState({ linkedSelectionEnabled: true })
  useSelectionStore.getState().clearSelection()
  setTimeline([], [])
})

describe('rippleTrimItemsToFrame', () => {
  it('Q removes the part before the frame, closes the gap, and moves linked audio with it', () => {
    setTimeline(
      [
        makeVideo('v', 0, { linkedGroupId: 'g' }),
        makeAudio('au', 0, { linkedGroupId: 'g' }),
        makeVideo('next', 60),
      ],
      [makeTrack('v1', 0), makeTrack('a1', 1)],
    )

    const kept = rippleTrimItemsToFrame(['v'], 20, 'before')

    expect(layout()).toEqual([
      ['a1', 0, 40, 20],
      ['v1', 0, 40, 20],
      ['v1', 40, 60, 0],
    ])
    expect(kept).toHaveLength(2)
    expect(useSelectionStore.getState().selectedItemIds.toSorted()).toEqual(kept.toSorted())
    expect(undoCount()).toBe(1)

    useTimelineCommandStore.getState().undo()
    expect(layout()).toEqual([
      ['a1', 0, 60, 0],
      ['v1', 0, 60, 0],
      ['v1', 60, 60, 0],
    ])
  })

  it('W removes the part after the frame and pulls the next clip in', () => {
    setTimeline(
      [
        makeVideo('v', 0, { linkedGroupId: 'g' }),
        makeAudio('au', 0, { linkedGroupId: 'g' }),
        makeVideo('next', 60),
      ],
      [makeTrack('v1', 0), makeTrack('a1', 1)],
    )

    const kept = rippleTrimItemsToFrame(['v'], 20, 'after')

    expect(kept.toSorted()).toEqual(['au', 'v'])
    expect(layout()).toEqual([
      ['a1', 0, 20, 0],
      ['v1', 0, 20, 0],
      ['v1', 20, 60, 0],
    ])
    expect(undoCount()).toBe(1)
  })

  it('takes the same span out of a sync-locked audio track when linked selection is off', () => {
    useEditorStore.setState({ linkedSelectionEnabled: false })
    setTimeline(
      [makeVideo('v', 0, { linkedGroupId: 'g' }), makeAudio('au', 0, { linkedGroupId: 'g' })],
      [makeTrack('v1', 0), makeTrack('a1', 1)],
    )

    rippleTrimItemsToFrame(['v'], 20, 'before')

    // The audio loses frames 0-20 too, so it stays in sync with the picture.
    expect(layout()).toEqual([
      ['a1', 0, 40, 20],
      ['v1', 0, 40, 20],
    ])
  })

  it('trims clips on two tracks in one step without cutting either twice', () => {
    setTimeline(
      [makeVideo('top', 0, { trackId: 'v2' }), makeVideo('bottom', 0)],
      [makeTrack('v2', 0), makeTrack('v1', 1)],
    )

    rippleTrimItemsToFrame(['top', 'bottom'], 20, 'before')

    expect(layout()).toEqual([
      ['v1', 0, 40, 20],
      ['v2', 0, 40, 20],
    ])
    expect(undoCount()).toBe(1)
  })

  it('keeps the captions over the kept footage and drops the ones over the removed part', () => {
    setTimeline(
      [makeVideo('v', 0), makeCaption('early', 0, 'v'), makeCaption('late', 30, 'v')],
      [makeTrack('v1', 0), makeTrack('c1', 1, { kind: 'video' })],
    )

    const [kept] = rippleTrimItemsToFrame(['v'], 20, 'before')

    const captions = useItemsStore
      .getState()
      .items.filter((item): item is TextItem => item.type === 'text')
    expect(captions.map((item) => [item.id, item.from, item.captionSource?.clipId])).toEqual([
      ['late', 10, kept],
    ])
  })

  it('leaves clips the frame is not inside alone', () => {
    setTimeline([makeVideo('v', 0)], [makeTrack('v1', 0)])

    expect(rippleTrimItemsToFrame(['v'], 0, 'before')).toEqual([])
    expect(rippleTrimItemsToFrame(['v'], 60, 'after')).toEqual([])
    expect(undoCount()).toBe(0)
  })
})

describe('splitItemsAtFrame', () => {
  it('cuts only the requested clips (and linked partners) in one undo step', () => {
    setTimeline(
      [
        makeVideo('v', 0, { linkedGroupId: 'g' }),
        makeAudio('au', 0, { linkedGroupId: 'g' }),
        makeVideo('other', 0, { trackId: 'v2' }),
      ],
      [makeTrack('v2', 0), makeTrack('v1', 1), makeTrack('a1', 2)],
    )

    expect(splitItemsAtFrame(20, ['v'])).toBe(1)

    expect(layout()).toEqual([
      ['a1', 0, 20, 0],
      ['a1', 20, 40, 20],
      ['v1', 0, 20, 0],
      ['v1', 20, 40, 20],
      ['v2', 0, 60, 0],
    ])
    expect(undoCount()).toBe(1)
  })
})

describe('duplicateItemsAfterSelf', () => {
  it('places the copies right after the selection on the same tracks', () => {
    setTimeline(
      [makeVideo('v', 0, { linkedGroupId: 'g' }), makeAudio('au', 0, { linkedGroupId: 'g' })],
      [makeTrack('v1', 0), makeTrack('a1', 1)],
    )

    const copies = duplicateItemsAfterSelf(['v', 'au'])

    expect(copies).toHaveLength(2)
    expect(layout()).toEqual([
      ['a1', 0, 60, 0],
      ['a1', 60, 60, 0],
      ['v1', 0, 60, 0],
      ['v1', 60, 60, 0],
    ])
    const copyItems = useItemsStore.getState().items.filter((item) => copies.includes(item.id))
    expect(new Set(copyItems.map((item) => item.linkedGroupId)).size).toBe(1)
    expect(copyItems[0]!.linkedGroupId).not.toBe('g')
    expect(useSelectionStore.getState().selectedItemIds.toSorted()).toEqual(copies.toSorted())
    expect(undoCount()).toBe(1)
  })

  it('slides past clips in the way instead of covering them', () => {
    setTimeline(
      [
        makeVideo('v', 0, { durationInFrames: 30 }),
        makeVideo('blocker', 40, { durationInFrames: 20 }),
      ],
      [makeTrack('v1', 0)],
    )

    duplicateItemsAfterSelf(['v'])

    expect(layout()).toEqual([
      ['v1', 0, 30, 0],
      ['v1', 40, 20, 0],
      ['v1', 60, 30, 0],
    ])
  })

  it('keeps a multi-clip selection together, after its last clip', () => {
    setTimeline(
      [
        makeVideo('first', 0, { durationInFrames: 30 }),
        makeVideo('second', 30, { durationInFrames: 30 }),
      ],
      [makeTrack('v1', 0)],
    )

    duplicateItemsAfterSelf(['first', 'second'])

    expect(layout().map(([, from, duration]) => [from, duration])).toEqual([
      [0, 30],
      [30, 30],
      [60, 30],
      [90, 30],
    ])
  })
})
