import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { MediaMetadata } from '@/types/storage'
import { cn } from '@/shared/ui/cn'
import { isAutoCategory } from '../utils/media-categories'

interface AutoCategoryMarkerProps {
  media: Pick<MediaMetadata, 'category' | 'categorySource'>
  className?: string
}

/**
 * Subtle "auto" tag for a category the background analysis suggested.
 * Picking a category from the card's menu makes it explicit and hides this.
 */
export const AutoCategoryMarker = memo(function AutoCategoryMarker({
  media,
  className,
}: AutoCategoryMarkerProps) {
  const { t } = useTranslation()
  if (!isAutoCategory(media)) return null
  return (
    <span
      className={cn(
        'pointer-events-auto flex-shrink-0 rounded px-1 text-[8px] font-medium uppercase leading-[14px] tracking-wide',
        className,
      )}
      title={t('media.card.autoCategoryHint', {
        category: t(`media.category.${media.category}`),
      })}
    >
      {t('media.card.autoCategory')}
    </span>
  )
})
