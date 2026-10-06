import { describe, expect, it } from 'vite-plus/test'
import { buildMotionTemplate, type StoredComposition } from './template-core.mjs'
import { adaptCompositionToCanvas, axisAnchor, cloneTemplateVariant } from './template-variants.mjs'

const track = { id: 't', name: 'V1', items: [] }
const at = (id: string, transform: object, extra: object = {}) => ({
  id,
  type: 'shape',
  shapeType: 'rectangle',
  fillColor: '#f00',
  trackId: 't',
  from: 0,
  durationInFrames: 60,
  label: id,
  transform,
  ...extra,
})

// A 9:16 lower third: a bar near the bottom, a centred title, a corner logo.
const portrait = {
  id: 'lt',
  name: 'Lower third',
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 60,
  tracks: [track],
  items: [
    at('bar', { x: 0, y: 700, width: 900, height: 200 }),
    at(
      'title',
      { x: 0, y: 0, width: 800, height: 120 },
      { type: 'text', text: 'Hi', fontSize: 60 },
    ),
    at('logo', { x: 440, y: -860, width: 100, height: 100 }),
  ],
  keyframes: [
    {
      itemId: 'bar',
      properties: [
        {
          property: 'y',
          keyframes: [
            { id: 'k0', frame: 0, value: 1100, easing: 'linear' },
            { id: 'k1', frame: 10, value: 700, easing: 'linear' },
          ],
        },
      ],
    },
  ],
  compositionControls: {
    version: 1,
    controls: [
      {
        id: 'c',
        name: 'Bar',
        targetItemId: 'bar',
        property: 'shape.fillColor',
        kind: 'color',
        defaultValue: '#f00',
      },
    ],
  },
} as unknown as StoredComposition

const byId = (composition: StoredComposition, id: string) =>
  composition.items.find((item) => item.id === id)!

describe('cloning a template variant', () => {
  it('anchors each axis to the nearest edge or the centre', () => {
    expect(axisAnchor(700, 200, 1920)).toBe('end')
    expect(axisAnchor(0, 900, 1080)).toBe('centre')
    expect(axisAnchor(-860, 100, 1920)).toBe('start')
  })

  it('a bar near the bottom stays near the bottom, centred stays centred, sizes by short side', () => {
    const landscape = adaptCompositionToCanvas(portrait, { width: 1920, height: 1080 })
    expect([landscape.width, landscape.height]).toEqual([1920, 1080])
    // Short side 1080 -> 1080: scale 1. The bar's bottom edge stays 160px off the bottom.
    expect(byId(landscape, 'bar').transform).toMatchObject({
      x: 0,
      y: 280,
      width: 900,
      height: 200,
    })
    expect(byId(landscape, 'title').transform).toMatchObject({ x: 0, y: 0, width: 800 })
    // The logo keeps its top-right corner distances.
    expect(byId(landscape, 'logo').transform).toMatchObject({ x: 860, y: -440 })
    // The bar's slide-in keyframes move with it (off the bottom to its place).
    const lane = landscape.keyframes![0]!.properties[0]!
    expect(lane.keyframes.map((k) => k.value)).toEqual([680, 280])
  })

  it('a keyframe with the item wholly off the frame stays off that side', () => {
    const sliding = {
      ...portrait,
      keyframes: [
        {
          itemId: 'title',
          properties: [
            {
              property: 'x',
              keyframes: [
                { id: 'a', frame: 0, value: -1100, easing: 'linear' },
                { id: 'b', frame: 10, value: 0, easing: 'linear' },
                { id: 'c', frame: 20, value: 1100, easing: 'linear' },
              ],
            },
          ],
        },
      ],
    } as unknown as StoredComposition
    const landscape = adaptCompositionToCanvas(sliding, { width: 1920, height: 1080 })
    const values = landscape.keyframes![0]!.properties[0]!.keyframes.map((k) => k.value)
    // Off the left by 160px (1100 - 540 - 400) in 9:16, still off the left in 16:9.
    expect(values).toEqual([-1520, 0, 1520])
  })

  it('scales sizes by the short side when the resolution changes', () => {
    const small = adaptCompositionToCanvas(portrait, { width: 1280, height: 720 })
    const scale = 720 / 1080
    expect(byId(small, 'bar').transform!.width).toBeCloseTo(900 * scale)
    expect((byId(small, 'title') as { fontSize: number }).fontSize).toBeCloseTo(60 * scale)
    // Bottom distance (160) scales too.
    expect(byId(small, 'bar').transform!.y).toBeCloseTo(360 - 160 * scale - 100 * scale)
  })

  it('adds the variant from the closest aspect, keeps controls by name and bumps the version', () => {
    const template = buildMotionTemplate({
      rootCompositionId: 'lt',
      compositions: [portrait],
      name: 'Lower third',
      hold: { start: 20, end: 20 },
      newId: () => 'tpl',
    })
    const { template: next, from } = cloneTemplateVariant(template, {
      aspect: '16:9',
      canvas: { width: 1920, height: 1080 },
      now: 7,
    })
    expect(from).toBe('9:16')
    expect(next.version).toBe(2)
    const variant = next.variants['16:9']!
    expect(variant).toMatchObject({
      aspect: '16:9',
      version: 2,
      width: 1920,
      height: 1080,
      hold: { start: 20, end: 20 },
      thumbnail: 'thumbnail-16x9.webp',
    })
    expect(variant.controls.map((c) => [c.name, c.targetItemId])).toEqual([['Bar', 'bar']])
    expect(next.variants['9:16']!.version).toBe(1)
    expect(() =>
      cloneTemplateVariant(next, { aspect: '16:9', canvas: { width: 1920, height: 1080 } }),
    ).toThrow(/already has a 16:9 version/)
    expect(() =>
      cloneTemplateVariant(next, { aspect: '1:1', canvas: { width: 1920, height: 1080 } }),
    ).toThrow(/is not 1:1/)
  })
})
