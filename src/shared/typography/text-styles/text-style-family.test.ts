import { describe, expect, it } from 'vite-plus/test'
import type { TextStyleDefinition, TextStyleVariant } from '@/types/text-style'
import {
  addClonedTextStyleVariant,
  cloneTextStyleVariant,
  mergeTextStyleFamilies,
  referenceCanvasForAspect,
  seedTextStyles,
  textStyleLibraryNeedsSeed,
  toTextStyleFamily,
} from './text-style-family.mjs'
import { resolveTextStyleUpdates } from './text-style-resolve'

const caption: TextStyleVariant = {
  aspect: '9:16',
  style: { fontSize: 77, fontFamily: 'Inter', stroke: { width: 2, color: '#000' } },
  layout: { yRatio: 0.36, widthRatio: 0.7, heightRatio: 0.16 },
  caption: { maxWordsPerChunk: 4, maxCharsPerLine: 18, maxLines: 2, minChunkFrames: 12 },
}

const style: TextStyleDefinition = {
  id: 'kit-captions',
  name: 'Kit captions',
  role: 'caption',
  variants: [caption],
  version: 2,
  updatedAt: 1,
}

/** Gap between the box's bottom edge and the canvas's, as a share of the height. */
const bottomGap = (layout: TextStyleVariant['layout']) =>
  0.5 - layout!.yRatio! - layout!.heightRatio! / 2

describe('variant reference canvases', () => {
  it('have a short side of 1080', () => {
    expect(referenceCanvasForAspect('9:16')).toEqual({ width: 1080, height: 1920 })
    expect(referenceCanvasForAspect('16:9')).toEqual({ width: 1920, height: 1080 })
    expect(referenceCanvasForAspect('4:5')).toEqual({ width: 1080, height: 1350 })
    expect(referenceCanvasForAspect('1:1')).toEqual({ width: 1080, height: 1080 })
  })
})

describe('cloning a variant for another aspect', () => {
  it('keeps the look and its pixel sizes (short sides match)', () => {
    const wide = cloneTextStyleVariant(caption, '16:9')
    expect(wide.aspect).toBe('16:9')
    expect(wide.style).toEqual(caption.style)
    expect(wide.caption).toEqual(caption.caption)
    const tall = resolveTextStyleUpdates(
      { ...style, variants: [caption] },
      { width: 1080, height: 1920 },
    )
    const flat = resolveTextStyleUpdates(
      { ...style, variants: [wide] },
      { width: 1920, height: 1080 },
    )
    expect(flat.fontSize).toBe(tall.fontSize)
    expect(flat.stroke).toEqual(tall.stroke)
    // The box keeps its pixel size: 756 wide, 307 tall.
    expect(flat.transform?.width).toBe(tall.transform?.width)
    expect(Math.abs(flat.transform!.height! - tall.transform!.height!)).toBeLessThanOrEqual(1)
  })

  it('keeps a bottom box at the bottom, the same share of the canvas from the edge', () => {
    const wide = cloneTextStyleVariant(caption, '16:9')
    expect(wide.layout!.yRatio!).toBeGreaterThan(0.25)
    expect(bottomGap(wide.layout)).toBeCloseTo(bottomGap(caption.layout), 2)
    const back = cloneTextStyleVariant(wide, '9:16')
    expect(back.layout!.yRatio!).toBeCloseTo(0.36, 2)
  })

  it('keeps a top anchor at the top and a centred box centred', () => {
    const top = cloneTextStyleVariant(
      { aspect: '9:16', style: {}, layout: { yRatio: -0.3 } },
      '16:9',
    )
    expect(top.layout).toEqual({ yRatio: -0.3 })
    const centred = cloneTextStyleVariant(
      { aspect: '16:9', style: {}, layout: { xRatio: 0.02, yRatio: 0, heightRatio: 0.2 } },
      '9:16',
    )
    expect(centred.layout).toMatchObject({ xRatio: 0.02, yRatio: 0 })
    const left = cloneTextStyleVariant(
      { aspect: '16:9', style: {}, layout: { xRatio: -0.3, widthRatio: 0.3 } },
      '9:16',
    )
    // Same share of the width from the left edge.
    expect(0.5 + left.layout!.xRatio! - left.layout!.widthRatio! / 2).toBeCloseTo(0.05, 2)
  })

  it('fits a box wider than the new canvas', () => {
    const tall = cloneTextStyleVariant(
      { aspect: '16:9', style: {}, layout: { widthRatio: 0.8 } },
      '9:16',
    )
    expect(tall.layout).toEqual({ widthRatio: 0.9 })
  })

  it('adds a variant from the closest aspect, or the one named', () => {
    const { style: withSquare, from } = addClonedTextStyleVariant(style, '4:5')
    expect(from).toBe('9:16')
    expect(withSquare.variants.map((v) => v.aspect)).toEqual(['9:16', '4:5'])
    const both = addClonedTextStyleVariant(withSquare, '16:9', '4:5')
    expect([both.from, both.style.variants.map((v) => v.aspect)]).toEqual([
      '4:5',
      ['9:16', '16:9', '4:5'],
    ])
    expect(() => addClonedTextStyleVariant(style, '9:16')).toThrow(/already has a 9:16 version/)
    expect(() => addClonedTextStyleVariant(style, '16:9', '1:1')).toThrow(/no 1:1 version/)
  })
})

describe('families', () => {
  it('turn an old single look into one variant, else stay as they are', () => {
    const old = {
      id: 'a',
      name: 'A',
      role: 'title',
      style: { fontSize: 9 },
      version: 1,
      updatedAt: 0,
    }
    expect(toTextStyleFamily(old)).toEqual({
      id: 'a',
      name: 'A',
      role: 'title',
      version: 1,
      updatedAt: 0,
      variants: [{ aspect: '9:16', style: { fontSize: 9 } }],
    })
    expect(toTextStyleFamily(old, '16:9').variants[0]?.aspect).toBe('16:9')
    expect(toTextStyleFamily(style)).toEqual(style)
  })

  it('merge variant by variant, the incoming side winning', () => {
    const wide = { ...style, name: 'Renamed', variants: [cloneTextStyleVariant(caption, '16:9')] }
    const merged = mergeTextStyleFamilies(style, wide)
    expect(merged.name).toBe('Renamed')
    expect(merged.variants.map((v) => v.aspect)).toEqual(['9:16', '16:9'])
  })

  it('seed the built-ins once, never beside a style with the same id or name', () => {
    const builtins = [
      { ...style, id: 'clean-title', name: 'Clean' },
      { ...style, id: 'poster', name: 'Poster' },
    ]
    expect(seedTextStyles([{ ...style, name: 'clean' }], builtins).map((s) => s.id)).toEqual([
      'kit-captions',
      'poster',
    ])
    expect(textStyleLibraryNeedsSeed(null)).toBe(true)
    expect(textStyleLibraryNeedsSeed({ styles: [] })).toBe(true)
    expect(textStyleLibraryNeedsSeed({ seeded: 1 })).toBe(false)
  })
})
