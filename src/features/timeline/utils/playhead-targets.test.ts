// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import {
  findClipAtPlayhead,
  getAddEditTargetIds,
  getClickSelectionIds,
  getSelectableItemIds,
  getSelectedItemIdsInsideFrame,
} from './playhead-targets'

function makeTrack(
  id: string,
  order: number,
  overrides: Partial<TimelineTrack> = {},
): TimelineTrack {
  return {
    id,
    name: id,
    kind: 'video',
    order,
    height: 60,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    items: [],
    ...overrides,
  }
}

function makeClip(id: string, trackId: string, from: number, duration: number): VideoItem {
  return {
    id,
    type: 'video',
    trackId,
    from,
    durationInFrames: duration,
    label: id,
    src: 'clip.mp4',
  }
}

const TRACKS = [makeTrack('v1', 0), makeTrack('v2', 1), makeTrack('v3', 2)]
const ITEMS: TimelineItem[] = [
  makeClip('a', 'v1', 0, 30),
  makeClip('b', 'v2', 10, 30),
  makeClip('c', 'v3', 20, 30),
]

describe('getSelectableItemIds', () => {
  it('returns every clip on unlocked lanes, including hidden ones', () => {
    const tracks = [
      makeTrack('v1', 0),
      makeTrack('v2', 1, { visible: false }),
      makeTrack('v3', 2, { locked: true }),
    ]
    expect(getSelectableItemIds(ITEMS, tracks)).toEqual(['a', 'b'])
  })

  it('treats lanes inside a locked Layer Group as locked', () => {
    const tracks = [
      makeTrack('group', 0, { isGroup: true, locked: true }),
      makeTrack('v1', 1, { parentTrackId: 'group' }),
      makeTrack('v2', 2),
      makeTrack('v3', 3),
    ]
    expect(getSelectableItemIds(ITEMS, tracks)).toEqual(['b', 'c'])
  })
})

describe('findClipAtPlayhead', () => {
  it('prefers the clip on the active track', () => {
    const clip = findClipAtPlayhead({
      items: ITEMS,
      tracks: TRACKS,
      frame: 25,
      activeTrackId: 'v3',
    })
    expect(clip?.id).toBe('c')
  })

  it('falls back to the topmost visible unlocked track that has a clip there', () => {
    const tracks = [makeTrack('v1', 0, { locked: true }), makeTrack('v2', 1), makeTrack('v3', 2)]
    const clip = findClipAtPlayhead({ items: ITEMS, tracks, frame: 25, activeTrackId: 'v1' })
    expect(clip?.id).toBe('b')

    const hiddenTop = [
      makeTrack('v1', 0),
      makeTrack('v2', 1, { visible: false }),
      makeTrack('v3', 2),
    ]
    expect(
      findClipAtPlayhead({ items: ITEMS, tracks: hiddenTop, frame: 35, activeTrackId: null })?.id,
    ).toBe('c')
  })

  it('needs the frame strictly inside the clip when strict', () => {
    expect(
      findClipAtPlayhead({ items: ITEMS, tracks: TRACKS, frame: 0, activeTrackId: 'v1' })?.id,
    ).toBe('a')
    expect(
      findClipAtPlayhead({
        items: ITEMS,
        tracks: TRACKS,
        frame: 0,
        activeTrackId: 'v1',
        strict: true,
      }),
    ).toBeNull()
  })
})

describe('add edit and trim targets', () => {
  it('uses the selected clips under the playhead when there are any', () => {
    expect(
      getAddEditTargetIds({ items: ITEMS, tracks: TRACKS, selectedItemIds: ['b'], frame: 25 }),
    ).toEqual(['b'])
  })

  it('falls back to every clip under the playhead on unlocked lanes', () => {
    const tracks = [makeTrack('v1', 0), makeTrack('v2', 1, { locked: true }), makeTrack('v3', 2)]
    expect(
      getAddEditTargetIds({ items: ITEMS, tracks, selectedItemIds: ['x'], frame: 25 }),
    ).toEqual(['a', 'c'])
  })

  it('ignores selected clips the playhead is not inside, or that sit on locked lanes', () => {
    const tracks = [makeTrack('v1', 0), makeTrack('v2', 1, { locked: true }), makeTrack('v3', 2)]
    expect(
      getSelectedItemIdsInsideFrame({
        items: ITEMS,
        tracks,
        selectedItemIds: ['a', 'b', 'c'],
        frame: 30,
      }),
    ).toEqual(['c'])
  })
})

describe('getClickSelectionIds', () => {
  it('includes linked partners only when linked selection is on', () => {
    const items: TimelineItem[] = [
      { ...makeClip('v', 'v1', 0, 30), linkedGroupId: 'g' },
      {
        id: 'au',
        type: 'audio',
        trackId: 'a1',
        from: 0,
        durationInFrames: 30,
        label: 'au',
        src: 'clip.mp4',
        linkedGroupId: 'g',
      },
    ]
    expect(getClickSelectionIds(items, 'v', true)).toEqual(['v', 'au'])
    expect(getClickSelectionIds(items, 'v', false)).toEqual(['v'])
  })
})
