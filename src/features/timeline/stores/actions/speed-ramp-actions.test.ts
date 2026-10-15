import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { makeTimelineAudioItem, makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { updateKeyframe } from './keyframe-actions'
import { clearSpeedRamp, setSpeedRamp } from './speed-ramp-edit-actions'

const item = (id: string) => useItemsStore.getState().itemById[id]!
const speedLane = (id: string) =>
  useKeyframesStore.getState().keyframesByItemId[id]?.properties.find((p) => p.property === 'speed')
    ?.keyframes ?? []

describe('speed ramp edits in the editor', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({ id: 'v', linkedGroupId: 'g' }),
      makeTimelineAudioItem({
        id: 'a',
        linkedGroupId: 'g',
        mediaId: 'media-1',
        sourceStart: 0,
        sourceEnd: 60,
        sourceDuration: 120,
        sourceFps: 30,
      }),
    ])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
  })

  it('sets a ramp on the clip and its audio, mirrors it into the speed lane, and undoes', () => {
    setSpeedRamp(['v'], () => [
      { frame: 0, speed: 1 },
      { frame: 60, speed: 1.5 },
    ])
    expect(item('v')).toMatchObject({ durationInFrames: 60, sourceEnd: 75 })
    expect(item('a')).toMatchObject({ durationInFrames: 60, sourceEnd: 75 })
    expect(speedLane('v').map((k) => [k.frame, k.value])).toEqual([
      [0, 1],
      [60, 1.5],
    ])
    useTimelineCommandStore.getState().undo()
    expect(item('v').speedRamp).toBeUndefined()
    expect(item('v').sourceEnd).toBe(60)
    expect(speedLane('v')).toEqual([])
  })

  it('an edit in the speed lane becomes the clip curve, with its window and audio', () => {
    setSpeedRamp(['v'], () => [
      { frame: 0, speed: 1 },
      { frame: 60, speed: 1.5 },
    ])
    const last = speedLane('v').at(-1)!
    updateKeyframe('v', 'speed', last.id, { value: 2 })
    expect(item('v').speedRamp?.map((k) => k.speed)).toEqual([1, 2])
    // Area under 1x -> 2x over 60 frames.
    expect(item('v').sourceEnd).toBe(90)
    expect(item('a').speedRamp?.map((k) => k.speed)).toEqual([1, 2])
    expect(item('a').sourceEnd).toBe(90)
  })

  it('shortens a clip whose media runs out instead of reading past it', () => {
    setSpeedRamp(['v'], () => [{ frame: 0, speed: 4 }])
    // 120 source frames at 4x: 30 frames.
    expect(item('v')).toMatchObject({ durationInFrames: 30, sourceEnd: 120 })
    expect(item('a').durationInFrames).toBe(30)
    clearSpeedRamp(['v'])
    expect(item('v')).toMatchObject({ durationInFrames: 30, sourceEnd: 30 })
    expect(item('v').speedRamp).toBeUndefined()
  })
})
