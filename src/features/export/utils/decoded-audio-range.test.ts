import { describe, expect, it } from 'vite-plus/test'
import { decodedRangeFrameCount, sliceDecodedSampleIntoRange } from './decoded-audio-range'

const base = { sampleRate: 48_000, startTime: 3, endTime: 4, writtenFrames: 0, anchored: false }

describe('sliceDecodedSampleIntoRange', () => {
  it('skips the frames of the first packet that precede the range start', () => {
    // 3 s = sample 144000, 640 frames into the 1024-frame packet at 143360.
    expect(
      sliceDecodedSampleIntoRange({
        ...base,
        sampleTimestamp: 143_360 / 48_000,
        sampleFrames: 1024,
      }),
    ).toEqual({ padFrames: 0, skipFrames: 640, takeFrames: 384 })
  })

  it('takes later packets whole until the range is full', () => {
    expect(
      sliceDecodedSampleIntoRange({
        ...base,
        sampleTimestamp: 144_384 / 48_000,
        sampleFrames: 1024,
        writtenFrames: 384,
        anchored: true,
      }),
    ).toEqual({ padFrames: 0, skipFrames: 0, takeFrames: 1024 })
    expect(
      sliceDecodedSampleIntoRange({
        ...base,
        sampleTimestamp: 0,
        sampleFrames: 1024,
        writtenFrames: 47_500,
        anchored: true,
      }),
    ).toEqual({ padFrames: 0, skipFrames: 0, takeFrames: 500 })
  })

  it('pads with silence when the source starts after the range start', () => {
    expect(
      sliceDecodedSampleIntoRange({ ...base, sampleTimestamp: 3.01, sampleFrames: 1024 }),
    ).toEqual({ padFrames: 480, skipFrames: 0, takeFrames: 1024 })
  })

  it('places nothing from a packet entirely before the range', () => {
    expect(
      sliceDecodedSampleIntoRange({ ...base, sampleTimestamp: 2.9, sampleFrames: 1024 }),
    ).toEqual({ padFrames: 0, skipFrames: 1024, takeFrames: 0 })
  })

  it('treats a sample without a timestamp as starting at the range start', () => {
    expect(
      sliceDecodedSampleIntoRange({ ...base, sampleTimestamp: Number.NaN, sampleFrames: 1024 }),
    ).toEqual({ padFrames: 0, skipFrames: 0, takeFrames: 1024 })
  })

  it('handles a negative first timestamp (AAC priming before an edit list start)', () => {
    expect(
      sliceDecodedSampleIntoRange({
        ...base,
        startTime: 0,
        sampleTimestamp: -1024 / 48_000,
        sampleFrames: 1024,
      }),
    ).toEqual({ padFrames: 0, skipFrames: 1024, takeFrames: 0 })
  })
})

describe('decodedRangeFrameCount', () => {
  it('rounds the range to whole frames and never goes negative', () => {
    expect(decodedRangeFrameCount(140 / 30, 215 / 30, 48_000)).toBe(120_000)
    expect(decodedRangeFrameCount(5, 4, 48_000)).toBe(0)
  })
})
