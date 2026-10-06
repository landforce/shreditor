import { describe, expect, it } from 'vite-plus/test'
import { miniFilmTileThumbnailFit } from './thumbnail-fit'

describe('miniFilmTileThumbnailFit', () => {
  it('covers the tile with wide and square frames', () => {
    expect(miniFilmTileThumbnailFit(1920, 1080)).toBe('cover')
    expect(miniFilmTileThumbnailFit(256, 256)).toBe('cover')
  })

  it('shows a portrait frame whole', () => {
    expect(miniFilmTileThumbnailFit(144, 256)).toBe('contain')
  })

  it('covers until the image size is known', () => {
    expect(miniFilmTileThumbnailFit(0, 0)).toBe('cover')
  })
})
