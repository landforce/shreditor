import { describe, expect, it } from 'vite-plus/test'
import { fitSceneThumb, getSceneThumbAspect } from './scene-thumb-size'

describe('getSceneThumbAspect', () => {
  it('takes the media shape', () => {
    expect(getSceneThumbAspect(1080, 1920)).toBe(1080 / 1920)
    expect(getSceneThumbAspect(1920, 1080)).toBe(1920 / 1080)
  })

  it('clamps like the media cards and falls back to 16:9', () => {
    expect(getSceneThumbAspect(100, 1920)).toBe(9 / 21)
    expect(getSceneThumbAspect(9000, 1000)).toBe(21 / 9)
    expect(getSceneThumbAspect(undefined, undefined)).toBe(16 / 9)
  })
})

describe('fitSceneThumb', () => {
  it('keeps a 16:9 thumbnail filling the list row slot', () => {
    expect(fitSceneThumb(16 / 9, 96, 54)).toEqual({ width: 96, height: 54 })
  })

  it('narrows a 9:16 thumbnail to the slot height instead of cropping it', () => {
    expect(fitSceneThumb(9 / 16, 96, 54)).toEqual({ width: 30, height: 54 })
  })
})
