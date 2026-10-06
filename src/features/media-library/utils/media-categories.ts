/**
 * Media categories: what each file is for in the edit (speaker, B-roll, ...).
 *
 * The agent assigns them when it catalogs footage (`shred categorize`), the
 * user can change them from the media card. Uncategorized videos fall back to
 * the speaker / b-roll role inferred from analysis; the rest group by file type.
 */

import type { MediaCategory, MediaMetadata } from '@/types/storage'
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

export type MediaTypeGroupKey = 'video' | 'audio' | 'image' | 'gif' | 'lottie'

export function mediaTypeGroupOf(item: Pick<MediaMetadata, 'mimeType'>): MediaTypeGroupKey {
  if (item.mimeType === 'image/gif') return 'gif'
  const type = getMediaType(item.mimeType)
  return type === 'video' || type === 'audio' || type === 'lottie' ? type : 'image'
}

type MediaSection =
  | { kind: 'category'; key: MediaCategory; items: MediaMetadata[] }
  | { kind: 'type'; key: MediaTypeGroupKey; items: MediaMetadata[] }

/**
 * Section order: picture media before audio. Categories and the
 * uncategorized type groups interleave so images and graphics sit above
 * every kind of audio.
 */
const SECTION_ORDER: ReadonlyArray<
  { kind: 'category'; key: MediaCategory } | { kind: 'type'; key: MediaTypeGroupKey }
> = [
  { kind: 'category', key: 'speaker' },
  { kind: 'category', key: 'b-roll' },
  { kind: 'type', key: 'video' },
  { kind: 'category', key: 'graphics' },
  { kind: 'category', key: 'overlay' },
  { kind: 'type', key: 'image' },
  { kind: 'type', key: 'gif' },
  { kind: 'type', key: 'lottie' },
  { kind: 'category', key: 'voiceover' },
  { kind: 'category', key: 'music' },
  { kind: 'category', key: 'sfx' },
  { kind: 'type', key: 'audio' },
  { kind: 'category', key: 'other' },
]

/**
 * Split items into media library sections. A saved category always wins;
 * otherwise `inferCategory` (speaker / b-roll from analysis) may supply one;
 * anything left is grouped by file type. Empty sections are left out and
 * item order within a section is kept, so search, filter and sort still apply.
 */
export function groupMediaSections(
  items: readonly MediaMetadata[],
  inferCategory: (item: MediaMetadata) => MediaCategory | undefined = () => undefined,
): MediaSection[] {
  const byCategory = new Map<MediaCategory, MediaMetadata[]>()
  const byType = new Map<MediaTypeGroupKey, MediaMetadata[]>()
  for (const item of items) {
    const category = isMediaCategory(item.category) ? item.category : inferCategory(item)
    if (category) {
      const bucket = byCategory.get(category)
      if (bucket) bucket.push(item)
      else byCategory.set(category, [item])
    } else {
      const key = mediaTypeGroupOf(item)
      const bucket = byType.get(key)
      if (bucket) bucket.push(item)
      else byType.set(key, [item])
    }
  }
  return SECTION_ORDER.flatMap((section): MediaSection[] => {
    if (section.kind === 'category') {
      const bucket = byCategory.get(section.key)
      return bucket ? [{ kind: 'category', key: section.key, items: bucket }] : []
    }
    const bucket = byType.get(section.key)
    return bucket ? [{ kind: 'type', key: section.key, items: bucket }] : []
  })
}
