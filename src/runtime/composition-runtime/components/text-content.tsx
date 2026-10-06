import React, { useCallback, useMemo } from 'react'
import { useGizmoStore, useTimelineStore } from '@/runtime/composition-runtime/deps/stores'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import type { TextItem } from '@/types/timeline'
import { resolveSpanStyles, resolveTextStyle } from '@/shared/typography/text-style'
import { loadFont } from '../utils/fonts'
import { useCompositionSpace } from '../contexts/composition-space-context'
import { useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useItemKeyframesFromContext } from '../contexts/keyframes-context'
import { useVideoConfig } from '../hooks/use-player-compat'
import { resolveAnimatedTextItem } from '@/runtime/composition-runtime/deps/keyframes'

const VERTICAL_ALIGN_TO_FLEX: Record<string, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
}

interface BackgroundBoxStyles {
  outer: React.CSSProperties
  inner: React.CSSProperties
  /** 'lines' mode: the inline box behind each line (CSS `box-decoration-break: clone`). */
  line?: React.CSSProperties
}

/**
 * Where the background and padding go. Default ('text' mode) the inner wrapper
 * hugs the text block and carries both; 'box' mode paints the whole item box
 * (a fixed-size panel) on the outer wrapper, which then holds the padding;
 * 'lines' mode gives every line its own inline box, which carries the
 * horizontal padding (so the outer wrapper keeps only the vertical one).
 */
function getBackgroundBoxStyles(
  style: ReturnType<typeof resolveTextStyle>,
  scale: number,
): BackgroundBoxStyles {
  const padX = style.paddingX * scale
  const padY = style.paddingY * scale
  const padding = `${padY}px ${padX}px`
  const borderRadius = `${style.backgroundRadius * scale}px`
  if (!style.backgroundColor) return { outer: { padding }, inner: { padding: 0 } }
  const fill = { backgroundColor: style.backgroundColor, borderRadius }
  if (style.backgroundMode === 'lines') {
    return {
      outer: { padding: `${padY}px 0` },
      inner: { padding: 0 },
      line: {
        ...fill,
        padding,
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone',
      },
    }
  }
  return style.backgroundMode === 'box'
    ? { outer: { padding, ...fill }, inner: { padding: 0 } }
    : { outer: { padding: 0 }, inner: { padding, ...fill } }
}

const TEXT_ALIGN_TO_FLEX: Record<string, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
}

/**
 * Text content with live property preview support.
 * Reads preview values from gizmo store for real-time updates during slider/picker drag.
 *
 * Style resolution (defaults + per-span cascade) goes through the shared
 * {@link resolveTextStyle}/{@link resolveSpanStyles} so the DOM preview, the
 * canvas renderer, and the GPU pipeline agree on every default; this component
 * keeps native CSS layout (it is the WYSIWYG reference) and applies the
 * composition-space scale on top of the resolved values.
 */
export const TextContent: React.FC<{ item: TextItem & { _sequenceFrameOffset?: number } }> = ({
  item,
}) => {
  const compositionSpace = useCompositionSpace()
  const { fps } = useVideoConfig()
  const sequenceContext = useSequenceContext()
  const contextKeyframes = useItemKeyframesFromContext(item.id)
  const storeKeyframes = useTimelineStore(
    useCallback((s) => s.keyframes.find((entry) => entry.itemId === item.id), [item.id]),
  )
  const itemKeyframes = contextKeyframes ?? storeKeyframes
  const relativeFrame = (sequenceContext?.localFrame ?? 0) - (item._sequenceFrameOffset ?? 0)
  const scaleX = compositionSpace?.scaleX ?? 1
  const scaleY = compositionSpace?.scaleY ?? 1
  const scale = compositionSpace?.scale ?? 1
  const logicalCanvas = useMemo(
    () => ({
      width: compositionSpace?.projectWidth ?? DEFAULT_PROJECT_WIDTH,
      height: compositionSpace?.projectHeight ?? DEFAULT_PROJECT_HEIGHT,
      fps,
    }),
    [compositionSpace?.projectHeight, compositionSpace?.projectWidth, fps],
  )
  const resolvedItem = useMemo(
    () => resolveAnimatedTextItem(item, itemKeyframes, relativeFrame, logicalCanvas),
    [item, itemKeyframes, logicalCanvas, relativeFrame],
  )

  // Read preview values from unified preview system
  const itemPreview = useGizmoStore(useCallback((s) => s.preview?.[item.id], [item.id]))
  const preview = itemPreview?.properties

  // Merge live preview overrides onto the resolved item, then run the shared
  // style resolver so defaults + span cascade match the other render paths.
  const hasTextShadowPreview =
    preview !== undefined && Object.prototype.hasOwnProperty.call(preview, 'textShadow')
  const hasStrokePreview =
    preview !== undefined && Object.prototype.hasOwnProperty.call(preview, 'stroke')
  const hasTextSpansPreview =
    preview !== undefined && Object.prototype.hasOwnProperty.call(preview, 'textSpans')

  const mergedItem = useMemo<TextItem>(
    () => ({
      ...resolvedItem,
      text: preview?.text ?? resolvedItem.text,
      textSpans: hasTextSpansPreview ? preview?.textSpans : resolvedItem.textSpans,
      fontSize: preview?.fontSize ?? resolvedItem.fontSize,
      letterSpacing: preview?.letterSpacing ?? resolvedItem.letterSpacing,
      lineHeight: preview?.lineHeight ?? resolvedItem.lineHeight,
      color: preview?.color ?? resolvedItem.color,
      backgroundColor: preview?.backgroundColor ?? resolvedItem.backgroundColor,
      backgroundRadius: preview?.backgroundRadius ?? resolvedItem.backgroundRadius,
      textPadding: preview?.textPadding ?? resolvedItem.textPadding,
      textPaddingX: preview?.textPaddingX ?? resolvedItem.textPaddingX,
      textPaddingY: preview?.textPaddingY ?? resolvedItem.textPaddingY,
      textShadow: hasTextShadowPreview ? preview?.textShadow : resolvedItem.textShadow,
      stroke: hasStrokePreview ? preview?.stroke : resolvedItem.stroke,
    }),
    [hasStrokePreview, hasTextShadowPreview, hasTextSpansPreview, preview, resolvedItem],
  )

  const style = resolveTextStyle(mergedItem)
  const spanStyles = resolveSpanStyles(mergedItem)

  const justifyContent = TEXT_ALIGN_TO_FLEX[style.textAlign] ?? 'center'
  const alignItems = VERTICAL_ALIGN_TO_FLEX[style.verticalAlign] ?? 'center'

  const cssTextShadow = style.textShadow
    ? `${style.textShadow.offsetX * scaleX}px ${style.textShadow.offsetY * scaleY}px ${style.textShadow.blur * scale}px ${style.textShadow.color}`
    : undefined
  const strokeWidth = style.stroke?.width ? `${style.stroke.width * scale * 2}px` : undefined
  const background = getBackgroundBoxStyles(style, scale)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems,
        justifyContent,
        boxSizing: 'border-box',
        ...background.outer,
      }}
    >
      <div
        style={{
          ...background.inner,
          textAlign: style.textAlign,
          textShadow: cssTextShadow,
          WebkitTextStrokeWidth: strokeWidth,
          WebkitTextStrokeColor: style.stroke?.color,
          strokeLinejoin: style.stroke?.join,
          // Paint stroke first, then fill on top — without this, a thick
          // stroke covers the fill entirely (text becomes solid stroke
          // color, e.g. illegible black-on-black for the TikTok preset).
          paintOrder: 'stroke fill',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          width: 'fit-content',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <SpanBlocks
          spanLayout={mergedItem.spanLayout}
          spanStyles={spanStyles}
          lineHeight={style.lineHeight}
          scale={scale}
          scaleX={scaleX}
          lineBox={background.line}
        />
      </div>
    </div>
  )
}

interface SpanBlockProps {
  spanStyles: ReturnType<typeof resolveSpanStyles>
  lineHeight: number
  scale: number
  scaleX: number
  /** 'lines' background mode: the inline box every line of text sits in. */
  lineBox?: React.CSSProperties
}

/**
 * Spaces are kept as typed ('pre-wrap'), except with per-line boxes: there a
 * space where a line wraps would widen that line's box on the right, which
 * the canvas renderers (which drop it) don't, so they collapse ('pre-line').
 */
function lineWhiteSpace(lineBox: React.CSSProperties | undefined): 'pre-wrap' | 'pre-line' {
  return lineBox ? 'pre-line' : 'pre-wrap'
}

/** Text inside the per-line inline box, when the item has one. */
function InLineBox({
  lineBox,
  children,
}: {
  lineBox?: React.CSSProperties
  children: React.ReactNode
}) {
  return lineBox ? <span style={lineBox}>{children}</span> : <>{children}</>
}

/** Picks the span flow: 'inline' (one wrapped stream) vs default stacked lines. */
function SpanBlocks({
  spanLayout,
  ...props
}: SpanBlockProps & { spanLayout: 'stack' | 'inline' | undefined }) {
  const inline = spanLayout === 'inline' && props.spanStyles.length > 0
  return inline ? <InlineSpanFlow {...props} /> : <StackedSpans {...props} />
}

/**
 * Inline span flow: one wrapped text stream, spans recolor/underline words
 * inside a line. Font/size come from the FIRST span — same base-style rule as
 * the shared layoutTextBlock inline path.
 */
function InlineSpanFlow({ spanStyles, lineHeight, scale, scaleX, lineBox }: SpanBlockProps) {
  const base = spanStyles[0]!
  return (
    <div
      style={{
        fontSize: base.fontSize * scale,
        fontFamily: loadFont(base.fontFamily),
        fontWeight: base.fontWeight,
        fontStyle: base.fontStyle,
        lineHeight,
        letterSpacing: base.letterSpacing * scaleX,
        display: 'block',
        whiteSpace: lineWhiteSpace(lineBox),
        wordBreak: 'break-word',
        width: '100%',
      }}
    >
      <InLineBox lineBox={lineBox}>
        {spanStyles.map((span, index) => (
          <span
            key={`${index}:${span.text}`}
            style={{
              color: span.color,
              textDecoration: span.underline ? 'underline' : 'none',
            }}
          >
            {span.text}
          </span>
        ))}
      </InLineBox>
    </div>
  )
}

/** Default flow: every span is its own block line-group. */
function StackedSpans({ spanStyles, lineHeight, scale, scaleX, lineBox }: SpanBlockProps) {
  return (
    <>
      {spanStyles.map((span, index) => (
        <div
          key={`${index}:${span.text}`}
          style={{
            fontSize: span.fontSize * scale,
            fontFamily: loadFont(span.fontFamily),
            fontWeight: span.fontWeight,
            fontStyle: span.fontStyle,
            textDecoration: span.underline ? 'underline' : 'none',
            color: span.color,
            lineHeight,
            letterSpacing: span.letterSpacing * scaleX,
            display: 'block',
            whiteSpace: lineWhiteSpace(lineBox),
            wordBreak: 'break-word',
            width: '100%',
          }}
        >
          <InLineBox lineBox={lineBox}>{span.text}</InLineBox>
        </div>
      ))}
    </>
  )
}
