import { describe, expect, it } from 'vite-plus/test'
import type { TextStyleDefinition } from '@/types/text-style'
import {
  findTextStyle,
  normalizeTextStyleInput,
  parseTextStyleInput,
  sanitizeTextStyles,
} from './text-style-schema'

const existing: TextStyleDefinition = {
  id: 'kit-title',
  name: 'Kit Title',
  role: 'title',
  variants: [{ aspect: '9:16', style: { fontSize: 100 } }],
  version: 3,
  updatedAt: 1,
}

describe('text style schema', () => {
  it('gives a new style a readable id from its name', () => {
    const style = normalizeTextStyleInput(
      { name: 'Lower Third!', role: 'lower-third', style: {} },
      [],
      { now: 5, aspect: '16:9' },
    )
    expect(style).toMatchObject({
      id: 'lower-third',
      version: 1,
      updatedAt: 5,
      variants: [{ aspect: '16:9', style: {} }],
    })
  })

  it("lays one look over a matched style's variant for its aspect, keeping the others", () => {
    const landscape = normalizeTextStyleInput(
      { name: 'kit title', role: 'title', style: { fontSize: 90 } },
      [existing],
      { aspect: '16:9' },
    )
    expect(landscape).toMatchObject({ id: 'kit-title', version: 4 })
    expect(landscape.variants.map((v) => [v.aspect, v.style.fontSize])).toEqual([
      ['9:16', 100],
      ['16:9', 90],
    ])
    const vertical = normalizeTextStyleInput(
      { name: 'Kit Title', role: 'title', aspect: '1080x1920', style: { fontSize: 140 } },
      [landscape],
      { aspect: '16:9' },
    )
    expect(vertical.variants.map((v) => [v.aspect, v.style.fontSize])).toEqual([
      ['9:16', 140],
      ['16:9', 90],
    ])
  })

  it('takes a family with one variant per aspect', () => {
    const family = { name: 'F', role: 'title', variants: [{ aspect: '4:5', style: {} }] }
    expect(parseTextStyleInput(family).variants[0]?.aspect).toBe('4:5')
    expect(() =>
      parseTextStyleInput({ ...family, variants: [...family.variants, ...family.variants] }),
    ).toThrow(/one variant per aspect/)
    expect(() =>
      parseTextStyleInput({ name: 'x', role: 'title', aspect: 'tall', style: {} }),
    ).toThrow(/style\.aspect/)
  })

  it('rejects fields an item could not take, naming the field', () => {
    expect(() =>
      parseTextStyleInput({ name: 'x', role: 'title', style: { fontWeight: 'heavy' } }),
    ).toThrow(/style\.style\.fontWeight/)
    expect(() =>
      parseTextStyleInput({ name: 'x', role: 'title', style: {}, textMotion: { in: {} } }),
    ).toThrow(/textMotion/)
    expect(() => parseTextStyleInput({ name: 'x', role: 'heading', style: {} })).toThrow(/role/)
  })

  it('drops invalid and duplicate stored styles', () => {
    expect(sanitizeTextStyles([existing, { ...existing }, { id: 'bad' }]).map((s) => s.id)).toEqual(
      ['kit-title'],
    )
  })

  it('loads an old single-look style as a one-variant family', () => {
    const old = {
      id: 'old',
      name: 'Old',
      role: 'caption',
      style: { fontSize: 60 },
      layout: { yRatio: 0.3 },
      caption: { maxWordsPerChunk: 3, maxCharsPerLine: 20, maxLines: 2, minChunkFrames: 10 },
      version: 2,
      updatedAt: 1,
    }
    const [library] = sanitizeTextStyles([old])
    expect(library).toEqual({
      id: 'old',
      name: 'Old',
      role: 'caption',
      variants: [
        {
          aspect: '9:16',
          style: { fontSize: 60 },
          layout: { yRatio: 0.3 },
          caption: old.caption,
        },
      ],
      version: 2,
      updatedAt: 1,
    })
    // A project's copy becomes a variant for the project's own aspect.
    expect(sanitizeTextStyles([old], '16:9')[0]?.variants[0]?.aspect).toBe('16:9')
  })

  it('finds styles by id or case-insensitive name', () => {
    expect(findTextStyle([existing], 'KIT TITLE')?.id).toBe('kit-title')
    expect(findTextStyle([existing], 'kit-title')?.id).toBe('kit-title')
  })
})
