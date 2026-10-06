// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ProjectTimeline } from '@/types/project'
import { validateProject } from '../schemas/project-schema'
import { convertTimelineForBundle, restoreTimelineFromBundle } from './bundle-timeline'

const timeline: ProjectTimeline = {
  tracks: [
    {
      id: 't',
      name: 'V1',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
    },
  ],
  items: [
    {
      id: 'title',
      type: 'text',
      trackId: 't',
      from: 0,
      durationInFrames: 30,
      label: 'Hi',
      text: 'Hi',
      color: '#fff',
      textStyleId: 'kit-title',
      textStyleOverrides: ['color'],
    },
  ],
  textStyles: [
    {
      id: 'kit-title',
      name: 'Kit title',
      role: 'title',
      variants: [
        {
          aspect: '9:16',
          style: {
            fontFamily: 'Anton',
            fontSize: 120,
            stroke: { width: 3, color: '#000', join: 'miter' },
          },
          layout: { yRatio: -0.3 },
          caption: { maxWordsPerChunk: 3, maxCharsPerLine: 20, maxLines: 2, minChunkFrames: 10 },
        },
        { aspect: '16:9', style: { fontFamily: 'Anton', fontSize: 90 }, layout: { yRatio: -0.2 } },
      ],
      version: 2,
      updatedAt: 5,
    },
  ],
}

/** The same style as projects saved it before variants: one look. */
const legacy = {
  id: 'kit-title',
  name: 'Kit title',
  role: 'title',
  style: { fontFamily: 'Anton', fontSize: 120 },
  layout: { yRatio: -0.3 },
  version: 1,
  updatedAt: 1,
}

const project = (t: unknown) => ({
  id: 'p',
  name: 'p',
  description: '',
  createdAt: 0,
  updatedAt: 0,
  duration: 1,
  metadata: { width: 1080, height: 1920, fps: 30 },
  timeline: t,
})

describe('text styles in project bundles', () => {
  it('survive bundle export and import with their links', () => {
    const restored = restoreTimelineFromBundle(
      JSON.parse(JSON.stringify(convertTimelineForBundle(timeline))),
      new Map(),
    )
    expect(restored?.textStyles).toEqual(timeline.textStyles)
    expect(restored?.items[0]).toMatchObject({
      textStyleId: 'kit-title',
      textStyleOverrides: ['color'],
    })
    expect(validateProject(project(restored)).success).toBe(true)
  })

  it('keep an old single-look style valid through a bundle', () => {
    const old = { ...timeline, textStyles: [legacy] } as unknown as ProjectTimeline
    const restored = restoreTimelineFromBundle(
      JSON.parse(JSON.stringify(convertTimelineForBundle(old))),
      new Map(),
    )
    expect(restored?.textStyles).toEqual([legacy])
    expect(validateProject(project(restored)).success).toBe(true)
  })

  it('reject an invalid style in a project', () => {
    const broken = { ...timeline, textStyles: [{ ...timeline.textStyles![0], role: 'heading' }] }
    expect(validateProject(project(broken)).success).toBe(false)
    const twice = timeline.textStyles![0]!.variants[0]!
    const duplicate = {
      ...timeline,
      textStyles: [{ ...timeline.textStyles![0], variants: [twice, twice] }],
    }
    expect(validateProject(project(duplicate)).success).toBe(false)
  })
})
