import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import type { VideoItem } from '@/types/timeline'
import { timelineItemProblem } from '@/features/project-bundle/schemas/project-schema'
import { editProject, type EditOp } from './edit'

const video: VideoItem = {
  id: 'v1',
  type: 'video',
  trackId: 't_v',
  from: 0,
  durationInFrames: 50,
  label: 'speaker',
  src: '',
  mediaId: 'm1',
}

function project(items: VideoItem[] = [video]): Project {
  return {
    id: 'p1',
    name: 'cutout-test',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 300,
    schemaVersion: 14,
    metadata: { width: 1080, height: 1920, fps: 25 },
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
      items,
      transitions: [],
      keyframes: [],
      currentFrame: 0,
      zoomLevel: 1,
      scrollPosition: 0,
    } as unknown as ProjectTimeline,
  } as Project
}

const itemOf = (result: Awaited<ReturnType<typeof editProject>>, id: string) =>
  result.project.timeline!.items.find((item) => item.id === id) as VideoItem

describe('setCutout', () => {
  it('turns background removal on with defaults and merges later changes', async () => {
    const on = await editProject({
      project: project(),
      ops: [{ op: 'setCutout', id: 'v1', enabled: true } as EditOp],
    })
    expect(itemOf(on, 'v1').cutout).toEqual({ enabled: true, subject: 'auto' })
    expect(on.results[0]?.detail).toEqual({ id: 'v1', cutout: { enabled: true, subject: 'auto' } })

    const tuned = await editProject({
      project: on.project,
      ops: [
        {
          op: 'setCutout',
          id: 'v1',
          enabled: true,
          subject: 'person',
          feather: 6,
          invert: true,
        } as EditOp,
      ],
    })
    expect(itemOf(tuned, 'v1').cutout).toEqual({
      enabled: true,
      subject: 'person',
      feather: 6,
      invert: true,
    })
  })

  it('a split keeps the cutout, strokes included, on both halves', async () => {
    const result = await editProject({
      project: project([{ ...video, cutout: { enabled: true, subject: 'person' } }]),
      ops: [
        {
          op: 'addCutoutStroke',
          id: 'v1',
          tool: 'eraser',
          points: [
            [0.4, 0.8],
            [0.6, 0.82],
          ],
          at: 0.5,
        } as EditOp,
        { op: 'split', id: 'v1', frame: 20 } as EditOp,
      ],
    })
    const halves = result.project.timeline!.items.filter((item) => item.type === 'video')
    expect(halves).toHaveLength(2)
    for (const half of halves) {
      const cutout = (half as VideoItem).cutout
      expect(cutout?.subject).toBe('person')
      // Strokes are in source time and source fractions, so both halves keep them as they are.
      expect(cutout?.strokes?.map((stroke) => [stroke.tool, stroke.at])).toEqual([['eraser', 0.5]])
    }
  })

  it('refuses other item types, unknown ids and bad values (nothing applied)', async () => {
    await expect(
      editProject({
        project: project(),
        ops: [{ op: 'setCutout', id: 'nope', enabled: true } as EditOp],
      }),
    ).rejects.toThrow(/does not exist/)
    await expect(
      editProject({
        project: project(),
        ops: [{ op: 'setCutout', id: 'v1', enabled: true, feather: 500 } as EditOp],
      }),
    ).rejects.toThrow(/cutout\.feather/)
    const text = await editProject({
      project: project(),
      ops: [{ op: 'addText', text: 'Hi', from: 60, callerId: 't' } as EditOp],
    })
    const textId = text.project.timeline!.items.find((item) => item.type === 'text')!.id
    await expect(
      editProject({
        project: text.project,
        ops: [{ op: 'setCutout', id: textId, enabled: true } as EditOp],
      }),
    ).rejects.toThrow(/video clips/)
  })
})

describe('addCutoutStroke / clearCutoutStrokes', () => {
  const stroke = {
    op: 'addCutoutStroke',
    id: 'v1',
    tool: 'smartEraser',
    points: [
      [0.4, 0.8],
      [0.6, 0.82],
    ],
    at: 1.5,
  }

  it('adds strokes in order (a new cutout starts on) and clears them in one op', async () => {
    const one = await editProject({ project: project(), ops: [stroke as EditOp] })
    expect(itemOf(one, 'v1').cutout).toEqual({
      enabled: true,
      subject: 'auto',
      strokes: [{ tool: 'smartEraser', at: 1.5, size: 0.03, points: stroke.points }],
    })
    const two = await editProject({
      project: one.project,
      ops: [{ ...stroke, tool: 'brush', size: 0.1, points: [[0.5, 0.5]] } as EditOp],
    })
    expect(itemOf(two, 'v1').cutout?.strokes?.map((s) => s.tool)).toEqual(['smartEraser', 'brush'])
    expect(two.results[0]?.detail).toMatchObject({ id: 'v1' })

    const cleared = await editProject({
      project: two.project,
      ops: [{ op: 'clearCutoutStrokes', id: 'v1' } as EditOp],
    })
    expect(itemOf(cleared, 'v1').cutout).toEqual({ enabled: true, subject: 'auto' })
  })

  it('refuses bad strokes (nothing applied)', async () => {
    await expect(
      editProject({ project: project(), ops: [{ ...stroke, tool: 'spray' } as EditOp] }),
    ).rejects.toThrow(/strokes\[0\]\.tool/)
    await expect(
      editProject({ project: project(), ops: [{ ...stroke, points: [[2, 0.5]] } as EditOp] }),
    ).rejects.toThrow(/strokes\[0\]\.points/)
    await expect(
      editProject({ project: project(), ops: [{ ...stroke, size: 0.9 } as EditOp] }),
    ).rejects.toThrow(/strokes\[0\]\.size/)
  })
})

describe('cutout in the project schema', () => {
  it('validates the cutout field on items', () => {
    expect(
      timelineItemProblem({ ...video, cutout: { enabled: true, subject: 'object' } }),
    ).toBeNull()
    expect(
      timelineItemProblem({
        ...video,
        cutout: { enabled: true, subject: 'auto', sampleRate: 'full' },
      }),
    ).toBeNull()
    expect(timelineItemProblem({ ...video, cutout: { enabled: true, subject: 'dog' } })).toMatch(
      /^cutout\.subject/,
    )
    expect(
      timelineItemProblem({ ...video, cutout: { enabled: true, subject: 'auto', refine: 2 } }),
    ).toMatch(/^cutout\.refine/)
    const strokes = [{ tool: 'brush', at: 0, size: 0.05, points: [[0.5, 0.5]] }]
    expect(
      timelineItemProblem({ ...video, cutout: { enabled: true, subject: 'auto', strokes } }),
    ).toBeNull()
    expect(
      timelineItemProblem({
        ...video,
        cutout: { enabled: true, subject: 'auto', strokes: [{ ...strokes[0], mode: 'add' }] },
      }),
    ).toMatch(/^cutout\.strokes/)
  })
})
