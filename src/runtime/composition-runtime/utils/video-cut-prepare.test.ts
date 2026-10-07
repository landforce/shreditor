import { describe, expect, it } from 'vite-plus/test'
import {
  assignVideoPlaybackLanes,
  getVideoLanePoolClipId,
  isSourceContinuousCut,
  resolvePreparedVideoItemIndex,
} from './video-cut-prepare'

const clip = (id: string, from: number, sourceStart?: number, extra: object = {}) => ({
  id,
  from,
  durationInFrames: 30,
  sourceStart,
  sourceEnd: sourceStart === undefined ? undefined : sourceStart + 60,
  ...extra,
})

describe('isSourceContinuousCut', () => {
  it('is continuous when the next clip picks up where the source left off', () => {
    expect(isSourceContinuousCut(clip('a', 0, 0), clip('b', 30, 60))).toBe(true)
  })

  it('is a jump for the same file at another in-point', () => {
    expect(isSourceContinuousCut(clip('a', 0, 0), clip('b', 30, 300))).toBe(false)
    expect(isSourceContinuousCut(clip('a', 0, 120), clip('b', 30, 0))).toBe(false)
  })

  it('is a jump across a timeline gap, a speed change or a reversed clip', () => {
    expect(isSourceContinuousCut(clip('a', 0, 0), clip('b', 31, 60))).toBe(false)
    expect(isSourceContinuousCut(clip('a', 0, 0), clip('b', 30, 60, { speed: 2 }))).toBe(false)
    expect(isSourceContinuousCut(clip('a', 0, 0), clip('b', 30, 60, { isReversed: true }))).toBe(
      false,
    )
  })

  it('keeps the single-element behaviour for clips without a source window', () => {
    expect(isSourceContinuousCut(clip('a', 0), clip('b', 30))).toBe(true)
  })
})

describe('assignVideoPlaybackLanes', () => {
  it('alternates lanes at source jumps and keeps continuous splits on one lane', () => {
    const items = [
      clip('a', 0, 0),
      clip('b', 30, 60), // continues a
      clip('c', 60, 300), // jump
      clip('d', 90, 180), // jump
      clip('e', 120, 240), // continues d
      clip('f', 150, 120), // jump
    ]
    expect(assignVideoPlaybackLanes(items)).toEqual([0, 0, 1, 0, 0, 1])
  })

  it('gives a lone clip lane 0', () => {
    expect(assignVideoPlaybackLanes([clip('a', 0, 0)])).toEqual([0])
    expect(assignVideoPlaybackLanes([])).toEqual([])
  })
})

describe('getVideoLanePoolClipId', () => {
  it('keeps the historical id for lane 0 and a distinct id for lane 1', () => {
    expect(getVideoLanePoolClipId('origin', 0)).toBe('group-origin')
    expect(getVideoLanePoolClipId('origin', 1)).toBe('group-origin:lane-1')
  })
})

describe('resolvePreparedVideoItemIndex', () => {
  const jumpItems = [clip('a', 0, 0), clip('b', 30, 300), clip('c', 60, 0)]
  const lanes = assignVideoPlaybackLanes(jumpItems)
  const resolve = (activeItemIndex: number, globalFrame: number, extra: object = {}) =>
    resolvePreparedVideoItemIndex({
      items: jumpItems,
      lanes,
      activeItemIndex,
      globalFrame,
      lookaheadFrames: 30,
      ...extra,
    })

  it('prepares the first clip while its group premounts', () => {
    expect(resolve(-1, -1)).toBe(0)
  })

  it('prepares the next clip once it starts within the lookahead', () => {
    expect(resolve(0, 0)).toBe(1)
    expect(resolve(0, 29)).toBe(1)
    expect(resolve(1, 45)).toBe(2)
  })

  it('waits until the next clip is within the lookahead', () => {
    expect(resolve(0, 0, { lookaheadFrames: 20 })).toBe(-1)
    expect(resolve(0, 10, { lookaheadFrames: 20 })).toBe(1)
  })

  it('prepares nothing after the last clip', () => {
    expect(resolve(2, 70)).toBe(-1)
  })

  it('leaves a continuous split to the element already playing', () => {
    const items = [clip('a', 0, 0), clip('b', 30, 60)]
    expect(
      resolvePreparedVideoItemIndex({
        items,
        lanes: assignVideoPlaybackLanes(items),
        activeItemIndex: 0,
        globalFrame: 10,
        lookaheadFrames: 30,
      }),
    ).toBe(-1)
  })

  it('leaves transition participants, reversed and overlapping clips alone', () => {
    expect(resolve(0, 10, { excludedItemIds: new Set(['b']) })).toBe(-1)
    expect(resolve(-1, -1, { excludedItemIds: new Set(['a']) })).toBe(-1)

    const reversed = [clip('a', 0, 0), clip('b', 30, 300, { isReversed: true })]
    expect(
      resolvePreparedVideoItemIndex({
        items: reversed,
        lanes: [0, 1],
        activeItemIndex: 0,
        globalFrame: 10,
        lookaheadFrames: 30,
      }),
    ).toBe(-1)

    const overlapping = [clip('a', 0, 0), clip('b', 20, 300)]
    expect(
      resolvePreparedVideoItemIndex({
        items: overlapping,
        lanes: [0, 1],
        activeItemIndex: 0,
        globalFrame: 10,
        lookaheadFrames: 30,
      }),
    ).toBe(-1)
  })
})
