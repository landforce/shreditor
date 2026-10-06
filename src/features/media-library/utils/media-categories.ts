/**
 * Media categories: what each file is for in the edit (speaker, B-roll, ...).
 *
 * `category` is the one source of truth, for the media pane and for the
 * agent. The user (media card) and the agent (`shred categorize`) set it
 * explicitly; the background analysis may only suggest one, marked
 * `categorySource: 'auto'`, while nothing explicit is set. See
 * {@link hasExplicitCategory} and {@link autoCategoryUpdate}.
 */

import type { MediaCategory, MediaCategorySource, MediaMetadata } from '@/types/storage'
import { getMediaType } from './validation'

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

const CATEGORY_SET: ReadonlySet<string> = new Set(MEDIA_CATEGORIES)

export function isMediaCategory(value: unknown): value is MediaCategory {
  return typeof value === 'string' && CATEGORY_SET.has(value)
}

const CATEGORY_SOURCES: ReadonlySet<string> = new Set<MediaCategorySource>([
  'auto',
  'user',
  'agent',
])

export function isCategorySource(value: unknown): value is MediaCategorySource {
  return typeof value === 'string' && CATEGORY_SOURCES.has(value)
}

type CategoryFields = Pick<MediaMetadata, 'category' | 'categorySource'>

/**
 * Whether the user or the agent decided this media's category, so automatic
 * analysis must leave it alone. A category with no source (metadata written
 * before sources existed) counts as explicit, and so does a 'user' / 'agent'
 * source with no category (someone cleared it on purpose).
 */
export function hasExplicitCategory(media: CategoryFields): boolean {
  if (media.categorySource === 'user' || media.categorySource === 'agent') return true
  return media.categorySource !== 'auto' && isMediaCategory(media.category)
}

/** A category the background analysis suggested and nobody has confirmed yet. */
export function isAutoCategory(media: CategoryFields): boolean {
  return media.categorySource === 'auto' && isMediaCategory(media.category)
}

/**
 * The write that records an automatic suggestion, or null when there is
 * nothing to write: an explicit category always wins, an unchanged
 * suggestion is skipped, and no suggestion never clears an earlier one.
 */
export function autoCategoryUpdate(
  media: CategoryFields,
  suggestion: MediaCategory | undefined,
): { category: MediaCategory; categorySource: Extract<MediaCategorySource, 'auto'> } | null {
  if (!suggestion || hasExplicitCategory(media)) return null
  if (isAutoCategory(media) && media.category === suggestion) return null
  return { category: suggestion, categorySource: 'auto' }
}

export type MediaTypeGroupKey = 'video' | 'audio' | 'image' | 'gif' | 'lottie'

export function mediaTypeGroupOf(item: Pick<MediaMetadata, 'mimeType'>): MediaTypeGroupKey {
  if (item.mimeType === 'image/gif') return 'gif'
  const type = getMediaType(item.mimeType)
  return type === 'video' || type === 'audio' || type === 'lottie' ? type : 'image'
}

/** What the background analysis says about an item right now (see media-role.ts). */
export type CategoryVerdict = MediaCategory | 'pending' | undefined

type MediaSection =
  | { kind: 'category'; key: MediaCategory; items: MediaMetadata[] }
  | { kind: 'analyzing'; key: 'analyzing'; items: MediaMetadata[] }
  | { kind: 'type'; key: MediaTypeGroupKey; items: MediaMetadata[] }

/** Type groups for media with no category, after every category and "Analyzing". */
const TYPE_GROUP_ORDER: readonly MediaTypeGroupKey[] = ['video', 'image', 'gif', 'lottie', 'audio']

type SectionKey = MediaCategory | 'analyzing' | { type: MediaTypeGroupKey }

function sectionOf(item: MediaMetadata, verdictOf: (item: MediaMetadata) => CategoryVerdict) {
  if (hasExplicitCategory(item)) {
    return isMediaCategory(item.category) ? item.category : { type: mediaTypeGroupOf(item) }
  }
  const verdict = verdictOf(item)
  // A fresh verdict shows at once; it is being written as the new suggestion.
  if (isMediaCategory(verdict)) return verdict
  if (isMediaCategory(item.category)) return item.category
  return verdict === 'pending' ? 'analyzing' : { type: mediaTypeGroupOf(item) }
}

/**
 * Split items into media library sections: Speaker, B-roll, Graphics,
 * Overlays, Voiceover, Music, SFX, Other, then "Analyzing" (no category yet,
 * analysis still to come), then the remaining items by file type (Videos,
 * Images, GIFs, Lottie, Audio). An explicit category always decides; for the
 * rest `verdictOf` (the current analysis verdict) wins over a standing
 * automatic suggestion. Empty sections are left out and item order within a
 * section is kept, so search, filter and sort still apply.
 */
export function groupMediaSections(
  items: readonly MediaMetadata[],
  verdictOf: (item: MediaMetadata) => CategoryVerdict = () => undefined,
): MediaSection[] {
  const byCategory = new Map<MediaCategory, MediaMetadata[]>()
  const byType = new Map<MediaTypeGroupKey, MediaMetadata[]>()
  const analyzing: MediaMetadata[] = []
  const push = <K>(map: Map<K, MediaMetadata[]>, key: K, item: MediaMetadata) => {
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }
  for (const item of items) {
    const section: SectionKey = sectionOf(item, verdictOf)
    if (section === 'analyzing') analyzing.push(item)
    else if (typeof section === 'object') push(byType, section.type, item)
    else push(byCategory, section, item)
  }
  const sections: MediaSection[] = []
  for (const key of MEDIA_CATEGORIES) {
    const bucket = byCategory.get(key)
    if (bucket) sections.push({ kind: 'category', key, items: bucket })
  }
  if (analyzing.length > 0) sections.push({ kind: 'analyzing', key: 'analyzing', items: analyzing })
  for (const key of TYPE_GROUP_ORDER) {
    const bucket = byType.get(key)
    if (bucket) sections.push({ kind: 'type', key, items: bucket })
  }
  return sections
}
