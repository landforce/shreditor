import { describe, expect, it } from 'vite-plus/test'
import { aspectKey, canvasForAspect, closestAspect, parseAspect, sortAspects } from './aspect.mjs'

describe('aspect keys', () => {
  it('names the common canvases whatever their resolution', () => {
    expect(aspectKey(1080, 1920)).toBe('9:16')
    expect(aspectKey(720, 1280)).toBe('9:16')
    expect(aspectKey(1920, 1080)).toBe('16:9')
    expect(aspectKey(1366, 768)).toBe('16:9') // within 1%
    expect(aspectKey(1080, 1080)).toBe('1:1')
    expect(aspectKey(1080, 1350)).toBe('4:5')
  })

  it('reduces any other canvas to W:H', () => {
    expect(aspectKey(1440, 1080)).toBe('4:3')
    expect(aspectKey(2560, 1080)).toBe('64:27')
    expect(() => aspectKey(0, 10)).toThrow(/not a canvas size/)
  })

  it('reads 16:9, 16x9, 16/9 and canvas sizes', () => {
    expect(parseAspect('16:9')).toBe('16:9')
    expect(parseAspect('16x9')).toBe('16:9')
    expect(parseAspect('9/16')).toBe('9:16')
    expect(parseAspect('1920x1080')).toBe('16:9')
    expect(parseAspect('2.39:1')).toBe('239:100')
    expect(() => parseAspect('wide')).toThrow(/not an aspect ratio/)
  })

  it('finds the closest ratio and sorts named aspects first', () => {
    expect(closestAspect('16:9', ['9:16', '1:1'])).toBe('1:1')
    expect(closestAspect('4:5', ['9:16', '16:9'])).toBe('9:16')
    expect(closestAspect('1:1', [])).toBeNull()
    expect(sortAspects(['4:3', '1:1', '16:9', '9:16', '21:9'])).toEqual([
      '9:16',
      '16:9',
      '1:1',
      '21:9',
      '4:3',
    ])
  })

  it('sizes a canvas for an aspect by its short side', () => {
    expect(canvasForAspect('16:9', 1080)).toEqual({ width: 1920, height: 1080 })
    expect(canvasForAspect('9:16', 1080)).toEqual({ width: 1080, height: 1920 })
    expect(canvasForAspect('4:5', 1080)).toEqual({ width: 1080, height: 1350 })
  })
})
