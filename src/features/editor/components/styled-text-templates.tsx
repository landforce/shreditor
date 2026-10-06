import { useMemo, type DragEvent, type ReactNode } from 'react'
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
  renderPreview,
  onDragStart,
  onDragEnd,
}: {
  canvas: { width: number; height: number }
  onAdd: (style: TextStyleDefinition) => void
  /** A preview tile for the style; without one the button shows the name in its font. */
  renderPreview?: (style: TextStyleDefinition) => ReactNode
  /** Drag a style onto the timeline or canvas, like the other generated layers. */
  onDragStart?: (style: TextStyleDefinition) => (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
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
      <div className="grid grid-cols-3 gap-1.5">
        {styles.map((style) => (
          <StyleTile
            key={style.id}
            style={style}
            canvas={canvas}
            title={
              textStyleVariantForCanvas(style, canvas)
                ? (style.description ?? style.name)
                : t('textStyles.noVersionMake', { aspect })
            }
            preview={renderPreview?.(style) ?? null}
            onAdd={onAdd}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </div>
  )
}

/** One saved style: its preview (or "Aa" in its font and colour) and name. */
function StyleTile({
  style,
  canvas,
  title,
  preview,
  onAdd,
  onDragStart,
  onDragEnd,
}: {
  style: TextStyleDefinition
  canvas: { width: number; height: number }
  title: string
  preview: ReactNode
  onAdd: (style: TextStyleDefinition) => void
  onDragStart?: (style: TextStyleDefinition) => (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
}) {
  const variant = textStyleVariantForCanvas(style, canvas)
  const look = (variant ?? style.variants[0])?.style
  const dashed = variant ? '' : 'border-dashed'
  return (
    <button
      type="button"
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart?.(style)}
      onDragEnd={onDragEnd}
      onClick={() => onAdd(style)}
      className={`group flex flex-col items-center gap-1 rounded-md border border-border bg-secondary/30 p-1.5 transition-[transform,background-color,border-color,color] duration-150 hover:border-primary/50 hover:bg-secondary/50 active:scale-[0.98] ${dashed}`}
      title={title}
    >
      {preview ?? <StyleSwatch look={look} />}
      <span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground group-hover:text-foreground">
        {style.name}
      </span>
    </button>
  )
}

/** "Aa" in the style's font, weight and colour, for styles without a gallery preview. */
function StyleSwatch({
  look,
}: {
  look: TextStyleDefinition['variants'][number]['style'] | undefined
}) {
  return (
    <div
      className="flex aspect-video w-full items-center justify-center truncate rounded-sm border border-border bg-slate-950 px-1 text-[11px]"
      style={{
        fontFamily: look?.fontFamily,
        fontWeight: look?.fontWeight === 'bold' ? 700 : undefined,
        color: look?.color,
      }}
    >
      Aa
    </div>
  )
}
