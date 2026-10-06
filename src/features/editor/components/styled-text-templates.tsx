import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TextStyleDefinition } from '@/types/text-style'
import { useLibraryTextStylesStore, useProjectTextStylesStore } from '@/shared/state/text-styles'
import {
  canvasAspect,
  textStyleVariantForCanvas,
} from '@/shared/typography/text-styles/text-style-resolve'

/**
 * "Saved styles" in the Text tab: the project's and the library's text
 * styles (captions aside), each adding a text that uses the style. A style
 * with no version for the canvas's aspect is marked; adding it makes one.
 */
export function StyledTextTemplates({
  canvas,
  onAdd,
}: {
  canvas: { width: number; height: number }
  onAdd: (style: TextStyleDefinition) => void
}) {
  const { t } = useTranslation()
  const projectStyles = useProjectTextStylesStore((s) => s.styles)
  const libraryStyles = useLibraryTextStylesStore((s) => s.styles)
  const styles = useMemo(() => {
    const own = new Set(projectStyles.map((style) => style.id))
    return [...projectStyles, ...libraryStyles.filter((style) => !own.has(style.id))].filter(
      (style) => style.role !== 'caption',
    )
  }, [libraryStyles, projectStyles])
  if (styles.length === 0) return null
  const aspect = canvasAspect(canvas)
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {t('textStyles.yourStyles')}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {styles.map((style) => {
          const variant = textStyleVariantForCanvas(style, canvas)
          const look = (variant ?? style.variants[0])?.style
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => onAdd(style)}
              className={`truncate rounded-md border border-border bg-secondary/30 px-2 py-2 text-[11px] transition-colors hover:border-primary/50 hover:bg-secondary/50 ${variant ? '' : 'border-dashed'}`}
              style={{
                fontFamily: look?.fontFamily,
                fontWeight: look?.fontWeight === 'bold' ? 700 : undefined,
              }}
              title={
                variant
                  ? (style.description ?? style.name)
                  : t('textStyles.noVersionMake', { aspect })
              }
            >
              {style.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
