import { describe, expect, it } from 'vite-plus/test'
import type { MotionTemplateVariantView } from '@/shared/motion-templates/template-core.mjs'
import {
  chooseTemplateTrack,
  cloneTemplateCompositions,
  findTemplateComposition,
  fitTemplateToCanvas,
  planTemplateUpdate,
  resolveInstanceDuration,
  resolveTemplateControlOverrides,
} from './motion-template-instances'
import type { SubComposition } from '../stores/compositions-store'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'

const template = {
  id: 'tpl',
  name: 'Callout',
  version: 2,
  templateVersion: 2,
  aspect: '9:16',
  hold: { start: 10, end: 12 },
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
} as unknown as MotionTemplateVariantView

describe('motion template instances', () => {
  it('copies compositions with fresh ids and every reference rewritten', () => {
    let n = 0
    const copy = cloneTemplateCompositions(template, () => `n${++n}`)
    const [root, sub] = copy.compositions
    expect(root!.templateId).toBe('tpl')
    expect(root!.templateVersion).toBe(2)
    expect(root!.templateAspect).toBe('9:16')
    expect(root!.templateHold).toEqual({ start: 10, end: 12 })
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

  it('a same-aspect variant fills the canvas: 1:1, or scaled uniformly at another resolution', () => {
    expect(fitTemplateToCanvas({ width: 1080, height: 1920 }, { width: 1080 })).toEqual({
      width: 1080,
      height: 1920,
    })
    expect(fitTemplateToCanvas({ width: 1080, height: 1920 }, { width: 720 })).toEqual({
      width: 720,
      height: 1280,
    })
  })

  it('an instance longer than its template needs a hold', () => {
    const plain = { name: 'Callout', durationInFrames: 30 }
    expect(resolveInstanceDuration(plain, undefined)).toBe(30)
    expect(resolveInstanceDuration(plain, 20)).toBe(20)
    expect(() => resolveInstanceDuration(plain, 31)).toThrow(/has no hold.*--hold/)
    expect(resolveInstanceDuration({ ...plain, templateHold: { start: 5, end: 5 } }, 90)).toBe(90)
  })

  it('finds the project copy of one variant; update keeps held lengths and refreshes the hold', () => {
    const { compositions } = cloneTemplateCompositions(template, () => crypto.randomUUID())
    const copy = compositions[0]!
    expect(findTemplateComposition(compositions, 'tpl', '9:16')).toBe(copy)
    expect(findTemplateComposition(compositions, 'tpl', '16:9')).toBeUndefined()
    const instance = {
      id: 'i',
      type: 'composition',
      compositionId: copy.id,
      trackId: 'v1',
      from: 0,
      durationInFrames: 90,
      label: 'Callout',
      templateHold: { start: 10, end: 12 },
    } as unknown as TimelineItem
    const next = { ...template, version: 3, hold: { start: 14, end: 14 } }
    const plan = planTemplateUpdate({
      template: next as MotionTemplateVariantView,
      compositions: compositions as SubComposition[],
      rootItems: [instance],
    })!
    expect(plan.rootItems[0]).toMatchObject({
      durationInFrames: 90,
      templateHold: { start: 14, end: 14 },
    })
    // Without a hold the instance is cut back to the template's length.
    const unheld = planTemplateUpdate({
      template: { ...template, version: 3, hold: undefined } as MotionTemplateVariantView,
      compositions: compositions as SubComposition[],
      rootItems: [instance],
    })!
    expect(unheld.rootItems[0]!.durationInFrames).toBe(30)
    expect(unheld.rootItems[0]).not.toHaveProperty('templateHold')
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
