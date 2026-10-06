import type { VisualEffect } from '@/types/effects'
import type {
  AdjustmentItem,
  ControllerItem,
  ShapeItem,
  ShapeType,
  TextItem,
} from '@/types/timeline'
import {
  TEXT_STYLE_PRESETS,
  buildTextStylePresetTemplate,
  type TextStylePresetId,
} from '@/shared/typography/text-style-presets'
import { useProjectTextStylesStore } from '@/shared/state/text-styles'
import {
  buildApplyTextStyleUpdates,
  textStyleVariantForCanvas,
} from '@/shared/typography/text-styles/text-style-resolve'

export const DEFAULT_GENERATED_LAYER_DURATION_SECONDS = 60

export interface TimelineTemplateDragData {
  type: 'timeline-template'
  itemType: 'text' | 'shape' | 'adjustment'
  label: string
  textStylePresetId?: TextStylePresetId
  /** A saved text style, already in the project (the drag source puts it there). */
  textStyleId?: string
  shapeType?: ShapeType
  shapePreset?: 'solid' | 'gradient'
  effects?: VisualEffect[]
}

interface LayerPlacement {
  trackId: string
  from: number
  durationInFrames: number
}

interface VisualLayerPlacement extends LayerPlacement {
  canvasWidth: number
  canvasHeight: number
  fps?: number
}

const TEMPLATE_ITEM_TYPES = new Set(['text', 'shape', 'adjustment'])
const SHAPE_PRESETS = new Set(['solid', 'gradient'])
const SHAPE_TYPES = new Set([
  'rectangle',
  'circle',
  'triangle',
  'ellipse',
  'star',
  'polygon',
  'heart',
  'path',
])

const isOptional = (value: unknown, valid: (value: unknown) => boolean) =>
  value === undefined || valid(value)

/** Text fields: a known built-in preset, a saved style id. */
function hasValidTextFields(candidate: Partial<TimelineTemplateDragData>): boolean {
  return (
    isOptional(candidate.textStylePresetId, (id) =>
      TEXT_STYLE_PRESETS.some((preset) => preset.id === id),
    ) && isOptional(candidate.textStyleId, (id) => typeof id === 'string')
  )
}

/** Shape and adjustment fields: effects list, preset, and a shape type for shapes. */
function hasValidLayerFields(candidate: Partial<TimelineTemplateDragData>): boolean {
  return (
    isOptional(candidate.effects, Array.isArray) &&
    isOptional(candidate.shapePreset, (preset) => SHAPE_PRESETS.has(preset as string)) &&
    (candidate.itemType !== 'shape' || SHAPE_TYPES.has(candidate.shapeType as string))
  )
}

export function isTimelineTemplateDragData(value: unknown): value is TimelineTemplateDragData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TimelineTemplateDragData>
  return (
    candidate.type === 'timeline-template' &&
    TEMPLATE_ITEM_TYPES.has(candidate.itemType as string) &&
    typeof candidate.label === 'string' &&
    candidate.label.trim().length > 0 &&
    hasValidTextFields(candidate) &&
    hasValidLayerFields(candidate)
  )
}

export function getDefaultGeneratedLayerDurationInFrames(fps: number): number {
  return Math.max(1, Math.round(fps * DEFAULT_GENERATED_LAYER_DURATION_SECONDS))
}

export function getTemplateEffectsForDirectApplication(template: unknown): VisualEffect[] | null {
  if (!isTimelineTemplateDragData(template)) {
    return null
  }

  if (
    template.itemType !== 'adjustment' ||
    !Array.isArray(template.effects) ||
    template.effects.length === 0
  ) {
    return null
  }

  return template.effects
}

export function createDefaultTextItem(
  params: VisualLayerPlacement & { text?: string; label?: string },
): TextItem {
  const { trackId, from, durationInFrames, canvasWidth, canvasHeight, text, label } = params

  return {
    id: crypto.randomUUID(),
    type: 'text',
    trackId,
    from,
    durationInFrames,
    label: label ?? 'Text',
    text: text ?? 'Your Text Here',
    fontSize: 60,
    fontFamily: 'Inter',
    fontWeight: 'normal',
    fontStyle: 'normal',
    underline: false,
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    transform: {
      x: 0,
      y: 0,
      width: canvasWidth * 0.8,
      height: canvasHeight * 0.3,
      rotation: 0,
      opacity: 1,
    },
  }
}

export function createTextTemplateItem(params: {
  placement: VisualLayerPlacement
  label?: string
  text?: string
  textStylePresetId?: TextStylePresetId
}): TextItem {
  const { placement, label, text, textStylePresetId } = params
  const baseTextItem = createDefaultTextItem({ ...placement, label, text })

  if (!textStylePresetId) {
    return {
      ...baseTextItem,
      label: label ?? baseTextItem.label,
    }
  }

  return {
    ...baseTextItem,
    ...buildTextStylePresetTemplate(textStylePresetId, {
      width: placement.canvasWidth,
      height: placement.canvasHeight,
      fps: placement.fps ?? 30,
    }),
    label:
      label ??
      TEXT_STYLE_PRESETS.find((preset) => preset.id === textStylePresetId)?.label ??
      baseTextItem.label,
  }
}

export function createDefaultShapeItem(
  params: VisualLayerPlacement & { shapeType: ShapeType },
): ShapeItem {
  const { trackId, from, durationInFrames, canvasWidth, canvasHeight, shapeType } = params
  const shapeSize = Math.min(canvasWidth, canvasHeight) * 0.25

  return {
    id: crypto.randomUUID(),
    type: 'shape',
    trackId,
    from,
    durationInFrames,
    label: shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
    shapeType,
    fillColor: '#3b82f6',
    strokeColor: undefined,
    strokeWidth: 0,
    cornerRadius: shapeType === 'rectangle' ? 0 : undefined,
    direction: shapeType === 'triangle' ? 'up' : undefined,
    points: shapeType === 'star' ? 5 : shapeType === 'polygon' ? 6 : undefined,
    innerRadius: shapeType === 'star' ? 0.5 : undefined,
    transform: {
      x: 0,
      y: 0,
      width: shapeSize,
      height: shapeSize,
      rotation: 0,
      opacity: 1,
      aspectRatioLocked: true,
    },
  }
}

export function createDefaultSolidColorItem(params: VisualLayerPlacement): ShapeItem {
  const item = createDefaultShapeItem({ ...params, shapeType: 'rectangle' })
  return {
    ...item,
    label: 'Solid Color',
    fillColor: '#2d2d2d',
    fillType: 'solid',
    strokeEnabled: false,
    transform: {
      ...item.transform,
      width: params.canvasWidth,
      height: params.canvasHeight,
      aspectRatioLocked: true,
    },
  }
}

export function createDefaultGradientItem(params: VisualLayerPlacement): ShapeItem {
  const item = createDefaultShapeItem({ ...params, shapeType: 'rectangle' })
  return {
    ...item,
    label: 'Gradient',
    fillColor: '#3b82f6',
    fillType: 'linear',
    gradientStartColor: '#3b82f6',
    gradientEndColor: '#8b5cf6',
    gradientAngle: 0,
    strokeEnabled: false,
    transform: {
      ...item.transform,
      width: params.canvasWidth,
      height: params.canvasHeight,
      aspectRatioLocked: true,
    },
  }
}

export function createDefaultAdjustmentItem(
  params: LayerPlacement & {
    effects?: VisualEffect[]
    label?: string
  },
): AdjustmentItem {
  const { trackId, from, durationInFrames, effects, label } = params

  return {
    id: crypto.randomUUID(),
    type: 'adjustment',
    trackId,
    from,
    durationInFrames,
    label: label ?? 'Adjustment Layer',
    effects:
      effects?.map((effect) => ({
        id: crypto.randomUUID(),
        effect,
        enabled: true,
      })) ?? [],
    effectOpacity: 1,
  }
}

export function createDefaultControllerItem(params: VisualLayerPlacement): ControllerItem {
  const { trackId, from, durationInFrames, canvasWidth, canvasHeight } = params
  const size = Math.max(48, Math.min(canvasWidth, canvasHeight) * 0.08)
  return {
    id: crypto.randomUUID(),
    type: 'controller',
    controllerKind: 'null',
    trackId,
    from,
    durationInFrames,
    label: 'Null Object',
    transform: {
      x: 0,
      y: 0,
      width: size,
      height: size,
      rotation: 0,
      opacity: 1,
      aspectRatioLocked: true,
    },
  }
}

/** A new text item linked to a project text style: its look, layout, motion and length. */
function withProjectTextStyle(
  item: TextItem,
  styleId: string,
  placement: VisualLayerPlacement,
): TextItem {
  const style = useProjectTextStylesStore.getState().styles.find((entry) => entry.id === styleId)
  const canvas = { width: placement.canvasWidth, height: placement.canvasHeight }
  if (!style || !textStyleVariantForCanvas(style, canvas)) return item
  return {
    ...item,
    ...buildApplyTextStyleUpdates(item, style, canvas),
    label: style.name,
    durationInFrames: style.defaultDurationFrames ?? item.durationInFrames,
  }
}

export function createTimelineTemplateItem(params: {
  template: TimelineTemplateDragData
  placement: VisualLayerPlacement
}): TextItem | ShapeItem | AdjustmentItem {
  const { template, placement } = params

  if (template.itemType === 'text') {
    const item = createTextTemplateItem({
      placement,
      label: template.label,
      textStylePresetId: template.textStylePresetId,
    })
    return template.textStyleId ? withProjectTextStyle(item, template.textStyleId, placement) : item
  }

  if (template.itemType === 'adjustment') {
    return createDefaultAdjustmentItem({
      trackId: placement.trackId,
      from: placement.from,
      durationInFrames: placement.durationInFrames,
      label: template.label,
      effects: template.effects,
    })
  }

  if (template.shapePreset === 'solid') return createDefaultSolidColorItem(placement)
  if (template.shapePreset === 'gradient') return createDefaultGradientItem(placement)

  return createDefaultShapeItem({ ...placement, shapeType: template.shapeType ?? 'rectangle' })
}
