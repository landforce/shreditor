import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { CUTOUT_MODELS } from '@/shared/cutout/cutout-core.mjs'
import { planCutoutNeeds, planCutoutRegions } from './cutout-plan'
import { alphaCoverage, maskSize, smoothAlpha } from './cutout-temporal'
import {
  cutoutLayerBlend,
  cutoutPrecision,
  cutoutTextureFormat,
  orderCutoutLayers,
  refineBounds,
  strokeChunks,
} from './cutout-compositor'
import type { CutoutLayer } from './cutout-masks'
import { cutoutModelInputSize, normalizeModelAlpha, rgbaToModelInput } from './cutout-model'
import type { CutoutMediaInfo } from './cutout-masks'

const info: CutoutMediaInfo = {
  fingerprint: 'fx',
  fps: 30,
  duration: 10,
  width: 1920,
  height: 1080,
}
const clip = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'video',
    trackId: 't',
    from: 0,
    durationInFrames: 60,
    label: id,
    src: '',
    mediaId: 'm1',
    sourceStart: 30,
    sourceFps: 30,
    cutout: { enabled: true, subject: 'auto' },
    ...extra,
  }) as unknown as TimelineItem

describe('planCutoutNeeds', () => {
  it('groups clips of one media, subject and rate, merging their padded ranges', () => {
    const needs = planCutoutNeeds(
      [clip('a'), clip('b', { from: 60, sourceStart: 90 }), clip('off', { cutout: undefined })],
      30,
      () => info,
    )
    expect(needs).toHaveLength(1)
    expect(needs[0]).toMatchObject({
      mediaId: 'm1',
      subject: 'auto',
      rate: 10,
      itemIds: ['a', 'b'],
    })
    expect(needs[0]!.need).toEqual([[9, 51]])
  })

  it('a different subject or sample rate is its own analysis', () => {
    const needs = planCutoutNeeds(
      [clip('a'), clip('b', { cutout: { enabled: true, subject: 'object', sampleRate: 'full' } })],
      30,
      () => info,
    )
    expect(needs.map((n) => [n.subject, n.rate])).toEqual([
      ['auto', 10],
      ['object', 30],
    ])
  })

  it('a frame render needs only the samples around that frame', () => {
    const [need] = planCutoutNeeds([clip('a')], 30, () => info, [15])
    // frame 15 of the clip is source 1.5 s → samples 14..16
    expect(need!.need).toEqual([[14, 16]])
    expect(planCutoutNeeds([clip('a')], 30, () => info, [500])).toEqual([])
  })

  it('skips clips whose media is unknown', () => {
    expect(planCutoutNeeds([clip('a')], 30, () => null)).toEqual([])
  })
})

describe('temporal smoothing', () => {
  it('keeps the previous matte where the picture is still and lets motion through', () => {
    const alpha = new Float32Array([1, 1])
    const previous = new Float32Array([0, 0])
    const still = smoothAlpha(
      alpha,
      previous,
      new Float32Array([0.5, 0.5]),
      new Float32Array([0.5, 0.2]),
      0.5,
    )
    expect(still[0]).toBeCloseTo(0.5) // no motion: halfway to the previous matte
    expect(still[1]).toBeCloseTo(1) // moved 0.3: the new matte wins
  })

  it('measures coverage and fits mask sizes inside the long edge', () => {
    expect(alphaCoverage(new Float32Array([0.9, 0.1, 0.6, 0]))).toBe(0.5)
    expect(maskSize(1920, 1080, 640)).toEqual({ width: 640, height: 360 })
    expect(maskSize(320, 180, 640)).toEqual({ width: 320, height: 180 })
  })
})

describe('compositing and model I/O', () => {
  it('refine 0 keeps the soft matte; 1 is a hard edge at one half', () => {
    expect(refineBounds(0)).toEqual([0, 1])
    const [lo, hi] = refineBounds(1)
    expect(lo).toBeCloseTo(0.49)
    expect(hi).toBeCloseTo(0.51)
  })

  it('MODNet keeps the aspect at a 512 short edge in multiples of 32; U-2-Net is 320 square', () => {
    expect(cutoutModelInputSize(CUTOUT_MODELS.modnet, 1920, 1080)).toEqual({
      width: 896,
      height: 512,
    })
    expect(cutoutModelInputSize(CUTOUT_MODELS.modnet, 1080, 1920)).toEqual({
      width: 512,
      height: 896,
    })
    expect(cutoutModelInputSize(CUTOUT_MODELS.u2net, 1920, 1080)).toEqual({
      width: 320,
      height: 320,
    })
  })

  it('normalizes pixels per channel into planes, and logits through a sigmoid', () => {
    const input = rgbaToModelInput(
      CUTOUT_MODELS.modnet,
      new Uint8ClampedArray([255, 0, 255, 255]),
      1,
      1,
    )
    expect([...input]).toEqual([1, -1, 1])
    expect([...normalizeModelAlpha([0, 0.5, 1])]).toEqual([0, 0.5, 1])
    const logits = normalizeModelAlpha([-10, 0, 10])
    expect(logits[0]).toBeLessThan(0.001)
    expect(logits[1]).toBeCloseTo(0.5)
    expect(logits[2]).toBeGreaterThan(0.999)
    expect([...normalizeModelAlpha([0.2, 0.4, 0.6], true)].map((v) => +v.toFixed(3))).toEqual([
      0, 0.5, 1,
    ])
  })
})

describe('smart brush planning', () => {
  const smart = { tool: 'smartEraser', at: 2, size: 0.05, points: [[0.5, 0.5]] }
  it('tracks each smart stroke over the clips that carry it, plain strokes need nothing', () => {
    const strokes = [smart, { ...smart, tool: 'brush' }]
    const needs = planCutoutRegions(
      [
        clip('a', { cutout: { enabled: true, subject: 'auto', strokes } }),
        clip('b', {
          from: 60,
          sourceStart: 120,
          cutout: { enabled: true, subject: 'auto', strokes },
        }),
        clip('off', { cutout: { enabled: false, subject: 'auto', strokes } }),
      ],
      30,
      () => info,
    )
    expect(needs).toHaveLength(1)
    // a plays source 1..3 s (samples 9..31 padded), b 4..6 s (39..61): one range, painted at sample 20.
    expect(needs[0]!.range).toEqual({ start: 20, first: 9, last: 61 })
    expect(needs[0]!.stroke.tool).toBe('smartEraser')
  })
})

describe('correction compositing', () => {
  const bitmap = {} as ImageBitmap
  const region = (erase: boolean): CutoutLayer => ({
    kind: 'region',
    erase,
    a: bitmap,
    b: bitmap,
    t: 0,
  })
  const plain = (erase: boolean, x: number): CutoutLayer => ({
    kind: 'stroke',
    erase,
    points: [[x, 0.5]],
    size: 0.1,
  })

  it('composites smart-brush regions, then smart-eraser regions, then plain strokes as painted', () => {
    const layers = [plain(true, 0.1), region(true), plain(false, 0.2), region(false)]
    const order = orderCutoutLayers(layers)
    expect(order.map((l) => `${l.kind}:${l.erase ? 'erase' : 'add'}`)).toEqual([
      'region:add',
      'region:erase',
      'stroke:erase',
      'stroke:add',
    ])
    expect(order[2]).toBe(layers[0])
  })

  it('adds with max and erases by multiplying by 1 - coverage', () => {
    const gl = { MAX: 1, FUNC_ADD: 2, ONE: 3, ZERO: 4, SRC_COLOR: 5 } as unknown as Parameters<
      typeof cutoutLayerBlend
    >[0]
    expect(cutoutLayerBlend(gl, false)).toEqual({ equation: 1, src: 3, dst: 3 })
    expect(cutoutLayerBlend(gl, true)).toEqual({ equation: 2, src: 4, dst: 5 })
  })

  it('splits long strokes into overlapping chunks the shader takes', () => {
    const points = Array.from({ length: 130 }, (_, i): [number, number] => [i / 130, 0])
    const chunks = strokeChunks(points)
    expect(chunks.map((c) => c.length)).toEqual([64, 64, 4])
    expect(chunks[1]![0]).toEqual(chunks[0]![63])
    expect(strokeChunks([[0, 0]])).toEqual([[[0, 0]]])
  })
})

describe('HDR precision of the cutout pass', () => {
  const gl = {
    RGBA: 1,
    RGBA8: 2,
    RGBA16F: 3,
    UNSIGNED_BYTE: 4,
    HALF_FLOAT: 5,
  } as unknown as Parameters<typeof cutoutTextureFormat>[0]
  it('is half-float only for a float16 destination this WebGL2 can render', () => {
    const can = { floatRenderable: true, floatDrawingBuffer: true }
    expect(cutoutPrecision({ ...can, destinationColorType: 'float16' })).toBe('float16')
    expect(cutoutPrecision({ ...can, destinationColorType: 'unorm8' })).toBe('unorm8')
    expect(cutoutPrecision({ ...can, destinationColorType: undefined })).toBe('unorm8')
    expect(
      cutoutPrecision({
        destinationColorType: 'float16',
        floatRenderable: false,
        floatDrawingBuffer: true,
      }),
    ).toBe('unorm8')
    expect(
      cutoutPrecision({
        destinationColorType: 'float16',
        floatRenderable: true,
        floatDrawingBuffer: false,
      }),
    ).toBe('unorm8')
  })

  it('uploads RGBA16F half floats on the HDR path, RGBA8 bytes otherwise', () => {
    expect(cutoutTextureFormat(gl, 'float16')).toEqual([3, 1, 5])
    expect(cutoutTextureFormat(gl, 'unorm8')).toEqual([2, 1, 4])
  })
})
