import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TextStyleDefinition } from '@/types/text-style'
import { useLibraryTextStylesStore, useProjectTextStylesStore } from '@/shared/state/text-styles'

/**
 * "Your styles" in the Text tab: the project's and the library's text styles
 * (captions aside), each adding a text that uses the style.
 */
export function StyledTextTemplates({ onAdd }: { onAdd: (style: TextStyleDefinition) => void }) {
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
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {t('textStyles.yourStyles')}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {styles.map((style) => (
          <button
            key={style.id}
            type="button"
            onClick={() => onAdd(style)}
            className="truncate rounded-md border border-border bg-secondary/30 px-2 py-2 text-[11px] transition-colors hover:border-primary/50 hover:bg-secondary/50"
            style={{
              fontFamily: style.style.fontFamily,
              fontWeight: style.style.fontWeight === 'bold' ? 700 : undefined,
            }}
            title={style.description ?? style.name}
          >
            {style.name}
          </button>
        ))}
      </div>
    </div>
  )
}
