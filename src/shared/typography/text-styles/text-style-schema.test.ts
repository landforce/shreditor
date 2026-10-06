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
  style: { fontSize: 100 },
  version: 3,
  updatedAt: 1,
}

describe('text style schema', () => {
  it('gives a new style a readable id from its name', () => {
    const style = normalizeTextStyleInput({ name: 'Lower Third!', role: 'lower-third', style: {} }, [], 5)
    expect(style).toMatchObject({ id: 'lower-third', version: 1, updatedAt: 5 })
  })

  it('replaces a style matched by name and bumps its version', () => {
    const style = normalizeTextStyleInput({ name: 'kit title', role: 'title', style: { fontSize: 90 } }, [existing])
    expect(style).toMatchObject({ id: 'kit-title', version: 4 })
  })

  it('rejects fields an item could not take, naming the field', () => {
    expect(() => parseTextStyleInput({ name: 'x', role: 'title', style: { fontWeight: 'heavy' } }))
      .toThrow(/style\.style\.fontWeight/)
    expect(() => parseTextStyleInput({ name: 'x', role: 'title', style: {}, textMotion: { in: {} } }))
      .toThrow(/textMotion/)
    expect(() => parseTextStyleInput({ name: 'x', role: 'heading', style: {} })).toThrow(/role/)
  })

  it('drops invalid and duplicate stored styles', () => {
    expect(sanitizeTextStyles([existing, { ...existing }, { id: 'bad' }]).map((s) => s.id)).toEqual([
      'kit-title',
    ])
  })

  it('finds styles by id or case-insensitive name', () => {
    expect(findTextStyle([existing], 'KIT TITLE')?.id).toBe('kit-title')
    expect(findTextStyle([existing], 'kit-title')?.id).toBe('kit-title')
  })
})
