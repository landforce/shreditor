import { describe, expect, it } from 'vite-plus/test'
import type { MotionTemplate } from '@/shared/motion-templates/template-core.mjs'
import {
  chooseTemplateTrack,
  cloneTemplateCompositions,
  fitTemplateToCanvas,
  resolveTemplateControlOverrides,
} from './motion-template-instances'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'

const template = {
  id: 'tpl',
  name: 'Callout',
  version: 2,
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 30,
  composition: {
    id: 'root',
    name: 'Callout',
    fps: 30,
    width: 1080,
    height: 1920,
    durationInFrames: 30,
    tracks: [
      {
        id: 'trk',
        name: 'T',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ],
    items: [
      {
        id: 'a',
        type: 'text',
        text: 'Hi',
        color: '#fff',
        trackId: 'trk',
        from: 0,
        durationInFrames: 30,
        label: 'A',
      },
      {
        id: 'b',
        type: 'composition',
        compositionId: 'sub',
        trackId: 'trk',
        from: 0,
        durationInFrames: 30,
        label: 'B',
        transformParent: { parentItemId: 'a' },
      },
    ],
    keyframes: [{ itemId: 'a', properties: [] }],
    transitions: [],
    compositionControls: {
      version: 1,
      controls: [
        {
          id: 'c',
          name: 'Text',
          targetItemId: 'a',
          property: 'text.text',
          kind: 'text',
          defaultValue: 'Hi',
        },
      ],
    },
  },
  subCompositions: [
    {
      id: 'sub',
      name: 'Sub',
      fps: 30,
      width: 10,
      height: 10,
      durationInFrames: 30,
      tracks: [],
      items: [],
    },
  ],
  controls: [],
  media: [],
} as unknown as MotionTemplate

describe('motion template instances', () => {
  it('copies compositions with fresh ids and every reference rewritten', () => {
    let n = 0
    const copy = cloneTemplateCompositions(template, () => `n${++n}`)
    const [root, sub] = copy.compositions
    expect(root!.templateId).toBe('tpl')
    expect(root!.templateVersion).toBe(2)
    expect(root!.id).not.toBe('root')
    const [text, nested] = root!.items
    expect(text!.id).not.toBe('a')
    expect(text!.trackId).toBe(root!.tracks[0]!.id)
    expect(nested!.compositionId).toBe(sub!.id)
    expect(nested!.transformParent?.parentItemId).toBe(text!.id)
    expect(root!.keyframes[0]!.itemId).toBe(text!.id)
    expect(root!.compositionControls!.controls[0]).toMatchObject({
      id: 'c',
      targetItemId: text!.id,
    })
  })

  it('fits the project width keeping the aspect ratio', () => {
    expect(fitTemplateToCanvas({ width: 1920, height: 1080 }, { width: 1080 })).toEqual({
      width: 1080,
      height: 608,
    })
    expect(fitTemplateToCanvas({ width: 1080, height: 1920 }, { width: 1920 })).toEqual({
      width: 1920,
      height: 3413,
    })
  })

  it('resolves values by control name; the source value clears an override', () => {
    const source = template.composition as never
    expect(resolveTemplateControlOverrides(source, { text: 'Yo' })).toEqual({ c: 'Yo' })
    expect(resolveTemplateControlOverrides(source, { Text: 'Hi' }, { c: 'Yo' })).toBeUndefined()
    expect(() => resolveTemplateControlOverrides(source, { Txt: 'x' })).toThrow(/Controls: "Text"/)
  })

  it('picks a free role track, then a track other instances use, else none', () => {
    const tracks = [
      { id: 'top', order: 0, kind: 'video' },
      { id: 'labels', order: 1, kind: 'video', formatRole: 'labels' },
    ] as TimelineTrack[]
    const busy = [{ id: 'x', trackId: 'labels', from: 0, durationInFrames: 50 }] as TimelineItem[]
    const used = [
      { id: 'i', trackId: 'top', from: 100, durationInFrames: 10, compositionId: 'tc' },
    ] as TimelineItem[]
    const base = { tracks, from: 0, durationInFrames: 30, templateCompositionIds: new Set(['tc']) }
    expect(chooseTemplateTrack({ ...base, items: [], role: 'labels' })).toBe('labels')
    expect(chooseTemplateTrack({ ...base, items: [...busy, ...used], role: 'labels' })).toBe('top')
    expect(chooseTemplateTrack({ ...base, items: busy })).toBeNull()
  })
})
