import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormatDefinition } from '@formats/registry.mjs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { loadFormatGuide } from '@/shared/formats/format-guides'
import { GuideMarkdown } from '@/shared/formats/guide-markdown'

type GuideState =
  | { status: 'loading' }
  | { status: 'ready'; markdown: string }
  | { status: 'failed' }

/** The format's guide (formats/<id>/guide.md), rendered from Markdown. */
export function FormatGuideDialog({
  format,
  open,
  onOpenChange,
}: {
  format: Pick<FormatDefinition, 'id' | 'name'>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [guide, setGuide] = useState<GuideState>({ status: 'loading' })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setGuide({ status: 'loading' })
    loadFormatGuide(format.id).then(
      (markdown) => !cancelled && setGuide({ status: 'ready', markdown }),
      () => !cancelled && setGuide({ status: 'failed' }),
    )
    return () => {
      cancelled = true
    }
  }, [open, format.id])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('formats.guide.title', { format: format.name })}</DialogTitle>
          <DialogDescription>{t('formats.guide.description')}</DialogDescription>
        </DialogHeader>
        {guide.status === 'ready' ? (
          <GuideMarkdown markdown={guide.markdown} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {guide.status === 'loading' ? t('formats.guide.loading') : t('formats.guide.failed')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
