import { describe, expect, it } from 'vitest'
import type { AudioItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  computeTimelineBeats,
  mapSourceTimesToTimelineFrames,
  pickMusicItem,
} from './use-timeline-beats'

const FPS = 30

function audio(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'a1',
    type: 'audio',
    trackId: 't-music',
    from: 0,
    durationInFrames: 300,
    label: 'song',
    mediaId: 'm-song',
    src: 'blob:song',
    ...overrides,
  } as AudioItem
}

function track(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 't-music',
    name: 'Music',
    kind: 'audio',
    height: 40,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [],
    ...overrides,
  }
}

describe('mapSourceTimesToTimelineFrames', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3]

  it('places beats from the clip start', () => {
    const frames = mapSourceTimesToTimelineFrames(beats, audio({ from: 60 }), FPS)
    expect(frames.slice(0, 3)).toEqual([60, 75, 90])
  })

  it('drops beats before the trim and shifts the rest', () => {
    // 30 source frames trimmed = 1 s: the beat at 1 s lands on the clip start.
    const frames = mapSourceTimesToTimelineFrames(
      beats,
      audio({ from: 100, sourceStart: 30, durationInFrames: 60 }),
      FPS,
    )
    expect(frames).toEqual([100, 115, 130, 145, 160])
  })

  it('falls back to trimStart when there is no sourceStart', () => {
    const frames = mapSourceTimesToTimelineFrames(
      beats,
      audio({ trimStart: 60, durationInFrames: 30 }),
      FPS,
    )
    expect(frames[0]).toBe(0)
    expect(frames).toHaveLength(3)
  })

  it('compresses beats when the clip plays faster', () => {
    const frames = mapSourceTimesToTimelineFrames(
      beats,
      audio({ speed: 2, durationInFrames: 45 }),
      FPS,
    )
    expect(frames).toEqual([0, 7.5, 15, 22.5, 30, 37.5, 45])
  })

  it('stops at the end of the clip', () => {
    const frames = mapSourceTimesToTimelineFrames(beats, audio({ durationInFrames: 45 }), FPS)
    expect(frames).toEqual([0, 15, 30, 45])
  })

  it('counts from the end when the clip is reversed', () => {
    const frames = mapSourceTimesToTimelineFrames(
      [0, 1, 2],
      audio({ isReversed: true, durationInFrames: 90 }),
      FPS,
    )
    // a 3 s clip played backwards: source 0 s is its last frame
    expect(frames).toEqual([30, 60, 90])
  })
})

describe('pickMusicItem', () => {
  it('prefers a music lane over a longer clip elsewhere', () => {
    const tracks = [track(), track({ id: 't-vo', name: 'Voice' })]
    const items: TimelineItem[] = [
      audio({ id: 'vo', trackId: 't-vo', durationInFrames: 900, mediaId: 'm-vo' }),
      audio({ id: 'song', durationInFrames: 300 }),
    ]
    expect(pickMusicItem(items, tracks)?.id).toBe('song')
  })

  it('reads the format role of the lane', () => {
    const tracks = [track({ name: 'Bed', formatRole: 'music' }), track({ id: 't2', name: 'Other' })]
    const items: TimelineItem[] = [
      audio({ id: 'bed', trackId: 't-music' }),
      audio({ id: 'long', trackId: 't2', durationInFrames: 999, mediaId: 'm2' }),
    ]
    expect(pickMusicItem(items, tracks)?.id).toBe('bed')
  })

  it('falls back to the longest audio clip, and to null with none', () => {
    const tracks = [track({ name: 'A1' })]
    const items: TimelineItem[] = [
      audio({ id: 'short', durationInFrames: 30 }),
      audio({ id: 'long', durationInFrames: 600, mediaId: 'm2' }),
    ]
    expect(pickMusicItem(items, tracks)?.id).toBe('long')
    expect(pickMusicItem([], tracks)).toBeNull()
  })
})

describe('computeTimelineBeats', () => {
  const items: TimelineItem[] = [audio({ from: 30 })]
  const tracks = [track()]

  it('reports pending until the analysis arrives', () => {
    expect(computeTimelineBeats(items, tracks, {}, FPS).status).toBe('pending')
    expect(computeTimelineBeats(items, tracks, { 'm-song': 'pending' }, FPS).status).toBe('pending')
    expect(computeTimelineBeats(items, tracks, { 'm-song': 'failed' }, FPS).status).toBe('failed')
  })

  it('maps a finished analysis onto the timeline', () => {
    const result = computeTimelineBeats(
      items,
      tracks,
      { 'm-song': { bpm: 120, beats: [0, 0.5, 1, 1.5], downbeats: [0, 2], confidence: 0.9 } },
      FPS,
    )
    expect(result.status).toBe('ready')
    expect(result.bpm).toBe(120)
    expect(result.beatFrames).toEqual([30, 45, 60, 75])
    expect(result.downbeatFrames).toEqual([30, 90])
  })

  it('reports none without audio', () => {
    expect(computeTimelineBeats([], tracks, {}, FPS).status).toBe('none')
  })
})
