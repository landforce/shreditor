/**
 * Text style resolution: turn a canvas-relative style definition into the
 * concrete fields an item renders with, derive a style from an item, and tell
 * which fields an item has moved away from its style.
 *
 * Resolved fields are WRITTEN onto items (see text-style-actions.ts), so the
 * preview, every export path and the scorecard never need to know styles exist.
 */

import type { TextItem, TextSpan } from '@/types/timeline'
import type { TextStyleFields } from '@/types/text'
import type { TransformProperties } from '@/types/transform'
import {
  TEXT_STYLE_REFERENCE_SIZE,
  type TextStyleDefinition,
  type TextStyleFieldKey,
  type TextStyleLayout,
  type TextStyleLook,
  type TextStyleRole,
} from '@/types/text-style'
import type { FormatRole } from '@formats/registry.mjs'

interface StyleCanvas {
  width: number
  height: number
}

/** Look fields every style controls (a field a style leaves out is cleared). */
const TEXT_STYLE_LOOK_KEYS = [
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'underline',
  'color',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'verticalAlign',
  'backgroundColor',
  'backgroundMode',
  'backgroundRadius',
  'textPadding',
  'textShadow',
  'stroke',
] as const satisfies ReadonlyArray<keyof TextStyleFields>

type LookKey = (typeof TEXT_STYLE_LOOK_KEYS)[number]

const LAYOUT_AXES = [
  { key: 'transform.x', ratio: 'xRatio', field: 'x', basis: 'width' },
  { key: 'transform.y', ratio: 'yRatio', field: 'y', basis: 'height' },
  { key: 'transform.width', ratio: 'widthRatio', field: 'width', basis: 'width' },
  { key: 'transform.height', ratio: 'heightRatio', field: 'height', basis: 'height' },
] as const

type SpanStyle = Omit<TextSpan, 'text'>
const SPAN_STYLE_KEYS = [
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'underline',
  'color',
  'letterSpacing',
] as const satisfies ReadonlyArray<keyof SpanStyle>

/** Style role -> the format role an item made with it plays. */
const FORMAT_ROLE_BY_STYLE_ROLE: Record<TextStyleRole, FormatRole | undefined> = {
  title: 'title',
  caption: 'captions',
  label: 'labels',
  'lower-third': 'labels',
  other: undefined,
}

function formatRoleForTextStyle(role: TextStyleRole): FormatRole | undefined {
  return FORMAT_ROLE_BY_STYLE_ROLE[role]
}

/** Style role that suits a format track role, for picker suggestions. */
export function textStyleRoleMatchesFormatRole(role: TextStyleRole, formatRole?: string): boolean {
  return Boolean(formatRole) && FORMAT_ROLE_BY_STYLE_ROLE[role] === formatRole
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Reference pixels -> canvas pixels (and back with `1 / scale`). */
function textStyleScaleFor(canvas: StyleCanvas): number {
  return Math.min(canvas.width, canvas.height) / TEXT_STYLE_REFERENCE_SIZE
}

/** Scale every length field of a look; everything else is copied as is. */
function scaleLook(look: TextStyleLook, scale: number): TextStyleLook {
  const scaled: TextStyleLook = { ...look }
  const len = (value: number | undefined) =>
    value === undefined ? undefined : round2(value * scale)
  if (look.fontSize !== undefined) scaled.fontSize = len(look.fontSize)
  if (look.letterSpacing !== undefined) scaled.letterSpacing = len(look.letterSpacing)
  if (look.textPadding !== undefined) scaled.textPadding = len(look.textPadding)
  if (look.backgroundRadius !== undefined) scaled.backgroundRadius = len(look.backgroundRadius)
  if (look.textShadow) {
    scaled.textShadow = {
      ...look.textShadow,
      offsetX: round2(look.textShadow.offsetX * scale),
      offsetY: round2(look.textShadow.offsetY * scale),
      blur: round2(look.textShadow.blur * scale),
    }
  }
  if (look.stroke) scaled.stroke = { ...look.stroke, width: round2(look.stroke.width * scale) }
  return scaled
}

function scaleSpanStyle(span: SpanStyle, scale: number): SpanStyle {
  const scaled: SpanStyle = { ...span }
  if (span.fontSize !== undefined) scaled.fontSize = round2(span.fontSize * scale)
  if (span.letterSpacing !== undefined) scaled.letterSpacing = round2(span.letterSpacing * scale)
  return scaled
}

function pickSpanStyle(span: TextSpan): SpanStyle {
  const style: SpanStyle = {}
  for (const key of SPAN_STYLE_KEYS) {
    if (span[key] !== undefined) (style as Record<string, unknown>)[key] = span[key]
  }
  return style
}

/** Every field key the style controls on an item. */
export function getTextStyleControlledKeys(style: TextStyleDefinition): TextStyleFieldKey[] {
  const keys: TextStyleFieldKey[] = [...TEXT_STYLE_LOOK_KEYS, 'textMotion']
  for (const axis of LAYOUT_AXES) {
    if (style.layout?.[axis.ratio] !== undefined) keys.push(axis.key)
  }
  if (style.spanStyles?.length) keys.push('textSpans')
  return keys
}

interface ResolveOptions {
  /** Fields the item overrides; propagation leaves them alone. */
  overrides?: readonly string[]
  /** The item's current transform, merged with the style's layout. */
  baseTransform?: TransformProperties
  /** The item's spans: the style's span looks are mapped onto them by index. */
  spans?: readonly TextSpan[]
}

function resolveLayout(
  layout: TextStyleLayout | undefined,
  canvas: StyleCanvas,
  skip: Set<string>,
  base: TransformProperties | undefined,
): TransformProperties | undefined {
  if (!layout) return undefined
  let next: TransformProperties | undefined
  for (const axis of LAYOUT_AXES) {
    const ratio = layout[axis.ratio]
    if (ratio === undefined || skip.has(axis.key)) continue
    next = next ?? { ...base }
    next[axis.field] = Math.round(ratio * canvas[axis.basis])
  }
  return next
}

function resolveSpans(
  spanStyles: readonly SpanStyle[],
  spans: readonly TextSpan[],
  scale: number,
): TextSpan[] {
  const last = spanStyles.length - 1
  return spans.map((span, index) => ({
    text: span.text,
    ...scaleSpanStyle(spanStyles[Math.min(index, last)] ?? {}, scale),
  }))
}

/**
 * The item fields a style sets on this canvas. Fields in `overrides` are left
 * out. Fields the style has no value for come back as `undefined` so they are
 * cleared, which is why callers spread the result over the item.
 */
export function resolveTextStyleUpdates(
  style: TextStyleDefinition,
  canvas: StyleCanvas,
  options: ResolveOptions = {},
): Partial<TextItem> {
  const skip = new Set(options.overrides ?? [])
  const look = scaleLook(style.style, textStyleScaleFor(canvas))
  const updates: Partial<TextItem> = {}
  for (const key of TEXT_STYLE_LOOK_KEYS) {
    if (!skip.has(key)) (updates as Record<string, unknown>)[key] = look[key]
  }
  if (!skip.has('textMotion')) {
    updates.textMotion = style.textMotion ? structuredClone(style.textMotion) : undefined
  }
  const transform = resolveLayout(style.layout, canvas, skip, options.baseTransform)
  if (transform) updates.transform = transform
  if (style.spanStyles?.length && options.spans?.length && !skip.has('textSpans')) {
    updates.textSpans = resolveSpans(style.spanStyles, options.spans, textStyleScaleFor(canvas))
  }
  return updates
}

/** The fields to write when an item is (re)linked to a style: a fresh apply. */
export function buildApplyTextStyleUpdates(
  item: Pick<TextItem, 'transform' | 'textSpans' | 'formatRole'>,
  style: TextStyleDefinition,
  canvas: StyleCanvas,
): Partial<TextItem> {
  const formatRole = item.formatRole ?? formatRoleForTextStyle(style.role)
  return {
    ...resolveTextStyleUpdates(style, canvas, {
      baseTransform: item.transform,
      spans: item.textSpans,
    }),
    textStyleId: style.id,
    textStyleOverrides: undefined,
    // A built-in preset's size slider would re-apply the preset over the style.
    textStylePresetId: undefined,
    textStyleScale: undefined,
    ...(formatRole ? { formatRole } : {}),
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function sameObject(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every((key) => sameValue(left[key], right[key]))
}

/** Deep equality where numbers match within 0.01 px. */
function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 0.01
  if (isObject(left) && isObject(right)) return sameObject(left, right)
  return left === right
}

function spanStylesOf(spans: readonly TextSpan[] | undefined): SpanStyle[] {
  return (spans ?? []).map(pickSpanStyle)
}

const TRANSFORM_FIELD = Object.fromEntries(
  LAYOUT_AXES.map((axis) => [axis.key, axis.field]),
) as Record<string, keyof TransformProperties>

/** Read one controlled field off an item, in the shape the comparisons use. */
function readControlledField(
  item: Pick<TextItem, 'transform' | 'textSpans' | 'textMotion'> & TextStyleFields,
  key: TextStyleFieldKey,
): unknown {
  const transformField = TRANSFORM_FIELD[key]
  if (transformField) return item.transform?.[transformField]
  if (key === 'textSpans') return spanStylesOf(item.textSpans)
  return (item as Record<string, unknown>)[key]
}

/**
 * Fields a direct edit changed among those the style controls: what to add to
 * `textStyleOverrides`. Text content never counts (span text included).
 */
export function changedTextStyleFields(
  previous: TextItem,
  next: TextItem,
  controlled: readonly TextStyleFieldKey[],
): TextStyleFieldKey[] {
  return controlled.filter(
    (key) => !sameValue(readControlledField(previous, key), readControlledField(next, key)),
  )
}

/** Controlled fields where the item no longer matches its style on this canvas. */
export function textStyleDifferences(
  item: TextItem,
  style: TextStyleDefinition,
  canvas: StyleCanvas,
): TextStyleFieldKey[] {
  const resolved = { ...item, ...buildApplyTextStyleUpdates(item, style, canvas) } as TextItem
  return changedTextStyleFields(resolved, item, getTextStyleControlledKeys(style))
}

/** Merge newly overridden fields into an item's override list (sorted, unique). */
export function mergeTextStyleOverrides(
  current: readonly string[] | undefined,
  added: readonly string[],
): string[] | undefined {
  const merged = [...new Set([...(current ?? []), ...added])].sort()
  return merged.length > 0 ? merged : undefined
}

function invertLook(item: TextStyleFields, scale: number): TextStyleLook {
  const look: TextStyleLook = {}
  for (const key of TEXT_STYLE_LOOK_KEYS) {
    const value = item[key as LookKey]
    if (value !== undefined) (look as Record<string, unknown>)[key] = structuredClone(value)
  }
  return scaleLook(look, 1 / scale)
}

function deriveLayout(
  transform: TransformProperties | undefined,
  canvas: StyleCanvas,
): TextStyleLayout | undefined {
  if (!transform) return undefined
  const layout: TextStyleLayout = {}
  for (const axis of LAYOUT_AXES) {
    const value = transform[axis.field]
    if (typeof value === 'number')
      layout[axis.ratio] = round2((value / canvas[axis.basis]) * 1000) / 1000
  }
  return Object.keys(layout).length > 0 ? layout : undefined
}

/** The style parts an item carries: look, layout, motion and span looks. */
export function deriveTextStyleFromItem(
  item: TextItem,
  canvas: StyleCanvas,
): Pick<TextStyleDefinition, 'style' | 'layout' | 'textMotion' | 'spanStyles'> {
  const scale = textStyleScaleFor(canvas)
  const layout = deriveLayout(item.transform, canvas)
  const spanStyles = item.textSpans?.length
    ? item.textSpans.map((span) => scaleSpanStyle(pickSpanStyle(span), 1 / scale))
    : undefined
  return {
    style: invertLook(item, scale),
    ...(layout ? { layout } : {}),
    ...(item.textMotion ? { textMotion: structuredClone(item.textMotion) } : {}),
    ...(spanStyles?.some((span) => Object.keys(span).length > 0) ? { spanStyles } : {}),
  }
}
