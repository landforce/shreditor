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
 * How `backgroundColor` is painted. 'text' (default) hugs the laid-out lines
 * (plus `textPadding`); 'box' fills the item's whole transform box, so the
 * text sits inside a fixed-size rounded panel (e.g. a chat pill).
 */
export type TextBackgroundMode = 'text' | 'box'

export type TextVisualStyleFields = {
  backgroundColor?: string
  backgroundRadius?: number
  backgroundMode?: TextBackgroundMode
  textAlign?: TextHorizontalAlign
  verticalAlign?: TextVerticalAlign
  lineHeight?: number
  textPadding?: number
  textShadow?: TextShadow
  stroke?: TextStroke
}

export type TextStyleFields = TextInlineStyleFields & TextVisualStyleFields
