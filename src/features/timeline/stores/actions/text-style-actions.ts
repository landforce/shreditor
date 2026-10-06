/**
 * Text style actions: the only writers of the project's text styles.
 *
 * A style edit writes the resolved fields onto every item that uses the style
 * (Main, every composition, and timelines stashed by navigation), skipping the
 * fields each item overrides, as ONE undo step. Items always carry their
 * resolved look, so rendering and export never resolve styles.
 */

import type { TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import { useProjectTextStylesStore } from '@/shared/state/text-styles'
import {
  buildApplyTextStyleUpdates,
  resolveTextStyleUpdates,
} from '@/shared/typography/text-styles/text-style-resolve'
import { useItemsStore } from '../items-store'
import { useCompositionsStore } from '../compositions-store'
import { useCompositionNavigationStore } from '../composition-navigation-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute } from './shared'

export interface TextStyleCanvas {
  width: number
  height: number
}

type ItemMapper = (item: TextItem, canvas: TextStyleCanvas) => TextItem | null

/** Canvas of a composition, or the project canvas for Main (`null`). */
function canvasOf(compositionId: string | null, root: TextStyleCanvas): TextStyleCanvas {
  if (!compositionId) return root
  const composition = useCompositionsStore.getState().getComposition(compositionId)
  return composition ? { width: composition.width, height: composition.height } : root
}

/** Map text items; returns the same array when nothing changed. */
function mapTextItems(
  items: TimelineItem[],
  canvas: TextStyleCanvas,
  mapper: ItemMapper,
): TimelineItem[] {
  let changed = false
  const next = items.map((item) => {
    if (item.type !== 'text') return item
    const mapped = mapper(item, canvas)
    if (!mapped) return item
    changed = true
    return mapped
  })
  return changed ? next : items
}

/** Apply `mapper` to text items everywhere they live; returns the ids it changed. */
function mapTextItemsEverywhere(root: TextStyleCanvas, mapper: ItemMapper): string[] {
  const changedIds: string[] = []
  const tracked: ItemMapper = (item, canvas) => {
    const mapped = mapper(item, canvas)
    if (mapped) changedIds.push(item.id)
    return mapped
  }
  const navigation = useCompositionNavigationStore.getState()
  const liveItems = useItemsStore.getState().items
  const nextLive = mapTextItems(liveItems, canvasOf(navigation.activeCompositionId, root), tracked)
  if (nextLive !== liveItems) useItemsStore.getState().setItems(nextLive)

  const compositions = useCompositionsStore.getState().compositions
  let compositionsChanged = false
  const nextCompositions = compositions.map((composition) => {
    if (composition.id === navigation.activeCompositionId) return composition
    const items = mapTextItems(composition.items, canvasOf(composition.id, root), tracked)
    if (items === composition.items) return composition
    compositionsChanged = true
    return { ...composition, items }
  })
  if (compositionsChanged) useCompositionsStore.getState().setCompositions(nextCompositions)

  const restash = <T extends { compositionId: string | null; items: TimelineItem[] }>(stash: T) => {
    const items = mapTextItems(stash.items, canvasOf(stash.compositionId, root), tracked)
    return items === stash.items ? stash : { ...stash, items }
  }
  const stashStack = navigation.stashStack.map(restash)
  const mainHolder = navigation.mainHolder ? restash(navigation.mainHolder) : null
  if (
    mainHolder !== navigation.mainHolder ||
    stashStack.some((stash, index) => stash !== navigation.stashStack[index])
  ) {
    useCompositionNavigationStore.setState({ stashStack, mainHolder })
  }
  return [...new Set(changedIds)]
}

function putStyle(style: TextStyleDefinition): void {
  const styles = useProjectTextStylesStore.getState().styles
  useProjectTextStylesStore
    .getState()
    .setStyles(
      styles.some((entry) => entry.id === style.id)
        ? styles.map((entry) => (entry.id === style.id ? style : entry))
        : [...styles, style],
    )
}

function restyle(style: TextStyleDefinition): ItemMapper {
  return (item, canvas) =>
    item.textStyleId === style.id
      ? ({
          ...item,
          ...resolveTextStyleUpdates(style, canvas, {
            overrides: item.textStyleOverrides,
            baseTransform: item.transform,
            spans: item.textSpans,
          }),
        } as TextItem)
      : null
}

function upsertStyleInStores(style: TextStyleDefinition, canvas: TextStyleCanvas): string[] {
  putStyle(style)
  return mapTextItemsEverywhere(canvas, restyle(style))
}

function linkItems(
  ids: readonly string[],
  style: TextStyleDefinition,
  canvas: TextStyleCanvas,
): string[] {
  const wanted = new Set(ids)
  return mapTextItemsEverywhere(canvas, (item, itemCanvas) =>
    wanted.has(item.id)
      ? ({ ...item, ...buildApplyTextStyleUpdates(item, style, itemCanvas) } as TextItem)
      : null,
  )
}

function inUndoStep<T>(type: string, payload: Record<string, unknown>, action: () => T): T {
  return execute(
    type,
    () => {
      const result = action()
      useTimelineSettingsStore.getState().markDirty()
      return result
    },
    payload,
  )
}

/**
 * Add or replace a project style and restyle every item that uses it.
 * Returns the ids of the items it rewrote.
 */
export function upsertProjectTextStyle(
  style: TextStyleDefinition,
  canvas: TextStyleCanvas,
): string[] {
  return inUndoStep('UPSERT_TEXT_STYLE', { styleId: style.id }, () =>
    upsertStyleInStores(style, canvas),
  )
}

/**
 * Link items to a style and give them its full look (their overrides are
 * cleared). The style is copied into the project when it is not there yet.
 * Only the given ids change; non-text items are skipped.
 */
export function applyTextStyleToItems(
  ids: readonly string[],
  style: TextStyleDefinition,
  canvas: TextStyleCanvas,
): string[] {
  return inUndoStep('APPLY_TEXT_STYLE', { styleId: style.id, count: ids.length }, () => {
    if (!useProjectTextStylesStore.getState().styles.some((entry) => entry.id === style.id)) {
      putStyle(style)
    }
    return linkItems(ids, style, canvas)
  })
}

/**
 * Save a style made from an item and link `ids` to it, in one undo step:
 * "Save as new style" and "Update style from this item". Other items using
 * the style are restyled; the linked items lose their overrides.
 */
export function saveTextStyleFromItems(
  style: TextStyleDefinition,
  ids: readonly string[],
  canvas: TextStyleCanvas,
): string[] {
  return inUndoStep('SAVE_TEXT_STYLE', { styleId: style.id, count: ids.length }, () => [
    ...new Set([...upsertStyleInStores(style, canvas), ...linkItems(ids, style, canvas)]),
  ])
}

/** Drop the items' overrides and give them their style's look again. */
export function resetItemsToTextStyle(ids: readonly string[], canvas: TextStyleCanvas): string[] {
  const wanted = new Set(ids)
  const styles = useProjectTextStylesStore.getState().styles
  return execute(
    'RESET_TEXT_STYLE',
    () => {
      const updated = mapTextItemsEverywhere(canvas, (item, itemCanvas) => {
        const style = wanted.has(item.id)
          ? styles.find((entry) => entry.id === item.textStyleId)
          : undefined
        return style
          ? ({ ...item, ...buildApplyTextStyleUpdates(item, style, itemCanvas) } as TextItem)
          : null
      })
      useTimelineSettingsStore.getState().markDirty()
      return updated
    },
    { count: ids.length },
  )
}

const unlink = (item: TextItem): TextItem => {
  const next = { ...item }
  delete next.textStyleId
  delete next.textStyleOverrides
  return next
}

/** Unlink items from their style; they keep their current look. */
export function detachItemsFromTextStyle(ids: readonly string[], canvas: TextStyleCanvas): void {
  const wanted = new Set(ids)
  execute(
    'DETACH_TEXT_STYLE',
    () => {
      mapTextItemsEverywhere(canvas, (item) =>
        wanted.has(item.id) && item.textStyleId ? unlink(item) : null,
      )
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: ids.length },
  )
}

/** Delete a project style. Items that used it are detached and keep their look. */
export function removeProjectTextStyle(styleId: string, canvas: TextStyleCanvas): string[] {
  return execute(
    'REMOVE_TEXT_STYLE',
    () => {
      const styles = useProjectTextStylesStore.getState().styles
      useProjectTextStylesStore.getState().setStyles(styles.filter((style) => style.id !== styleId))
      const detached = mapTextItemsEverywhere(canvas, (item) =>
        item.textStyleId === styleId ? unlink(item) : null,
      )
      useTimelineSettingsStore.getState().markDirty()
      return detached
    },
    { styleId },
  )
}

/**
 * Put captions made with a style on the timeline in one undo step: the style
 * is copied into the project when needed, `replaceIds` (the clip's previous
 * styled captions) are removed and `newTrack` is added when given.
 */
export function insertStyledCaptions(
  captions: TextItem[],
  style: TextStyleDefinition,
  newTrack: TimelineTrack | null,
  replaceIds: readonly string[],
): void {
  inUndoStep('ADD_STYLED_CAPTIONS', { styleId: style.id, count: captions.length }, () => {
    if (!useProjectTextStylesStore.getState().styles.some((entry) => entry.id === style.id)) {
      putStyle(style)
    }
    const items = useItemsStore.getState()
    if (replaceIds.length > 0) items._removeItems([...replaceIds])
    if (newTrack) items.setTracks([...items.tracks, newTrack])
    useItemsStore.getState()._addItems(captions)
  })
}
