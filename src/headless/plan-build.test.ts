import { describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import { createFormatTracks, resolveFormat } from '@formats/registry.mjs'
import { readPlan } from '@formats/plan/schema.mjs'
import { validatePlan, type PlanMedia } from '@formats/plan/validate.mjs'
import { buildPlanOps } from '@formats/plan/build.mjs'
import { editProject, type EditOp } from './edit'

/**
 * `shred build`'s batch run through the REAL timeline stores: what lands where,
 * from which source frames, with which audio, text and markers.
 */

const TEN = resolveFormat('ten-shot', 'even')

const meta = (id: string, extra: Partial<MediaMetadata>): MediaMetadata =>
  ({
    id,
    fileName: `${id}.mp4`,
    fileSize: 1,
    mimeType: 'video/mp4',
    duration: 4,
    width: 1080,
    height: 1920,
    fps: 30,
    codec: 'h264',
    bitrate: 1,
    ...extra,
  }) as MediaMetadata

const MEDIA = {
  red: meta('red', { audioCodec: 'aac' }),
  blue: meta('blue', { fps: 60, duration: 2 }),
  map: meta('map', { mimeType: 'image/png', fileName: 'map.png', duration: 0 }),
}

const asPlanMedia = (m: MediaMetadata): PlanMedia => ({
  mediaId: m.id,
  fileName: m.fileName,
  kind: m.mimeType.startsWith('image/') ? 'image' : 'video',
  duration: m.duration,
  sourceFps: m.fps,
  audioCodec: m.audioCodec ?? null,
  category: 'b-roll',
})

const beat = (id: string, role: string, edit: [number, number], mediaId: string, inSec = 0) => ({
  id,
  role,
  edit,
  source: { mediaId, in: inSec, unit: 's' },
  takeaway: `${id} takeaway`,
  why: `${id} why`,
})

const PLAN = {
  schemaVersion: 2,
  fps: 30,
  durationFrames: 150,
  request: 'five colours',
  story: { arc: 'brightest first, calm last', structure: ['hook', 'body', 'close'] },
  beats: [
    { ...beat('b01', 'hook', [0, 45], 'red', 0.5), text: 'Five colours, one street' },
    beat('b02', 'body', [45, 90], 'map'),
    beat('b03', 'body', [90, 120], 'red', 2),
    beat('b04', 'close', [120, 150], 'blue'),
  ],
}

function project(): Project {
  return {
    id: 'draft',
    name: 'plan build',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 0,
    schemaVersion: 14,
    metadata: { width: 1080, height: 1920, fps: 30 },
    format: { id: 'ten-shot', variant: 'even' },
    timeline: { tracks: createFormatTracks(TEN), items: [], transitions: [], keyframes: [] },
  } as unknown as Project
}

async function build(options: { markersOnly?: boolean } = {}) {
  const { plan } = readPlan(PLAN, { projectFps: 30 })
  const resolveMedia = (source: { mediaId?: string }) =>
    asPlanMedia(MEDIA[source.mediaId as keyof typeof MEDIA])
  const checked = validatePlan(plan!, { format: TEN, resolveMedia })
  expect(checked.errors).toEqual([])
  const start = project()
  const { ops } = buildPlanOps(plan!, checked.beats, { project: start, format: TEN, ...options })
  return editProject({
    project: start,
    ops: ops as EditOp[],
    media: Object.values(MEDIA).map((m) => ({ mediaId: m.id, metadata: m })),
  })
}

describe('a plan built through the real stores', () => {
  it('places every clip at its beat with its source window, on the Shots track', async () => {
    const { project: built } = await build()
    const items = built.timeline!.items
    const shots = items
      .filter((i) => i.trackId === 'track-shots')
      .sort((a, b) => a.from - b.from)
      .map((i) => [
        i.mediaId,
        i.from,
        i.durationInFrames,
        'sourceStart' in i ? i.sourceStart : null,
        'sourceEnd' in i ? i.sourceEnd : null,
      ])
    expect(shots).toEqual([
      ['red', 0, 45, 15, 60],
      ['map', 45, 45, null, null],
      ['red', 90, 30, 60, 90],
      ['blue', 120, 30, 0, 60],
    ])
  })

  it('drops the camera audio (10 Shot has no sync sound) and keeps the video silent', async () => {
    const { project: built } = await build()
    const items = built.timeline!.items
    expect(items.filter((i) => i.type === 'audio')).toEqual([])
    const reds = items.filter((i) => i.mediaId === 'red')
    expect(reds.map((i) => (i as { embeddedAudioMuted?: boolean }).embeddedAudioMuted)).toEqual([
      true,
      true,
    ])
  })

  it('puts the hook title on the Title track and a marker on every beat', async () => {
    const { project: built } = await build()
    const title = built.timeline!.items.find((i) => i.type === 'text')!
    expect(title).toMatchObject({ trackId: 'track-title', from: 0, durationInFrames: 45 })
    expect((title as { text: string }).text).toBe('Five colours, one street')
    expect(built.timeline!.markers!.map((m) => [m.id, m.frame, m.label])).toEqual([
      ['plan-b01', 0, 'hook: b01 takeaway'],
      ['plan-b02', 45, 'body: b02 takeaway'],
      ['plan-b03', 90, 'body: b03 takeaway'],
      ['plan-b04', 120, 'close: b04 takeaway'],
    ])
  })

  it('markers-only adds the markers and nothing else', async () => {
    const { project: built } = await build({ markersOnly: true })
    expect(built.timeline!.items).toEqual([])
    expect(built.timeline!.markers).toHaveLength(4)
  })
})
