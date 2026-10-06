import type { TimelineItem } from '@/types/timeline'
import { getProjectTextStyle } from '@/shared/state/text-styles'
import {
  changedTextStyleFields,
  getTextStyleControlledKeys,
  mergeTextStyleOverrides,
} from '@/shared/typography/text-styles/text-style-resolve'

const MANAGED_KEYS = ['textStyleId', 'textStyleOverrides'] as const

/**
 * A direct edit to a styled field of an item that uses a text style records
 * the field as an override, so later style edits leave it alone. Edits that
 * set the link themselves (apply, reset, propagation) manage overrides and
 * are passed through untouched.
 */
export function recordTextStyleOverrides(
  previous: TimelineItem,
  next: TimelineItem,
  updates?: object,
): TimelineItem {
  if (previous.type !== 'text' || next.type !== 'text' || !previous.textStyleId) return next
  if (updates && MANAGED_KEYS.some((key) => key in updates)) return next
  const style = getProjectTextStyle(previous.textStyleId)
  if (!style) return next
  const changed = changedTextStyleFields(previous, next, getTextStyleControlledKeys(style))
  if (changed.length === 0) return next
  return { ...next, textStyleOverrides: mergeTextStyleOverrides(next.textStyleOverrides, changed) }
}
