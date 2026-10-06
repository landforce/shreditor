import { describe, expect, it } from 'vite-plus/test'
import {
  getJustifiedCardCellStyle,
  getJustifiedRowsClass,
  getMediaCardAspect,
} from './media-grid-constants'

describe('justified media rows', () => {
  it('sizes a card cell by its aspect at the row height', () => {
    // itemSize 3 rows are 156px tall.
    expect(getJustifiedCardCellStyle(getMediaCardAspect({ width: 1080, height: 1920 }), 3)).toEqual(
      {
        flex: `${9 / 16} 1 ${(9 / 16) * 156}px`,
        minWidth: 0,
        maxWidth: `${(9 / 16) * 156 * 1.4}px`,
      },
    )
  })

  it('shapes a composition card like a media card of the same size', () => {
    const composition = { width: 1080, height: 1920 }
    expect(getMediaCardAspect(composition)).toBe(9 / 16)
  })

  it('wraps cells in a flex row with the size gap', () => {
    expect(getJustifiedRowsClass(1)).toContain('flex flex-wrap gap-1')
  })
})
