import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CUT_ASPECT_PRESETS, cutLabelError, projectAspect } from '@/shared/projects/cuts.mjs'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { CutLabelTakenError, createCut } from './create-cut'

const logger = createLogger('NewCutDialog')

interface NewCutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  canvas: { width: number; height: number }
  /** Saves the open project first, so the cut copies what the user sees. */
  onSave?: () => Promise<void>
}

/** "New cut…": a label and an aspect (same, 9:16, 16:9, 1:1, 4:5); opens the new cut. */
export function NewCutDialog({ open, onOpenChange, projectId, canvas, onSave }: NewCutDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [label, setLabel] = useState('')
  const [aspect, setAspect] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current = projectAspect({ metadata: canvas })

  useEffect(() => {
    if (!open) return
    setLabel('')
    setAspect(null)
    setError(null)
  }, [open])

  const submit = async () => {
    const invalid = cutLabelError(label)
    if (invalid) {
      setError(t('cuts.new.labelRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (useTimelineStore.getState().isDirty && onSave) await onSave()
      const result = await createCut(projectId, label, aspect === current ? null : aspect)
      onOpenChange(false)
      const review = result.review.length + result.stylesWithoutAspect.length
      toast.success(
        review > 0
          ? t('cuts.new.createdReview', { label: label.trim(), count: review })
          : t('cuts.new.created', { label: label.trim() }),
      )
      void navigate({ to: '/editor/$projectId', params: { projectId: result.id } })
    } catch (caught) {
      if (caught instanceof CutLabelTakenError) setError(t('cuts.new.labelTaken'))
      else {
        logger.error('Making a cut failed', caught)
        setError(t('cuts.new.failed'))
      }
    } finally {
      setBusy(false)
    }
  }

  const options: Array<{ id: string | null; label: string }> = [
    { id: null, label: t('cuts.new.sameAspect', { aspect: current }) },
    ...CUT_ASPECT_PRESETS.filter((a) => a !== current).map((a) => ({ id: a, label: a })),
  ]

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('cuts.new.title')}</DialogTitle>
          <DialogDescription>{t('cuts.new.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-cut-label">{t('cuts.new.label')}</Label>
            <Input
              id="new-cut-label"
              autoFocus
              value={label}
              maxLength={60}
              placeholder={t('cuts.new.labelPlaceholder')}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label id="new-cut-aspect">{t('cuts.new.aspect')}</Label>
            <div
              role="radiogroup"
              aria-labelledby="new-cut-aspect"
              className="flex flex-wrap gap-1.5"
            >
              {options.map((option) => (
                <button
                  key={option.id ?? 'same'}
                  type="button"
                  role="radio"
                  aria-checked={aspect === option.id}
                  onClick={() => setAspect(option.id)}
                  className={cn(
                    'h-7 rounded-md border px-2.5 text-xs font-medium transition-colors',
                    aspect === option.id
                      ? 'border-primary bg-primary-soft text-primary-text'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {aspect && <p className="text-xs text-muted-foreground">{t('cuts.new.refitHint')}</p>}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('cuts.new.creating') : t('cuts.new.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
