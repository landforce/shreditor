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
  ScanSearch,
  Shapes,
  UserRound,
  Video,
} from 'lucide-react'
import type { MediaMetadata } from '@/types/storage'
import {
  groupMediaSections,
  MEDIA_CATEGORIES,
  UNCATEGORIZED,
  type MediaTypeGroupKey,
} from '../utils/media-categories'
import { useAutoCategories } from './use-auto-categories'

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
  analyzing: ScanSearch,
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
  'analyzing',
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

/**
 * The media library's sections (see {@link groupMediaSections}): categories
 * (explicit, or suggested by the background analysis), then "Analyzing",
 * then the rest by file type. `filteredItems` keep their search, filter and
 * sort within each group.
 */
export function useMediaGroups(filteredItems: MediaMetadata[]): MediaGroup[] {
  const { t } = useTranslation()
  const verdicts = useAutoCategories()

  return useMemo(
    () =>
      groupMediaSections(filteredItems, (item) => verdicts.get(item.id)).map((section) => {
        switch (section.kind) {
          case 'category':
            return {
              key: categoryGroupKey(section.key),
              label: t(`media.category.${section.key}`),
              icon: section.key,
              items: section.items,
            }
          case 'analyzing':
            return {
              key: 'analyzing',
              label: t('media.library.groupAnalyzing'),
              icon: 'analyzing',
              items: section.items,
            }
          default:
            return {
              key: section.key,
              label: t(TYPE_GROUP_LABELS[section.key]),
              icon: section.key,
              items: section.items,
            }
        }
      }),
    [filteredItems, verdicts, t],
  )
}
