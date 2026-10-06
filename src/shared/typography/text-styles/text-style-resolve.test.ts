import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import {
  buildApplyTextStyleUpdates,
  changedTextStyleFields,
  deriveTextStyleFromItem,
  getTextStyleControlledKeys,
  resolveTextStyleUpdates,
  textStyleDifferences,
  textStyleVariantForCanvas,
} from './text-style-resolve'

const VERTICAL = { width: 1080, height: 1920 }
const VERTICAL_720 = { width: 720, height: 1280 }
const LANDSCAPE = { width: 1920, height: 1080 }
const HD720 = { width: 1280, height: 720 }
const SQUARE = { width: 1080, height: 1080 }

const look = {
  fontFamily: 'Anton',
  fontWeight: 'bold',
  fontSize: 120,
  color: '#ffffff',
  letterSpacing: 2,
  textPadding: 24,
  textShadow: { offsetX: 0, offsetY: 6, blur: 18, color: '#000000' },
  stroke: { width: 3, color: '#111111', join: 'miter' },
} as const

/** A vertical look that is bigger and higher than its landscape twin. */
const title: TextStyleDefinition = {
  id: 'big-title',
  name: 'Big title',
  role: 'title',
  variants: [
    {
      aspect: '9:16',
      style: { ...look, fontSize: 150 },
      layout: { yRatio: -0.3, widthRatio: 0.9 },
    },
    { aspect: '16:9', style: look, layout: { yRatio: -0.2, widthRatio: 0.9 } },
  ],
  version: 1,
  updatedAt: 1,
}

function textItem(overrides: Partial<TextItem> = {}): TextItem {
  return {
    id: 't1',
    type: 'text',
    trackId: 'v1',
    from: 0,
    durationInFrames: 60,
    label: 'Hello',
    text: 'Hello',
    color: '#ff0000',
    ...overrides,
  }
}

describe('resolveTextStyleUpdates', () => {
  it("uses the variant for the canvas's aspect", () => {
    const vertical = resolveTextStyleUpdates(title, VERTICAL)
    const landscape = resolveTextStyleUpdates(title, LANDSCAPE)
    expect(vertical.fontSize).toBe(150)
    expect(landscape.fontSize).toBe(120)
    expect(vertical.stroke).toEqual({ width: 3, color: '#111111', join: 'miter' })
    expect(landscape.textShadow).toEqual({ offsetX: 0, offsetY: 6, blur: 18, color: '#000000' })
    expect(vertical.transform).toEqual({ y: -576, width: 972 })
    expect(landscape.transform).toEqual({ y: -216, width: 1728 })
  })

  it('scales a variant uniformly on another resolution of its aspect', () => {
    const small = resolveTextStyleUpdates(title, VERTICAL_720)
    expect(small.fontSize).toBe(100)
    expect(small.transform).toEqual({ y: -384, width: 648 })
    const resolved = resolveTextStyleUpdates(title, HD720)
    expect(resolved.fontSize).toBe(80)
    expect(resolved.letterSpacing).toBe(1.33)
    expect(resolved.textPadding).toBe(16)
    expect(resolved.textShadow?.blur).toBe(12)
    expect(resolved.stroke?.width).toBe(2)
  })

  it('fails on an aspect the style has no variant for, naming the way out', () => {
    expect(() => resolveTextStyleUpdates(title, SQUARE)).toThrow(
      'text style "Big title" has no 1:1 version (it has 9:16, 16:9). Make one from the closest: shred styles clone big-title --aspect 1:1',
    )
    expect(textStyleVariantForCanvas(title, SQUARE)).toBeUndefined()
    expect(textStyleVariantForCanvas(title, { width: 1366, height: 768 })?.aspect).toBe('16:9')
  })

  it('clears look fields the style leaves out and skips overridden fields', () => {
    const resolved = resolveTextStyleUpdates(title, VERTICAL, { overrides: ['color'] })
    expect('backgroundColor' in resolved).toBe(true)
    expect(resolved.backgroundColor).toBeUndefined()
    expect('color' in resolved).toBe(false)
  })

  it('maps span looks onto the item spans by index and keeps the text', () => {
    const style = {
      ...title,
      variants: [
        { ...title.variants[0]!, spanStyles: [{ fontSize: 100 }, { fontSize: 50, color: '#ccc' }] },
      ],
    }
    const spans = [{ text: 'Name' }, { text: 'Role' }, { text: 'Extra', color: '#f00' }]
    expect(resolveTextStyleUpdates(style, VERTICAL, { spans }).textSpans).toEqual([
      { text: 'Name', fontSize: 100 },
      { text: 'Role', fontSize: 50, color: '#ccc' },
      { text: 'Extra', fontSize: 50, color: '#ccc' },
    ])
  })
})

describe('buildApplyTextStyleUpdates', () => {
  it('links the item, clears overrides and built-in presets, and sets the format role', () => {
    const updates = buildApplyTextStyleUpdates(
      textItem({ textStylePresetId: 'poster', textStyleOverrides: ['color'] }),
      title,
      VERTICAL,
    )
    expect(updates).toMatchObject({
      textStyleId: 'big-title',
      formatRole: 'title',
      color: '#ffffff',
    })
    expect(updates.textStyleOverrides).toBeUndefined()
    expect(updates.textStylePresetId).toBeUndefined()
  })

  it('keeps a format role the item already has', () => {
    expect(
      buildApplyTextStyleUpdates(textItem({ formatRole: 'labels' }), title, VERTICAL).formatRole,
    ).toBe('labels')
  })
})

describe('overrides and differences', () => {
  it('reports styled fields an edit changed, never the text', () => {
    const before = textItem({
      ...resolveTextStyleUpdates(title, VERTICAL),
      textStyleId: 'big-title',
    })
    const after = {
      ...before,
      text: 'Changed',
      color: '#00ff00',
      transform: { ...before.transform, y: 10 },
    }
    expect(changedTextStyleFields(before, after, getTextStyleControlledKeys(title))).toEqual([
      'color',
      'transform.y',
    ])
  })

  it('finds where an item no longer matches its style', () => {
    const item = textItem({ ...resolveTextStyleUpdates(title, VERTICAL), textStyleId: 'big-title' })
    expect(textStyleDifferences(item, title, VERTICAL)).toEqual([])
    expect(textStyleDifferences({ ...item, fontSize: 90 }, title, VERTICAL)).toEqual(['fontSize'])
    // No variant for the canvas: nothing to compare with.
    expect(textStyleDifferences(item, title, SQUARE)).toEqual([])
  })

  it('controls the fields of the canvas variant, or of any variant', () => {
    const partial: TextStyleDefinition = {
      ...title,
      variants: [title.variants[0]!, { aspect: '16:9', style: look }],
    }
    expect(getTextStyleControlledKeys(partial, LANDSCAPE)).not.toContain('transform.y')
    expect(getTextStyleControlledKeys(partial, VERTICAL)).toContain('transform.y')
    expect(getTextStyleControlledKeys(partial)).toContain('transform.width')
  })
})

describe('deriveTextStyleFromItem', () => {
  it("round-trips through the variant's reference size from any resolution", () => {
    const resolved = textItem({ ...resolveTextStyleUpdates(title, HD720), textStyleId: 'x' })
    const derived = deriveTextStyleFromItem(resolved, HD720)
    expect(derived.aspect).toBe('16:9')
    expect(derived.style.fontSize).toBe(120)
    expect(derived.style.stroke?.width).toBe(3)
    expect(derived.layout).toEqual({ yRatio: -0.2, widthRatio: 0.9 })
  })
})
