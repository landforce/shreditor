export type TextFontWeight = 'normal' | 'medium' | 'semibold' | 'bold'
export type TextFontStyle = 'normal' | 'italic'
export type TextHorizontalAlign = 'left' | 'center' | 'right'
export type TextVerticalAlign = 'top' | 'middle' | 'bottom'

export type TextInlineStyleFields = {
  fontSize?: number
  fontFamily?: string
  fontWeight?: TextFontWeight
  fontStyle?: TextFontStyle
  underline?: boolean
  color?: string
  letterSpacing?: number
}

export type TextSpan = TextInlineStyleFields & {
  text: string
}

export type TextSingleLayoutDraft = TextSpan

export type TextLayoutDrafts = {
  single?: TextSingleLayoutDraft
  twoSpans?: TextSpan[]
  threeSpans?: TextSpan[]
}

export type TextShadow = {
  offsetX: number
  offsetY: number
  blur: number
  color: string
}

export type TextStrokeJoin = 'round' | 'miter' | 'bevel'

export type TextStroke = {
  width: number
  color: string
  /**
   * Corner style of the outline. Default 'round'. 'miter' keeps square,
   * die-cut corners (sharp glyph points past the miter limit fall back to a
   * bevel so they don't spike).
   */
  join?: TextStrokeJoin
}

/**
 * How `backgroundColor` is painted. 'text' (default) is one box around the
 * laid-out lines (plus the padding); 'lines' is one box behind each line,
 * hugging that line's text (plus the padding), like CSS inline backgrounds;
 * 'box' fills the item's whole transform box, so the text sits inside a
 * fixed-size rounded panel (e.g. a chat pill).
 */
export type TextBackgroundMode = 'text' | 'lines' | 'box'

export type TextVisualStyleFields = {
  backgroundColor?: string
  backgroundRadius?: number
  backgroundMode?: TextBackgroundMode
  textAlign?: TextHorizontalAlign
  verticalAlign?: TextVerticalAlign
  lineHeight?: number
  textPadding?: number
  /** Horizontal padding (left and right); falls back to `textPadding`. */
  textPaddingX?: number
  /** Vertical padding (top and bottom); falls back to `textPadding`. */
  textPaddingY?: number
  textShadow?: TextShadow
  stroke?: TextStroke
}

export type TextStyleFields = TextInlineStyleFields & TextVisualStyleFields
