import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Square } from 'lucide-react'
import { resolveFormat } from '@formats/registry.mjs'
import { FormatCards, type FormatSelection } from '@/shared/formats/format-cards'
import { FormatLayoutCue } from '@/shared/formats/format-layout-cue'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'
import type { Project } from '@/types/project'
import { useCreateProject } from '../hooks/use-project-actions'
import type { ProjectFormData } from '../utils/validation'
import { InlineCreateProjectForm, type LockedCanvas } from './project-form'

const logger = createLogger('NewProject')

/** null: nothing chosen yet; 'none': no format (custom canvas, plain tracks). */
type Choice = FormatSelection | 'none' | null

function NoFormatOption({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'mt-3 flex items-center gap-3 rounded-xl border border-dashed px-4 py-2.5 text-left transition-colors',
        selected
          ? 'border-primary bg-primary-soft'
          : 'border-border hover:border-primary/50 hover:bg-card',
      )}
    >
      <Square className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm font-semibold text-foreground">{t('formats.picker.noFormat')}</span>
      <span className="text-xs text-muted-foreground">
        {t('formats.picker.noFormatDescription')}
      </span>
    </button>
  )
}

/**
 * The new-project flow: the format comes first (it defines the project), then
 * the name and description. "No format" keeps the custom canvas pickers.
 */
export function NewProjectForm({ onCreated }: { onCreated: (project: Project) => void }) {
  const { t } = useTranslation()
  const createProject = useCreateProject()
  const [choice, setChoice] = useState<Choice>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const selection = choice && choice !== 'none' ? choice : null

  const lockedCanvas = useMemo<LockedCanvas | undefined>(() => {
    if (!selection) return undefined
    const format = resolveFormat(selection.id, selection.variant)
    return {
      ...format.canvas,
      title: t('formats.picker.canvasFromFormat', { format: format.name }),
      summary: t('formats.picker.canvasSummary', {
        ...format.canvas,
        tracks: format.tracks.length,
      }),
      cue: <FormatLayoutCue id={format.id} className="h-20 w-[45px]" />,
    }
  }, [selection, t])

  const handleSubmit = async (data: ProjectFormData) => {
    setIsSubmitting(true)
    try {
      const result = await createProject(data, selection)
      if (result.success && result.project) {
        onCreated(result.project)
        return
      }
      toast.error(t('projects.toasts.createFailed'), { description: result.error })
    } catch (error) {
      logger.error('Failed to create project:', error)
      toast.error(t('projects.toasts.createFailed'), { description: t('projects.tryAgain') })
    }
    setIsSubmitting(false)
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="format-picker-title">
        <h1
          id="format-picker-title"
          className="font-display text-2xl font-extrabold tracking-tight text-foreground"
        >
          {t('formats.picker.title')}
        </h1>
        <p className="mb-5 mt-1 max-w-3xl text-sm text-muted-foreground">
          {t('formats.picker.subtitle')}
        </p>
        <FormatCards value={selection} onChange={setChoice} />
        <NoFormatOption selected={choice === 'none'} onSelect={() => setChoice('none')} />
      </section>

      <InlineCreateProjectForm
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        lockedCanvas={lockedCanvas}
        blockedHint={choice === null ? t('formats.picker.chooseFirst') : undefined}
      />
    </div>
  )
}
