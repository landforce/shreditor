import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { buildCaptionTextItems, getCaptionRangeForClip, getClipSourceBounds } from './caption-items'

// 30 fps clip and timeline: 2x for the first 30 frames (60 source frames), then 1x.
const ramped: VideoItem = {
  id: 'clip',
  type: 'video',
  trackId: 't',
  from: 100,
  durationInFrames: 60,
  label: 'Clip',
  src: 'clip.mp4',
  mediaId: 'm',
  sourceStart: 0,
  sourceEnd: 90,
  sourceFps: 30,
  speedRamp: [
    { frame: 0, speed: 2, easing: 'hold' },
    { frame: 30, speed: 1 },
  ],
}

describe('captions under a speed ramp', () => {
  it('maps transcript seconds through the time map', () => {
    const items = buildCaptionTextItems({
      mediaId: 'm',
      trackId: 'captions',
      clip: ramped,
      timelineFps: 30,
      canvasWidth: 1080,
      canvasHeight: 1920,
      segments: [
        { text: 'fast part', start: 1, end: 1.5 },
        { text: 'slow part', start: 2.5, end: 2.9 },
      ],
    })
    // Source 1 s (frame 30) at 2x is clip frame 15; 1.5 s is frame 22.5 -> 23.
    expect(items.map((item) => [item.text, item.from, item.from + item.durationInFrames])).toEqual([
      ['fast part', 115, 123],
      // Source 2.5 s (frame 75): 60 source frames by clip frame 30, then 15 more at 1x.
      ['slow part', 145, 157],
    ])
  })

  it('takes the window end from the curve when sourceEnd is missing', () => {
    const { sourceEnd } = getClipSourceBounds({ ...ramped, sourceEnd: undefined }, 30)
    expect(sourceEnd).toBe(90)
    expect(getCaptionRangeForClip(ramped, [{ text: 'all', start: 0, end: 3 }], 30)).toEqual({
      startFrame: 100,
      endFrame: 160,
    })
  })
})
