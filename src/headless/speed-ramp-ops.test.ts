import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import { editProject, type EditOp } from './edit'

/**
 * setSpeedRamp / clearSpeedRamp and updateItem { speed } through the real
 * timeline stores. Project 25 fps, media 30 fps and 4 s (120 source frames):
 * one timeline frame at 1x plays 1.2 source frames.
 */

function baseProject(): Project {
  return {
    id: 'p1',
    name: 'speed-test',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 300,
    schemaVersion: 14,
    metadata: { width: 1920, height: 1080, fps: 25 },
    timeline: {
      tracks: [
        {
          id: 't_v',
          name: 'V1',
          kind: 'video',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
        },
      ],
      items: [],
      transitions: [],
      keyframes: [],
      currentFrame: 0,
      zoomLevel: 1,
      scrollPosition: 0,
    } as unknown as ProjectTimeline,
  } as Project
}

const videoMedia = {
  id: 'm-vid',
  fileName: 'clip.mp4',
  fileSize: 1,
  mimeType: 'video/mp4',
  duration: 4,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  audioCodec: 'aac',
  bitrate: 1,
} as MediaMetadata

const clip = (extra: EditOp[] = []) =>
  editProject({
    project: baseProject(),
    media: [{ mediaId: 'm-vid', metadata: videoMedia }],
    ops: [
      { op: 'addClip', mediaId: 'm-vid', from: 0, durationInFrames: 50, callerId: 'c' } as EditOp,
      {
        op: 'updateItem',
        id: { $ref: 'c#/detail/created/0/id' },
        updates: { sourceStart: 0, sourceEnd: 60 },
      } as unknown as EditOp,
      ...extra,
    ],
  })

const ref = { $ref: 'c#/detail/created/0/id' } as unknown as string
const items = (result: Awaited<ReturnType<typeof clip>>) => {
  const all = result.project.timeline!.items as TimelineItem[]
  return {
    video: all.find((i) => i.type === 'video')!,
    audio: all.find((i) => i.type === 'audio')!,
  }
}

describe('setSpeedRamp', () => {
  it('keeps the length, derives the source window from the curve, and the audio follows', async () => {
    const result = await clip([
      {
        op: 'setSpeedRamp',
        id: ref,
        keys: [
          { frame: 0, speed: 1 },
          { frame: 50, speed: 2 },
        ],
      } as EditOp,
    ])
    const { video, audio } = items(result)
    // Area under 1x -> 2x over 50 frames = 75; at 30/25 that is 90 source frames.
    expect(video).toMatchObject({ durationInFrames: 50, sourceStart: 0, sourceEnd: 90 })
    expect(video.speedRamp?.map((k) => [k.frame, k.speed])).toEqual([
      [0, 1],
      [50, 2],
    ])
    expect(audio).toMatchObject({ durationInFrames: 50, sourceStart: 0, sourceEnd: 90 })
    expect(audio.speedRamp).toHaveLength(2)
    const detail = result.results.at(-1)!.detail as { linked: string[]; speedRange: object }
    expect(detail.linked).toEqual([audio.id])
    expect(detail.speedRange).toEqual({ min: 1, max: 2 })
    // The editor's keyframe editor shows it as the clip's `speed` lane.
    const lane = result.project
      .timeline!.keyframes?.find((k) => k.itemId === video.id)
      ?.properties.find((p) => p.property === 'speed')
    expect(lane?.keyframes.map((k) => [k.frame, k.value])).toEqual([
      [0, 1],
      [50, 2],
    ])
  })

  it('fails when the source window would run past the media, naming the longest clip', async () => {
    await expect(
      clip([
        {
          op: 'setSpeedRamp',
          id: ref,
          keys: [{ frame: 0, speed: 4 }],
        } as EditOp,
      ]),
    ).rejects.toThrow(/only 120 are left .*at most 25 frames long/)
  })

  it('rejects keys outside the clip, out-of-range speeds and non-media items', async () => {
    await expect(
      clip([{ op: 'setSpeedRamp', id: ref, keys: [{ frame: 51, speed: 1 }] } as EditOp]),
    ).rejects.toThrow(/outside the clip/)
    await expect(
      clip([{ op: 'setSpeedRamp', id: ref, keys: [{ frame: 0, speed: 20 }] } as EditOp]),
    ).rejects.toThrow(/outside 0.1..16/)
    await expect(
      clip([
        { op: 'addText', text: 'T', from: 60, callerId: 't' } as EditOp,
        {
          op: 'setSpeedRamp',
          id: { $ref: 't#/detail/id' },
          preset: 'whip',
        } as unknown as EditOp,
      ]),
    ).rejects.toThrow(/can't take a speed ramp/)
  })

  it('builds presets on the clip and clearSpeedRamp returns to the constant speed', async () => {
    const hero = await clip([
      {
        op: 'setSpeedRamp',
        id: ref,
        preset: 'hero',
        frame: 25,
        speed: 0.25,
        baseSpeed: 1.5,
      } as EditOp,
    ])
    const { video } = items(hero)
    expect(video.speedRamp!.some((k) => k.speed === 0.25)).toBe(true)
    expect(video.durationInFrames).toBe(50)
    expect(video.sourceEnd).toBeLessThan(90)

    const cleared = await clip([
      { op: 'setSpeedRamp', id: ref, preset: 'ease-in' } as EditOp,
      { op: 'clearSpeedRamp', id: ref } as EditOp,
    ])
    const after = items(cleared)
    expect(after.video.speedRamp).toBeUndefined()
    expect(after.audio.speedRamp).toBeUndefined()
    expect(after.video).toMatchObject({ durationInFrames: 50, sourceEnd: 60 })
    expect(
      cleared.project.timeline!.keyframes?.some((k) =>
        k.properties.some((p) => p.property === 'speed' && p.keyframes.length > 0),
      ),
    ).toBe(false)
  })

  it('a split keeps both halves on the one curve', async () => {
    const result = await clip([
      {
        op: 'setSpeedRamp',
        id: ref,
        keys: [
          { frame: 0, speed: 1 },
          { frame: 50, speed: 2 },
        ],
      } as EditOp,
      { op: 'split', id: ref, frame: 20 } as EditOp,
    ])
    const videos = (result.project.timeline!.items as TimelineItem[])
      .filter((i) => i.type === 'video')
      .sort((a, b) => a.from - b.from)
    const [left, right] = videos as [TimelineItem, TimelineItem]
    // 20 frames from 1x to 1.4x: area 24, 28.8 source frames -> 29.
    expect(left).toMatchObject({ durationInFrames: 20, sourceStart: 0, sourceEnd: 29 })
    expect(right).toMatchObject({ durationInFrames: 30, sourceStart: 29, sourceEnd: 90 })
    expect(right.speedRamp?.map((k) => k.frame)).toEqual([-20, 30])
  })
})

describe('updateItem speed is a rate stretch', () => {
  it('speed alone keeps the source window and changes the length; the audio follows', async () => {
    const result = await clip([{ op: 'updateItem', id: ref, updates: { speed: 2 } } as EditOp])
    const { video, audio } = items(result)
    // 60 source frames at 2x, 1.2 source frames per timeline frame: 25 frames.
    expect(video).toMatchObject({ speed: 2, durationInFrames: 25, sourceStart: 0, sourceEnd: 60 })
    expect(audio).toMatchObject({ speed: 2, durationInFrames: 25, sourceEnd: 60 })
  })

  it('speed with a length moves the source window; a window past the media fails', async () => {
    const result = await clip([
      { op: 'updateItem', id: ref, updates: { speed: 2, durationInFrames: 40 } } as EditOp,
    ])
    expect(items(result).video).toMatchObject({ durationInFrames: 40, sourceEnd: 96 })
    await expect(
      clip([{ op: 'updateItem', id: ref, updates: { speed: 3, durationInFrames: 50 } } as EditOp]),
    ).rejects.toThrow(/past the media's end \(120\); at 3x it can be at most 33 frames/)
  })

  it('refuses speedRamp through updateItem', async () => {
    await expect(
      clip([
        { op: 'updateItem', id: ref, updates: { speedRamp: [{ frame: 0, speed: 2 }] } } as EditOp,
      ]),
    ).rejects.toThrow(/setSpeedRamp/)
  })
})
