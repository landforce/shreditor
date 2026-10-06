/**
 * Media categories: what each file is for in the edit (speaker, B-roll, ...).
 *
 * The agent assigns them when it catalogs footage (`shred categorize`), the
 * user can change them from the media card. When any item in the project has
 * one, the media library groups by category instead of by file type.
 */

import type { MediaCategory, MediaMetadata } from '@/types/storage'

/** Display order of the category groups. */
export const MEDIA_CATEGORIES = [
  'speaker',
  'b-roll',
  'graphics',
  'overlay',
  'voiceover',
  'music',
  'sfx',
  'other',
] as const satisfies readonly MediaCategory[]

/** Group key for items without a category; sorts after every category. */
export const UNCATEGORIZED = 'uncategorized'

type MediaCategoryGroupKey = MediaCategory | typeof UNCATEGORIZED

const CATEGORY_SET: ReadonlySet<string> = new Set(MEDIA_CATEGORIES)

export function isMediaCategory(value: unknown): value is MediaCategory {
  return typeof value === 'string' && CATEGORY_SET.has(value)
}

/** True when the library should group by category (some item has a valid one). */
export function hasMediaCategories(items: readonly MediaMetadata[]): boolean {
  return items.some((item) => isMediaCategory(item.category))
}

/**
 * Split items into category groups in {@link MEDIA_CATEGORIES} order, then
 * uncategorized. Empty groups are left out; item order within a group is kept,
 * so the caller's search, filter and sort still apply.
 */
export function groupMediaByCategory(
  items: readonly MediaMetadata[],
): Array<{ key: MediaCategoryGroupKey; items: MediaMetadata[] }> {
  const buckets = new Map<MediaCategoryGroupKey, MediaMetadata[]>()
  for (const item of items) {
    const key: MediaCategoryGroupKey = isMediaCategory(item.category)
      ? item.category
      : UNCATEGORIZED
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  const order: MediaCategoryGroupKey[] = [...MEDIA_CATEGORIES, UNCATEGORIZED]
  return order.flatMap((key) => {
    const bucket = buckets.get(key)
    return bucket ? [{ key, items: bucket }] : []
  })
}
