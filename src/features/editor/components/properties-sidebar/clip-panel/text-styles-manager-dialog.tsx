import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { TextStyleDefinition } from '@/types/text-style'
import { useLibraryTextStylesStore, useProjectTextStylesStore } from '@/shared/state/text-styles'
import {
  removeProjectTextStyle,
  upsertProjectTextStyle,
  useItemsStore,
} from '@/features/editor/deps/timeline-store'
import { duplicateTextStyle, roleLabelKey } from './text-style-picker-model'

interface TextStylesManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  canvas: { width: number; height: number }
}

/** Rename, duplicate and delete project styles; remove library styles. */
export function TextStylesManagerDialog({
  open,
  onOpenChange,
  canvas,
}: TextStylesManagerDialogProps) {
  const { t } = useTranslation()
  const projectStyles = useProjectTextStylesStore((s) => s.styles)
  const libraryStyles = useLibraryTextStylesStore((s) => s.styles)
  const items = useItemsStore((s) => s.items)
  const usedBy = (id: string) =>
    items.filter((item) => item.type === 'text' && item.textStyleId === id).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('textStyles.manageTitle')}</DialogTitle>
          <DialogDescription>{t('textStyles.manageDescription')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
          {projectStyles.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('textStyles.empty')}</p>
          ) : (
            projectStyles.map((style) => (
              <ProjectStyleRow
                key={style.id}
                style={style}
                usedBy={usedBy(style.id)}
                canvas={canvas}
              />
            ))
          )}
        </div>
        <div className="space-y-1.5 border-t border-border pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('textStyles.libraryTitle')}
          </p>
          {libraryStyles.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('textStyles.libraryEmpty')}</p>
          ) : (
            libraryStyles.map((style) => (
              <div key={style.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">
                  {style.name}
                  <span className="ml-1 text-muted-foreground">
                    · {t(roleLabelKey(style.role))}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px]"
                  onClick={() =>
                    void useLibraryTextStylesStore
                      .getState()
                      .removeStyle(style.id)
                      .catch(() => toast.error(t('textStyles.libraryWriteFailed')))
                  }
                >
                  {t('textStyles.deleteFromLibrary')}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProjectStyleRow({
  style,
  usedBy,
  canvas,
}: {
  style: TextStyleDefinition
  usedBy: number
  canvas: { width: number; height: number }
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(style.name)
  const rename = () => {
    const next = name.trim()
    if (!next || next === style.name) return setName(style.name)
    upsertProjectTextStyle(
      { ...style, name: next, version: style.version + 1, updatedAt: Date.now() },
      canvas,
    )
  }
  const duplicate = () => {
    const styles = useProjectTextStylesStore.getState().styles
    upsertProjectTextStyle(
      duplicateTextStyle(style, `${style.name} ${t('textStyles.copySuffix')}`, styles),
      canvas,
    )
  }
  return (
    <div className="flex items-center gap-1.5" data-testid="text-style-row">
      <Input
        value={name}
        aria-label={t('textStyles.rename')}
        className="h-7 flex-1 text-xs"
        onChange={(event) => setName(event.target.value)}
        onBlur={rename}
        onKeyDown={(event) => {
          if (event.key === 'Enter') rename()
        }}
      />
      <span className="w-16 shrink-0 text-[10px] text-muted-foreground">
        {t('textStyles.usedBy', { count: usedBy })}
      </span>
      <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={duplicate}>
        {t('textStyles.duplicate')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-[11px] text-destructive"
        onClick={() => removeProjectTextStyle(style.id, canvas)}
      >
        {t('textStyles.delete')}
      </Button>
    </div>
  )
}
