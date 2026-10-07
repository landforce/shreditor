import { describe, expect, it } from 'vite-plus/test'
import { textOutlineCss } from './text-outline'

describe('textOutlineCss', () => {
  it('draws a round outline as a ring of shadows at the outline width', () => {
    const { ring, webkitStrokeWidth } = textOutlineCss({ width: 10, color: '#000' }, 0.5)
    expect(webkitStrokeWidth).toBeUndefined()
    const shadows = ring!.split(', ')
    expect(shadows.length).toBeGreaterThanOrEqual(12)
    for (const shadow of shadows) {
      const [x, y] = shadow.split(' ').map((v) => Number.parseFloat(v))
      expect(Math.hypot(x!, y!)).toBeCloseTo(5, 1)
      expect(shadow.endsWith(' 0 #000')).toBe(true)
    }
  })

  it('keeps enough shadows that a thick outline has no gaps, within a cap', () => {
    expect(textOutlineCss({ width: 10, color: '#000' }, 1).ring!.split(', ').length).toBe(53)
    expect(textOutlineCss({ width: 200, color: '#000' }, 1).ring!.split(', ').length).toBe(96)
  })

  it('keeps the CSS stroke only for an explicit mitre outline, and nothing without a width', () => {
    expect(textOutlineCss({ width: 4, color: '#fff', join: 'miter' }, 1)).toEqual({
      webkitStrokeWidth: '8px',
    })
    expect(textOutlineCss({ width: 0, color: '#fff' }, 1)).toEqual({})
    expect(textOutlineCss(undefined, 1)).toEqual({})
  })
})
