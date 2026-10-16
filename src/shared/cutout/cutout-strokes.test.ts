import { describe, expect, it } from 'vite-plus/test'
import type { CutoutStroke } from '@/types/cutout'
import { cutoutRegionKey, cutoutSettingsProblem, mergeCutoutIndex } from './cutout-core.mjs'
import {
  cutoutStrokeHash,
  regionCovers,
  regionTrackRange,
  simplifyStroke,
  strokeFollowOffset,
  strokePromptPoints,
  strokeRaster,
  trackRegion,
} from './cutout-strokes.mjs'
import {
  interiorPoints,
  maskIoU,
  pickSamCandidate,
  regionStats,
  samCandidate,
  samMaskSize,
  samModelUrl,
  samPixelValues,
  samPromptCoords,
  samResizedSize,
} from './cutout-sam.mjs'
import { canvasToSourcePoint, sourceToCanvasPoint, type StrokeMapFrame } from './cutout-stroke-map'

const stroke = (extra: Partial<CutoutStroke> = {}): CutoutStroke => ({
  tool: 'smartEraser',
  at: 1,
  size: 0.1,
  points: [
    [0.2, 0.5],
    [0.8, 0.5],
  ],
  ...extra,
})

/** A w x h mask with the rectangle [x0, x1) x [y0, y1) set. */
function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const mask = new Float32Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1
  return mask
}

describe('prompt points along a stroke', () => {
  it('spaces up to 16 points evenly by length, ends included', () => {
    const points = strokePromptPoints([
      [0, 0],
      [0.5, 0],
      [1, 0],
    ])
    expect(points).toHaveLength(3)
    const many = strokePromptPoints(
      Array.from({ length: 40 }, (_, i): [number, number] => [i / 39, 0.5]),
    )
    expect(many).toHaveLength(16)
    expect(many[0]).toEqual([0, 0.5])
    expect(many[15]![0]).toBeCloseTo(1)
    expect(many[8]![0]).toBeCloseTo(8 / 15)
  })

  it('a single tap is one point; a zero-length path collapses to one', () => {
    expect(strokePromptPoints([[0.3, 0.4]])).toEqual([[0.3, 0.4]])
    expect(
      strokePromptPoints([
        [0.3, 0.4],
        [0.3, 0.4],
      ]),
    ).toEqual([[0.3, 0.4]])
  })

  it('simplifies painted paths: drops near points, caps the count, clamps to the frame', () => {
    const path = Array.from({ length: 100 }, (_, i): [number, number] => [i / 1000, 1.2])
    const thin = simplifyStroke(path, 0.01)
    expect(thin.length).toBe(10)
    expect(thin.every(([, y]) => y === 1)).toBe(true)
    expect(simplifyStroke(path, 0, 20)).toHaveLength(20)
  })

  it('rasterises the painted area as discs along the path', () => {
    const mask = strokeRaster(stroke({ size: 0.1 }), 20, 10)
    expect(mask[5 * 20 + 10]).toBe(1) // on the path
    expect(mask[0]).toBe(0) // far corner
    expect(mask[5 * 20 + 2]).toBe(0) // left of the start by more than the radius (1 px)
  })
})

describe('stroke identity and validation', () => {
  it('hashes stably and differently per stroke', () => {
    expect(cutoutStrokeHash(stroke())).toBe(cutoutStrokeHash(stroke()))
    expect(cutoutStrokeHash(stroke({ at: 2 }))).not.toBe(cutoutStrokeHash(stroke()))
    expect(cutoutRegionKey({ fingerprint: 'fa', rate: 10, hash: 'k1' })).toBe('fa-slimsam-r10-k1')
  })

  it('validates strokes inside cutout settings', () => {
    const base = { enabled: true, subject: 'auto' }
    expect(cutoutSettingsProblem({ ...base, strokes: [stroke()] })).toBeNull()
    expect(cutoutSettingsProblem({ ...base, strokes: [stroke({ size: 0 })] })).toMatch(/size/)
    expect(cutoutSettingsProblem({ ...base, strokes: [{ ...stroke(), extra: 1 }] })).toMatch(
      /extra: unknown field/,
    )
    expect(
      cutoutSettingsProblem({ ...base, strokes: Array.from({ length: 65 }, () => stroke()) }),
    ).toMatch(/at most 64/)
  })
})

describe('region index entries', () => {
  it('merge by union of samples and stats, and know what range they cover', () => {
    const a = {
      regions: { r: { key: 'r', done: [[1, 3]], covered: [], stats: { 1: [0] } } },
      version: 1,
    }
    const b = {
      regions: { r: { key: 'r', done: [[4, 6]], covered: [[0, 9]], stats: { 4: [1] } } },
      version: 1,
    }
    const merged = mergeCutoutIndex(a, b).regions.r!
    expect(merged.done).toEqual([[1, 6]])
    expect(Object.keys(merged.stats)).toEqual(['1', '4'])
    expect(regionCovers(merged, 2, 9)).toBe(true)
    expect(regionCovers(merged, 2, 10)).toBe(false)
  })

  it('tracks over the clip plus the stroke’s own frame', () => {
    expect(regionTrackRange(stroke({ at: 1.5 }), 10, [10, 40])).toEqual({
      start: 15,
      first: 10,
      last: 40,
    })
    expect(regionTrackRange(stroke({ at: 6 }), 10, [10, 40], 50)).toEqual({
      start: 50,
      first: 10,
      last: 50,
    })
  })
})

describe('IoU tracking', () => {
  // A 40x20 "video" where a 10x10 square moves 1 px right per sample, from x = 2 at sample 0.
  const W = 40
  const H = 20
  const square = (index: number) => rect(W, H, 2 + index, 5, 12 + index, 15)
  const segmentWith =
    (lostAfter = Infinity) =>
    async (index: number, points: Array<[number, number]>) => {
      if (index < 0 || index > 12) return null
      const object = index > lostAfter ? rect(W, H, 34, 0, 38, 3) : square(index)
      // Candidates: the object, the whole frame, an empty mask. Most points must land on the object.
      const hits = points.filter(([x, y]) => object[Math.floor(y * H) * W + Math.floor(x * W)])
      const inside = hits.length * 2 > points.length
      return {
        candidates: [
          inside ? object : rect(W, H, 0, 0, 1, 1),
          rect(W, H, 0, 0, W, H),
          rect(W, H, 0, 0, 0, 0),
        ],
        scores: [0.5, 0.9, 0.1],
        width: W,
        height: H,
      }
    }
  // Over the square at sample 5 (x 7..17, y 5..15).
  const painted = stroke({
    at: 5,
    size: 0.2,
    points: [
      [0.3, 0.5],
      [0.33, 0.5],
    ],
  })

  it('keeps the candidate that best overlaps the stroke, then the previous region', async () => {
    const regions = []
    for await (const region of trackRegion({
      stroke: painted,
      start: 5,
      first: 0,
      last: 12,
      segment: segmentWith(),
    })) {
      regions.push(region)
    }
    expect(regions.map((r) => r.index)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 4, 3, 2, 1, 0])
    for (const region of regions) expect(maskIoU(region.mask, square(region.index))).toBe(1)
    // The centroid follows the square.
    expect(regions[0]!.stats![0]).toBeCloseTo((7 + 5) / W)
  })

  it('stops a direction when the overlap drops below 0.25', async () => {
    const indices = []
    for await (const region of trackRegion({
      stroke: painted,
      start: 5,
      first: 0,
      last: 12,
      segment: segmentWith(8),
    })) {
      indices.push(region.index)
    }
    expect(indices).toEqual([5, 6, 7, 8, 4, 3, 2, 1, 0])
  })

  it('picks by score without a reference, by overlap with one', () => {
    const a = rect(4, 4, 0, 0, 2, 2)
    const b = rect(4, 4, 0, 0, 4, 4)
    expect(pickSamCandidate([a, b], [0.2, 0.8], null)).toEqual({ index: 1, iou: 0.8 })
    expect(pickSamCandidate([a, b], [0.2, 0.8], a).index).toBe(0)
    expect(maskIoU(a, b)).toBe(0.25)
  })

  it('prompts the next frame from deep inside the region', () => {
    const mask = rect(20, 20, 4, 4, 16, 16)
    const points = interiorPoints(mask, 20, 20, 4)
    expect(points.length).toBeGreaterThan(0)
    for (const [x, y] of points) {
      expect(x).toBeGreaterThan(0.25)
      expect(x).toBeLessThan(0.75)
      expect(y).toBeGreaterThan(0.25)
      expect(y).toBeLessThan(0.75)
    }
    expect(interiorPoints(new Float32Array(16), 4, 4)).toEqual([])
  })

  it('region stats: centroid, box and area as fractions', () => {
    expect(regionStats(rect(10, 10, 2, 4, 6, 8), 10, 10)).toEqual([
      0.4, 0.6, 0.2, 0.4, 0.6, 0.8, 0.16,
    ])
    expect(regionStats(new Float32Array(4), 2, 2)).toBeNull()
  })
})

describe('plain strokes follow tracked regions', () => {
  const region = {
    rate: 10,
    stats: {
      10: [0.5, 0.5, 0.3, 0.3, 0.7, 0.7, 0.16],
      11: [0.6, 0.5, 0.4, 0.3, 0.8, 0.7, 0.16],
      12: [0.7, 0.55, 0.5, 0.35, 0.9, 0.75, 0.16],
    },
  }
  const brush = stroke({
    tool: 'brush',
    at: 1,
    points: [
      [0.45, 0.5],
      [0.55, 0.5],
    ],
  })

  it('moves with the centroid of the region it was painted in, interpolated between samples', () => {
    expect(strokeFollowOffset(brush, [region], 1)).toEqual([0, 0])
    const [dx, dy] = strokeFollowOffset(brush, [region], 1.15)
    expect(dx).toBeCloseTo(0.15)
    expect(dy).toBeCloseTo(0.025)
    // Past the tracked samples it holds the nearest one.
    expect(strokeFollowOffset(brush, [region], 3)[0]).toBeCloseTo(0.2)
  })

  it('stays put when no region held it', () => {
    const outside = stroke({ tool: 'eraser', at: 1, points: [[0.05, 0.05]] })
    expect(strokeFollowOffset(outside, [region], 1.2)).toEqual([0, 0])
    expect(strokeFollowOffset(brush, [], 1.2)).toEqual([0, 0])
  })
})

describe('SlimSAM input and output', () => {
  it('resizes to a 1024 long edge, pads, and maps prompts into it', () => {
    const resized = samResizedSize(1920, 1080)
    expect(resized).toEqual({ width: 1024, height: 576 })
    expect(samMaskSize(resized)).toEqual({ width: 256, height: 144 })
    expect(Array.from(samPromptCoords([[0.5, 0.25]], resized))).toEqual([512, 144])
    const pixels = samPixelValues(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1)
    expect(pixels).toHaveLength(3 * 1024 * 1024)
    expect(pixels[0]).toBeCloseTo((1 - 0.485) / 0.229)
    expect(pixels[1]).toBe(0) // padding
  })

  it('crops a candidate’s logits to the frame as probabilities', () => {
    const logits = new Float32Array(3 * 256 * 256).fill(-10)
    logits[256 * 256 + 1] = 10 // candidate 1, row 0, column 1
    const mask = samCandidate(logits, 1, { width: 2, height: 2 })
    expect(Array.from(mask, (v) => Math.round(v))).toEqual([0, 1, 0, 0])
  })

  it('downloads from the pinned revision', () => {
    expect(samModelUrl('decoder', 'webgpu')).toBe(
      'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/prompt_encoder_mask_decoder_quantized.onnx',
    )
  })
})

describe('stroke-to-source mapping', () => {
  const frame: StrokeMapFrame = {
    canvas: { width: 1080, height: 1920 },
    transform: { x: 0, y: 0, width: 1080, height: 1920, rotation: 0 },
    sourceWidth: 1920,
    sourceHeight: 1080,
  }

  it('maps a contained 16:9 clip in a 9:16 canvas', () => {
    // The clip is 1080 x 607.5, centred: its top is at y 656.25.
    expect(canvasToSourcePoint({ x: 540, y: 960 }, frame)).toEqual([0.5, 0.5])
    const [x, y] = canvasToSourcePoint({ x: 270, y: 656.25 + 607.5 * 0.25 }, frame)!
    expect(x).toBeCloseTo(0.25)
    expect(y).toBeCloseTo(0.25)
    expect(canvasToSourcePoint({ x: 540, y: 100 }, frame)).toBeNull() // above the picture
  })

  it('undoes rotation, flips, offsets and crop, and round-trips', () => {
    const moved: StrokeMapFrame = {
      ...frame,
      transform: { x: 100, y: -50, width: 800, height: 450, rotation: 30 },
      flipHorizontal: true,
      crop: { left: 0.1, top: 0.05 },
    }
    for (const point of [
      [0.3, 0.4],
      [0.75, 0.6],
    ] as Array<[number, number]>) {
      const onCanvas = sourceToCanvasPoint(point, moved)
      const back = canvasToSourcePoint(onCanvas, moved)!
      expect(back[0]).toBeCloseTo(point[0])
      expect(back[1]).toBeCloseTo(point[1])
    }
    // A flipped clip: the canvas's left edge of the picture is the source's right.
    const flipped = { ...frame, flipHorizontal: true }
    expect(canvasToSourcePoint({ x: 10, y: 960 }, flipped)![0]).toBeGreaterThan(0.99)
    // Inside the cropped-away strip there is nothing to paint.
    const cropped = { ...frame, crop: { left: 0.2 } }
    expect(canvasToSourcePoint({ x: 100, y: 960 }, cropped)).toBeNull()
  })
})
