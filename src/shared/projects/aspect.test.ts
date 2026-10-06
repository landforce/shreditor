import { describe, expect, it } from 'vite-plus/test'
import { aspectKey, closestAspect } from './aspect'

describe('aspect keys', () => {
  it('reduces a canvas to its aspect, the same for every resolution', () => {
    expect(aspectKey(1080, 1920)).toBe('9:16')
    expect(aspectKey(720, 1280)).toBe('9:16')
    expect(aspectKey(1920, 1080)).toBe('16:9')
    expect(aspectKey(1080, 1080)).toBe('1:1')
    expect(aspectKey(1080, 1350)).toBe('4:5')
    expect(aspectKey(1440, 1080)).toBe('4:3')
    expect(aspectKey(2560, 1080)).toBe('64:27')
  })

  it('snaps near misses to the common aspects', () => {
    expect(aspectKey(1366, 768)).toBe('16:9')
    expect(aspectKey(854, 480)).toBe('16:9')
    expect(() => aspectKey(0, 1080)).toThrow()
  })

  it('picks the closest available aspect', () => {
    expect(closestAspect('4:5', ['9:16', '16:9'])).toBe('9:16')
    expect(closestAspect('64:27', ['9:16', '16:9'])).toBe('16:9')
    expect(closestAspect('16:9', ['1:1', '16:9'])).toBe('16:9')
    expect(() => closestAspect('16:9', [])).toThrow()
  })
})
