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
} from './text-style-resolve'

const VERTICAL = { width: 1080, height: 1920 }
const LANDSCAPE = { width: 1920, height: 1080 }
const HD720 = { width: 1280, height: 720 }

const title: TextStyleDefinition = {
  id: 'big-title',
  name: 'Big title',
  role: 'title',
  style: {
    fontFamily: 'Anton',
    fontWeight: 'bold',
    fontSize: 120,
    color: '#ffffff',
    letterSpacing: 2,
    textPadding: 24,
    textShadow: { offsetX: 0, offsetY: 6, blur: 18, color: '#000000' },
    stroke: { width: 3, color: '#111111', join: 'miter' },
  },
  layout: { yRatio: -0.3, widthRatio: 0.9 },
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
  it('gives the same pixel sizes on 1080x1920 and 1920x1080 (short side 1080)', () => {
    const vertical = resolveTextStyleUpdates(title, VERTICAL)
    const landscape = resolveTextStyleUpdates(title, LANDSCAPE)
    expect(vertical.fontSize).toBe(120)
    expect(landscape.fontSize).toBe(120)
    expect(vertical.stroke).toEqual({ width: 3, color: '#111111', join: 'miter' })
    expect(landscape.textShadow).toEqual({ offsetX: 0, offsetY: 6, blur: 18, color: '#000000' })
  })

  it('places the box by canvas ratios, so it moves with the canvas shape', () => {
    expect(resolveTextStyleUpdates(title, VERTICAL).transform).toEqual({ y: -576, width: 972 })
    expect(resolveTextStyleUpdates(title, LANDSCAPE).transform).toEqual({ y: -324, width: 1728 })
  })

  it('scales every length with the short side elsewhere', () => {
    const resolved = resolveTextStyleUpdates(title, HD720)
    expect(resolved.fontSize).toBe(80)
    expect(resolved.letterSpacing).toBe(1.33)
    expect(resolved.textPadding).toBe(16)
    expect(resolved.textShadow?.blur).toBe(12)
    expect(resolved.stroke?.width).toBe(2)
  })

  it('clears look fields the style leaves out and skips overridden fields', () => {
    const resolved = resolveTextStyleUpdates(title, VERTICAL, { overrides: ['color'] })
    expect('backgroundColor' in resolved).toBe(true)
    expect(resolved.backgroundColor).toBeUndefined()
    expect('color' in resolved).toBe(false)
  })

  it('maps span looks onto the item spans by index and keeps the text', () => {
    const style = { ...title, spanStyles: [{ fontSize: 100 }, { fontSize: 50, color: '#ccc' }] }
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
  })
})

describe('deriveTextStyleFromItem', () => {
  it('round-trips through the reference size from any canvas', () => {
    const resolved = textItem({ ...resolveTextStyleUpdates(title, HD720), textStyleId: 'x' })
    const derived = deriveTextStyleFromItem(resolved, HD720)
    expect(derived.style.fontSize).toBe(120)
    expect(derived.style.stroke?.width).toBe(3)
    expect(derived.layout).toEqual({ yRatio: -0.3, widthRatio: 0.9 })
  })
})
