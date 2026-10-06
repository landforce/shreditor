import { describe, expect, it } from 'vite-plus/test'
import {
  computeFilmstripFrameTargets,
  computeFilmstripTargetFrameIndices,
  hasFilmstripFrames,
  isFilmstripCoarsePassLoaded,
  pickFilmstripTargetFrames,
} from './filmstrip-target-frames'

const base = {
  startPx: 0,
  endPx: 400,
  pixelsPerSourceSecond: 10,
  effectiveStart: 0,
  effectiveEnd: 120,
  isReversed: false,
  totalFrameCount: 120,
}

describe('computeFilmstripTargetFrameIndices', () => {
  it('takes the frame under each slot centre', () => {
    expect(computeFilmstripTargetFrameIndices({ ...base, sampleWidth: 100 })).toEqual([
      5, 15, 25, 35,
    ])
  })

  it('asks for about three times the frames with 9:16 tiles as with 16:9 ones', () => {
    const long = { ...base, endPx: 1280, totalFrameCount: 1000 }
    const wide = computeFilmstripTargetFrameIndices({ ...long, sampleWidth: 128 })
    const tall = computeFilmstripTargetFrameIndices({ ...long, sampleWidth: 41 })
    expect(wide).toHaveLength(10)
    expect(tall).toHaveLength(32)
  })

  it('dedupes slots that land in the same second of a 1fps strip', () => {
    expect(
      computeFilmstripTargetFrameIndices({ ...base, pixelsPerSourceSecond: 200, sampleWidth: 41 }),
    ).toEqual([0, 1])
  })

  it('walks backwards through a reversed clip and clamps to the source', () => {
    expect(
      computeFilmstripTargetFrameIndices({
        ...base,
        isReversed: true,
        effectiveEnd: 30,
        sampleWidth: 100,
        totalFrameCount: 30,
      }),
    ).toEqual([0, 5, 15, 25])
  })

  it('returns nothing for an empty range or unusable spacing', () => {
    expect(computeFilmstripTargetFrameIndices({ ...base, endPx: 0, sampleWidth: 100 })).toEqual([])
    expect(computeFilmstripTargetFrameIndices({ ...base, sampleWidth: 0 })).toEqual([])
  })
})

describe('hasFilmstripFrames', () => {
  const frames = [{ index: 1 }, { index: 5 }, { index: 9 }]

  it('is true only when every wanted frame is loaded', () => {
    expect(hasFilmstripFrames([1, 9], frames)).toBe(true)
    expect(hasFilmstripFrames([1, 2], frames)).toBe(false)
    expect(hasFilmstripFrames([1], null)).toBe(false)
    expect(hasFilmstripFrames([], null)).toBe(true)
  })
})

describe('filmstrip frame passes', () => {
  const input = {
    isVisible: true,
    height: 72,
    pixelsPerSecond: 10,
    speed: 1,
    effectiveStart: 0,
    effectiveEnd: 600,
    sourceDuration: 600,
    isReversed: false,
    renderWindow: { paddedStartX: 0, paddedEndX: 1280, startTile: 0, endTile: 32 },
    tileWidth: 41,
    sampleWidth: 128,
  }

  it('asks a 9:16 strip for 16:9-spaced frames first, then one per tile', () => {
    const targets = computeFilmstripFrameTargets(input)!
    expect(targets.coarse).toHaveLength(10)
    expect(targets.perTile).toHaveLength(32)
    expect(pickFilmstripTargetFrames(targets, false)).toBe(targets.coarse)
    expect(pickFilmstripTargetFrames(targets, true)).toBe(targets.perTile)
  })

  it('has a single pass for 16:9 tiles', () => {
    const targets = computeFilmstripFrameTargets({ ...input, tileWidth: 128 })!
    expect(targets.perTile).toBe(targets.coarse)
  })

  it('needs nothing while hidden, unmeasured or empty', () => {
    expect(computeFilmstripFrameTargets({ ...input, isVisible: false })).toBeNull()
    expect(computeFilmstripFrameTargets({ ...input, height: 0 })).toBeNull()
    expect(computeFilmstripFrameTargets({ ...input, effectiveEnd: 0 })).toBeNull()
    expect(
      computeFilmstripFrameTargets({
        ...input,
        renderWindow: { paddedStartX: 0, paddedEndX: 0, startTile: 0, endTile: 0 },
      }),
    ).toBeNull()
    expect(pickFilmstripTargetFrames(null, true)).toBeUndefined()
  })

  it('counts the first pass loaded only when there is one and its frames are in', () => {
    const targets = computeFilmstripFrameTargets(input)!
    const frames = targets.coarse.map((index) => ({ index }))
    expect(isFilmstripCoarsePassLoaded(targets, frames)).toBe(true)
    expect(isFilmstripCoarsePassLoaded(targets, frames.slice(1))).toBe(false)
    expect(isFilmstripCoarsePassLoaded(null, frames)).toBe(false)
  })
})
