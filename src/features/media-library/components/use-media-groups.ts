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
import type { MediaCategory, MediaMetadata } from '@/types/storage'
import {
  groupMediaSections,
  isMediaCategory,
  MEDIA_CATEGORIES,
  mediaTypeGroupOf,
  UNCATEGORIZED,
  type MediaTypeGroupKey,
} from '../utils/media-categories'
import type { MediaRole } from '../utils/media-role'
import { useMediaRoles } from './use-media-roles'

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

const TYPE_GROUP_LABELS = {
  video: 'media.library.groupVideos',
  audio: 'media.library.groupAudio',
  image: 'media.library.groupImages',
  gif: 'media.library.groupGifs',
  lottie: 'media.library.groupLottie',
} as const satisfies Record<MediaTypeGroupKey, string>

const AUTO_ROLE_CATEGORY: Partial<Record<MediaRole, MediaCategory>> = {
  speaker: 'speaker',
  broll: 'b-roll',
}

/**
 * The media library's sections (see {@link groupMediaSections}). A saved
 * category always wins; uncategorized videos use the speaker / b-roll role
 * inferred from transcript + visual analysis. `filteredItems` keep their
 * search, filter and sort within each group.
 */
export function useMediaGroups(filteredItems: MediaMetadata[]): MediaGroup[] {
  const { t } = useTranslation()
  const uncategorizedVideos = useMemo(
    () =>
      filteredItems.filter(
        (item) => !isMediaCategory(item.category) && mediaTypeGroupOf(item) === 'video',
      ),
    [filteredItems],
  )
  const videoRoles = useMediaRoles(uncategorizedVideos)

  return useMemo(() => {
    const sections = groupMediaSections(
      filteredItems,
      (item) => AUTO_ROLE_CATEGORY[videoRoles.get(item.id) ?? 'pending'],
    )
    const anyVideoSorted = sections.some(
      (s) => s.kind === 'category' && (s.key === 'speaker' || s.key === 'b-roll'),
    )
    return sections.map((section) =>
      section.kind === 'category'
        ? {
            key: categoryGroupKey(section.key),
            label: t(`media.category.${section.key}`),
            icon: section.key,
            items: section.items,
          }
        : {
            key: section.key,
            // Videos not sorted yet read as "Analyzing" once others have a role
            label:
              section.key === 'video' && anyVideoSorted
                ? t('media.library.groupAnalyzing')
                : t(TYPE_GROUP_LABELS[section.key]),
            icon: section.key,
            items: section.items,
          },
    )
  }, [filteredItems, videoRoles, t])
}
