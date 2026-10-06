import { describe, expect, it } from 'vite-plus/test'
import {
  FILMSTRIP_DEFAULT_TILE_ASPECT,
  FILMSTRIP_TILE_MAX_ASPECT,
  FILMSTRIP_TILE_MIN_ASPECT,
  getFilmstripSampleWidth,
  getFilmstripTileAspect,
  getFilmstripTileWidth,
} from './filmstrip-tile-aspect'

describe('getFilmstripTileAspect', () => {
  it('uses the source display shape', () => {
    expect(getFilmstripTileAspect(1080, 1920)).toBe(1080 / 1920)
    expect(getFilmstripTileAspect(1920, 1080)).toBe(1920 / 1080)
    expect(getFilmstripTileAspect(1080, 1350)).toBe(0.8)
  })

  it('clamps extreme sources so tiles stay usable', () => {
    expect(getFilmstripTileAspect(200, 1920)).toBe(FILMSTRIP_TILE_MIN_ASPECT)
    expect(getFilmstripTileAspect(7680, 1080)).toBe(FILMSTRIP_TILE_MAX_ASPECT)
  })

  it('falls back to 16:9 (or the given fallback) without a usable size', () => {
    expect(getFilmstripTileAspect(undefined, undefined)).toBe(FILMSTRIP_DEFAULT_TILE_ASPECT)
    expect(getFilmstripTileAspect(0, 0)).toBe(FILMSTRIP_DEFAULT_TILE_ASPECT)
    expect(getFilmstripTileAspect(1080, 0)).toBe(FILMSTRIP_DEFAULT_TILE_ASPECT)
    expect(getFilmstripTileAspect(null, 1920, 9 / 16)).toBe(9 / 16)
  })
})

describe('getFilmstripTileWidth', () => {
  it('sizes a tile from the strip height and aspect', () => {
    expect(getFilmstripTileWidth(72, 9 / 16)).toBe(41)
    expect(getFilmstripTileWidth(72, 16 / 9)).toBe(128)
    expect(getFilmstripTileWidth(116, FILMSTRIP_TILE_MIN_ASPECT)).toBe(46)
  })

  it('is 0 until the strip has a height', () => {
    expect(getFilmstripTileWidth(0, 9 / 16)).toBe(0)
  })
})

describe('getFilmstripSampleWidth', () => {
  it('samples once per tile for 16:9 and wider sources', () => {
    expect(getFilmstripSampleWidth(128, 72)).toBe(128)
    expect(getFilmstripSampleWidth(173, 72)).toBe(173)
  })

  it('spaces the first pass of a narrow strip like a 16:9 one', () => {
    expect(getFilmstripSampleWidth(41, 72)).toBe(128)
  })

  it('never returns less than one pixel', () => {
    expect(getFilmstripSampleWidth(0, 0)).toBe(1)
  })
})
