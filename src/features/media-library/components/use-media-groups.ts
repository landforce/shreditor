import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AudioWaveform,
  CircleDashed,
  Clapperboard,
  FileAudio,
  FileJson,
  Film,
  Image as ImageIcon,
  Layers,
  Mic,
  Music,
  Presentation,
  Shapes,
  UserRound,
  Video,
} from 'lucide-react'
import type { MediaMetadata } from '@/types/storage'
import { getMediaType } from '../utils/validation'
import {
  groupMediaByCategory,
  hasMediaCategories,
  MEDIA_CATEGORIES,
  UNCATEGORIZED,
} from '../utils/media-categories'

export const MEDIA_GROUP_ICONS = {
  video: Video,
  audio: FileAudio,
  image: ImageIcon,
  gif: Film,
  lottie: FileJson,
  speaker: UserRound,
  'b-roll': Clapperboard,
  graphics: Presentation,
  overlay: Layers,
  voiceover: Mic,
  music: Music,
  sfx: AudioWaveform,
  other: Shapes,
  [UNCATEGORIZED]: CircleDashed,
} as const

export type MediaGroupIcon = keyof typeof MEDIA_GROUP_ICONS

interface MediaGroup {
  key: string
  label: string
  icon: MediaGroupIcon
  items: MediaMetadata[]
}

function categoryGroupKey(key: string): string {
  return `category:${key}`
}

/** Every group key, so all groups start expanded. */
export const ALL_MEDIA_GROUP_KEYS = [
  'video',
  'audio',
  'image',
  'gif',
  'lottie',
  ...[...MEDIA_CATEGORIES, UNCATEGORIZED].map(categoryGroupKey),
]

type TypeGroupKey = 'video' | 'audio' | 'image' | 'gif' | 'lottie'

const TYPE_GROUP_LABELS = {
  video: 'media.library.groupVideos',
  audio: 'media.library.groupAudio',
  image: 'media.library.groupImages',
  gif: 'media.library.groupGifs',
  lottie: 'media.library.groupLottie',
} as const satisfies Record<TypeGroupKey, string>

function typeGroupOf(item: MediaMetadata): TypeGroupKey {
  if (item.mimeType === 'image/gif') return 'gif'
  const type = getMediaType(item.mimeType)
  return type === 'video' || type === 'audio' || type === 'lottie' ? type : 'image'
}

/**
 * The media library's sections. By file type, unless some media in the
 * project (`allItems`, unfiltered, so a search doesn't flip the layout) has a
 * category: then by category, uncategorized last. `filteredItems` keep their
 * search, filter and sort within each group.
 */
export function useMediaGroups(
  filteredItems: MediaMetadata[],
  allItems: MediaMetadata[],
): MediaGroup[] {
  const { t } = useTranslation()
  const byCategory = useMemo(() => hasMediaCategories(allItems), [allItems])
  return useMemo(() => {
    if (byCategory) {
      return groupMediaByCategory(filteredItems).map(({ key, items }) => ({
        key: categoryGroupKey(key),
        label: t(`media.category.${key}`),
        icon: key,
        items,
      }))
    }
    const buckets = new Map<TypeGroupKey, MediaMetadata[]>()
    for (const item of filteredItems) {
      const key = typeGroupOf(item)
      const bucket = buckets.get(key)
      if (bucket) bucket.push(item)
      else buckets.set(key, [item])
    }
    const order: TypeGroupKey[] = ['video', 'audio', 'image', 'gif', 'lottie']
    return order.flatMap((key) => {
      const items = buckets.get(key)
      return items ? [{ key, label: t(TYPE_GROUP_LABELS[key]), icon: key, items }] : []
    })
  }, [byCategory, filteredItems, t])
}
