import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import { layoutTextBlock, textBlockBackgrounds } from './text-block-layout'
import { parseFontSizePx, type TextMeasurer } from './text-measurer'
import { resolveTextStyle } from './text-style'

/** Fixed-advance font: 0.5 em per character, ascent 0.8 em, descent 0.2 em. */
const measurer: TextMeasurer = {
  measure: (text, cssFont, letterSpacing) =>
    text.length * parseFontSizePx(cssFont) * 0.5 + text.length * letterSpacing,
  fontMetrics: (cssFont) => {
    const size = parseFontSizePx(cssFont)
    return { ascent: size * 0.8, descent: size * 0.2 }
  },
}

function item(overrides: Partial<TextItem>): TextItem {
  return {
    id: 'p',
    type: 'text',
    trackId: 't',
    from: 0,
    durationInFrames: 30,
    label: 'x',
    text: 'AAAA BBBBBB',
    color: '#000',
    fontSize: 100,
    lineHeight: 1,
    backgroundColor: '#fff',
    ...overrides,
  } as TextItem
}

describe('text padding split into horizontal and vertical', () => {
  it('falls back to the one value, and X/Y win over it', () => {
    expect(resolveTextStyle(item({ textPadding: 12 }))).toMatchObject({
      paddingX: 12,
      paddingY: 12,
    })
    expect(resolveTextStyle(item({ textPadding: 12, textPaddingX: 30 }))).toMatchObject({
      paddingX: 30,
      paddingY: 12,
    })
    expect(resolveTextStyle(item({}))).toMatchObject({ paddingX: 16, paddingY: 16 })
  })

  it('insets the text by X horizontally and Y vertically (text mode box)', () => {
    const layout = layoutTextBlock(
      item({ textPaddingX: 30, textPaddingY: 5, verticalAlign: 'top', textAlign: 'left' }),
      2000,
      400,
      measurer,
    )
    expect(layout.lines).toHaveLength(1)
    expect(layout.lines[0]).toMatchObject({ startX: 30, top: 5 })
    // One box around the block: the line plus 30 left/right and 5 top/bottom.
    expect(layout.background).toEqual({ x: 0, y: 0, width: 550 + 60, height: 110, radius: 0 })
    expect(layout.lineBackgrounds).toBeUndefined()
  })

  it('wraps within the box minus the horizontal padding only', () => {
    // 'AAAA BBBBBB' is 550 wide at 100px; a 600 box fits it only with X padding under 25.
    const narrow = layoutTextBlock(item({ textPaddingX: 30, textPaddingY: 0 }), 600, 400, measurer)
    expect(narrow.lines.map((line) => line.text)).toEqual(['AAAA', 'BBBBBB'])
    const wide = layoutTextBlock(item({ textPaddingX: 20, textPaddingY: 80 }), 600, 400, measurer)
    expect(wide.lines.map((line) => line.text)).toEqual(['AAAA BBBBBB'])
  })
})

describe("backgroundMode 'lines': one box behind each line", () => {
  const lines = (overrides: Partial<TextItem> = {}) =>
    layoutTextBlock(
      item({
        backgroundMode: 'lines',
        backgroundRadius: 16,
        textPaddingX: 29,
        textPaddingY: 4,
        verticalAlign: 'top',
        lineHeight: 1.2,
        ...overrides,
      }),
      500,
      800,
      measurer,
    )

  it('hugs each line: its width plus X, the font content area plus Y', () => {
    const layout = lines()
    expect(layout.background).toBeUndefined()
    const boxes = textBlockBackgrounds(layout)
    expect(boxes).toHaveLength(2)
    const [first, second] = layout.lines
    // 550 doesn't fit 500 - 2 x 29, so it wraps. Line 1 'AAAA' (200 wide), centred
    // in 500: text at 150, box at 121, 258 wide; top at the 4 px padding, the
    // content area (80 + 20) starts a half-leading (10) lower, minus padY.
    expect(first).toMatchObject({ text: 'AAAA', startX: 150, top: 4 })
    expect(boxes[0]).toEqual({ x: 121, y: 4 + 10 - 4, width: 258, height: 108, radius: 16 })
    // Line 2 'BBBBBB' (300 wide): its own box, one line height (120) lower.
    expect(second).toMatchObject({ text: 'BBBBBB', startX: 100, top: 124 })
    expect(boxes[1]).toEqual({ x: 71, y: 130, width: 358, height: 108, radius: 16 })
  })

  it('skips blank lines', () => {
    const layout = lines({ text: 'AAAA\n\nBBBB' })
    expect(layout.lines.map((line) => line.text)).toEqual(['AAAA', '', 'BBBB'])
    expect(textBlockBackgrounds(layout).map((box) => box.y)).toEqual([10, 250])
  })

  it('has no boxes without a background colour', () => {
    expect(textBlockBackgrounds(lines({ backgroundColor: undefined }))).toEqual([])
  })
})
