import { describe, expect, it } from 'vite-plus/test'
import { aspectRatio } from '@/shared/projects/aspect.mjs'
import { cappedAspectBoxStyle } from './aspect-box'

describe('cappedAspectBoxStyle', () => {
  it('lets a 16:9 box fill a narrow card (cap far above its width)', () => {
    expect(cappedAspectBoxStyle(aspectRatio('16:9'), 128)).toEqual({
      aspectRatio: String(16 / 9),
      width: '100%',
      maxWidth: '228px',
    })
  })

  it('caps a 9:16 box at the max height by narrowing it', () => {
    // Motion template card: a 9:16 variant's thumbnail is at most 90x160.
    expect(cappedAspectBoxStyle(aspectRatio('9:16'), 160)).toEqual({
      aspectRatio: String(9 / 16),
      width: '100%',
      maxWidth: '90px',
    })
    // Scene card: 72x128 at most.
    expect(cappedAspectBoxStyle(9 / 16, 128).maxWidth).toBe('72px')
  })

  it('falls back to 16:9 for an unusable aspect', () => {
    expect(cappedAspectBoxStyle(Number.NaN, 90).aspectRatio).toBe(String(16 / 9))
  })
})
