import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/ui/cn'
import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import { useLibraryTextStylesStore, useProjectTextStylesStore } from '@/shared/state/text-styles'
import {
  canvasAspect,
  resolveTextStyleUpdates,
} from '@/shared/typography/text-styles/text-style-resolve'
import {
  applyTextStyleToItems,
  saveTextStyleFromItems,
  upsertProjectTextStyle,
} from '@/features/editor/deps/timeline-store'
import { buildTextStylePickerGroups, textStyleWithVersionFor } from './text-style-picker-model'

interface CaptionStyleChoicesProps {
  items: Array<SubtitleSegmentItem | TextItem>
  canvasWidth: number
  canvasHeight: number
  onApplyPatch: (patch: Partial<SubtitleSegmentItem | TextItem>) => void
}

/**
 * The project's and the library's caption styles (the built-in caption
 * presets among them once the library is seeded). Caption text items are
 * linked to the style; subtitle segments take a copy of its look. A style
 * with no version for the canvas's aspect gets one, cloned from its closest,
 * when it is picked.
 */
export function CaptionStyleChoices({
  items,
  canvasWidth,
  canvasHeight,
  onApplyPatch,
}: CaptionStyleChoicesProps) {
  const { t } = useTranslation()
  const projectStyles = useProjectTextStylesStore((s) => s.styles)
  const libraryStyles = useLibraryTextStylesStore((s) => s.styles)
  const canvas = useMemo(
    () => ({ width: canvasWidth, height: canvasHeight }),
    [canvasHeight, canvasWidth],
  )
  const entries = useMemo(() => {
    const groups = buildTextStylePickerGroups(projectStyles, libraryStyles, 'captions', canvas)
    return [...groups.project, ...groups.library].filter((entry) => entry.style.role === 'caption')
  }, [canvas, libraryStyles, projectStyles])
  if (entries.length === 0) return null

  const aspect = canvasAspect(canvas)
  const apply = (picked: TextStyleDefinition, fits: boolean) => {
    const style = fits ? picked : textStyleWithVersionFor(picked, canvas)
    const textIds = items.filter((item) => item.type === 'text').map((item) => item.id)
    if (textIds.length > 0) {
      if (fits) applyTextStyleToItems(textIds, style, canvas)
      else saveTextStyleFromItems(style, textIds, canvas)
    } else if (!fits) {
      upsertProjectTextStyle(style, canvas)
    }
    if (items.some((item) => item.type !== 'text')) {
      const {
        textMotion: _motion,
        textSpans: _spans,
        ...look
      } = resolveTextStyleUpdates(style, canvas, {
        baseTransform: items[0]?.transform,
      })
      onApplyPatch(look as Partial<SubtitleSegmentItem>)
    }
  }
  const active = items[0]?.type === 'text' ? items[0].textStyleId : undefined

  return (
    <div>
      <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('textStyles.yourStyles')}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {entries.map(({ style, fits }) => (
          <button
            key={style.id}
            type="button"
            onClick={() => apply(style, fits)}
            title={fits ? style.name : t('textStyles.noVersionMake', { aspect })}
            className={cn(
              'truncate rounded border px-2 py-1.5 text-center text-[11px] transition-colors',
              fits ? '' : 'border-dashed',
              active === style.id
                ? 'border-border/70 bg-secondary/60 text-foreground'
                : 'border-border text-muted-foreground hover:bg-secondary/40',
            )}
          >
            {style.name}
          </button>
        ))}
      </div>
    </div>
  )
}
