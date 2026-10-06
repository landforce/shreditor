import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import { useProjectTextStylesStore } from '@/shared/state/text-styles'
import {
  buildApplyTextStyleUpdates,
  textStyleVariantForCanvas,
} from '@/shared/typography/text-styles/text-style-resolve'
import { upsertProjectTextStyle } from '@/features/editor/deps/timeline-store'
import { textStyleWithVersionFor } from './properties-sidebar/clip-panel/text-style-picker-model'

type Canvas = { width: number; height: number }

/**
 * The style ready for this canvas: as it is, or with a version for the
 * canvas's aspect cloned from its closest one.
 */
export function fitTextStyleToCanvas(
  style: TextStyleDefinition | undefined,
  canvas: Canvas,
): TextStyleDefinition | undefined {
  if (!style || textStyleVariantForCanvas(style, canvas)) return style
  return textStyleWithVersionFor(style, canvas)
}

/** A new text item made with a style: its look, layout, motion and default length. */
export function withTextStyle(
  item: TextItem,
  style: TextStyleDefinition | undefined,
  canvas: Canvas,
): TextItem {
  if (!style) return item
  return {
    ...item,
    ...buildApplyTextStyleUpdates(item, style, canvas),
    label: style.name,
    durationInFrames: style.defaultDurationFrames ?? item.durationInFrames,
  }
}

/**
 * A library style is copied into the project on first use, and a version
 * made for this canvas replaces the project's copy.
 */
export function ensureTextStyleInProject(
  style: TextStyleDefinition | undefined,
  canvas: Canvas,
  { beforeDrop = false }: { beforeDrop?: boolean } = {},
): void {
  if (!style) return
  const { styles, setStyles } = useProjectTextStylesStore.getState()
  const own = styles.find((entry) => entry.id === style.id)
  if (own && textStyleVariantForCanvas(own, canvas)) return
  // Dragging a style that isn't in the project yet: copy it in without an undo
  // step (nothing uses it), so the drop is the gesture's one step.
  if (beforeDrop && !own) return setStyles([...styles, style])
  upsertProjectTextStyle(style, canvas)
}
