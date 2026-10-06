import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import { useProjectTextStylesStore } from '@/shared/state/text-styles'
import { buildApplyTextStyleUpdates } from '@/shared/typography/text-styles/text-style-resolve'
import { upsertProjectTextStyle } from '@/features/editor/deps/timeline-store'

type Canvas = { width: number; height: number }

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

/** A library style is copied into the project on first use. */
export function ensureTextStyleInProject(
  style: TextStyleDefinition | undefined,
  canvas: Canvas,
): void {
  if (
    !style ||
    useProjectTextStylesStore.getState().styles.some((entry) => entry.id === style.id)
  ) {
    return
  }
  upsertProjectTextStyle(style, canvas)
}
