import type { MediaMetadata } from '@/types/storage'
import { i18n } from '@/i18n'
import {
  isMediaPreparationBlocked,
  mediaPreparationPercent,
} from '@/shared/utils/media-compatibility'
import { useMediaLibraryStore } from '../stores/media-library-store'

/** The card's "preparing" label: working-copy progress or failure, else `fallback`. */
export function preparationLabel(media: MediaMetadata, fallback: string): string {
  const status = media.compatibility?.status
  if (status === 'preparing')
    return i18n.t('media.card.makingPlayableCopy', { percent: mediaPreparationPercent(media) })
  if (status === 'failed') return i18n.t('media.card.noPlayableCopy')
  return fallback
}

/**
 * Media that can go on the timeline; tells the user about any left out
 * because their working copy isn't ready.
 */
export function placeableMedia(items: MediaMetadata[]): MediaMetadata[] {
  const blocked = items.filter((m) => isMediaPreparationBlocked(m))
  if (blocked.length > 0) {
    useMediaLibraryStore.getState().showNotification({
      type: 'info',
      message: i18n.t('media.card.notPlayableYet', {
        count: blocked.length,
        name: blocked[0]!.fileName,
      }),
    })
  }
  return items.filter((m) => !isMediaPreparationBlocked(m))
}
