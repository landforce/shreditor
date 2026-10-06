import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RefreshCw, Search, Sparkles, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/shared/ui/cn'
import {
  MOTION_TEMPLATE_CATEGORIES,
  type MotionTemplate,
} from '@/shared/motion-templates/template-core.mjs'
import { useCompositionsStore, updateMotionTemplate } from '../deps/timeline'
import {
  endTemplateDrag,
  insertTemplateAtPlayhead,
  MissingTemplateMediaError,
  startTemplateDrag,
} from '../services/motion-template-service'
import {
  useMotionTemplateLibrary,
  useTemplateThumbnail,
  type LibraryTemplate,
} from '../hooks/use-motion-template-library'
import { SaveMotionTemplateDialog } from './save-motion-template-dialog'

const ALL = 'all'

type Translate = ReturnType<typeof useTranslation>['t']

function missingMediaMessage(t: Translate, template: MotionTemplate, files: string[]): string {
  return t('motionTemplates.missingMedia', { name: template.name, files: files.join(', ') })
}

function runUpdate(t: Translate, template: MotionTemplate) {
  try {
    const result = updateMotionTemplate(template)
    if (!result) return toast.info(t('motionTemplates.upToDate', { name: template.name }))
    toast.success(
      t('motionTemplates.updated', {
        name: template.name,
        version: result.toVersion,
        count: result.instances,
      }),
      result.droppedControls.length
        ? {
            description: t('motionTemplates.droppedControls', {
              names: result.droppedControls.join(', '),
            }),
          }
        : undefined,
    )
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function runInsert(t: Translate, template: MotionTemplate) {
  try {
    const result = await insertTemplateAtPlayhead(template)
    if (!result.outdated) return
    toast.info(
      t('motionTemplates.outdated', {
        name: template.name,
        projectVersion: result.projectVersion,
        libraryVersion: template.version,
      }),
      { action: { label: t('motionTemplates.update'), onClick: () => runUpdate(t, template) } },
    )
  } catch (error) {
    if (error instanceof MissingTemplateMediaError) {
      toast.error(
        missingMediaMessage(
          t,
          template,
          error.missing.map((ref) => ref.fileName),
        ),
      )
    } else toast.error(error instanceof Error ? error.message : String(error))
  }
}

const TemplateCard = memo(function TemplateCard({
  entry,
  projectVersion,
}: {
  entry: LibraryTemplate
  projectVersion: number | undefined
}) {
  const { t } = useTranslation()
  const { template, missingMedia } = entry
  const thumbnail = useTemplateThumbnail(template.id, template.updatedAt)
  const outdated = projectVersion !== undefined && projectVersion < template.version
  const missing = missingMedia.length > 0
  const onDragStart = (event: React.DragEvent) => {
    if (!missing) return startTemplateDrag(template, event.dataTransfer)
    event.preventDefault()
    toast.error(
      missingMediaMessage(
        t,
        template,
        missingMedia.map((ref) => ref.fileName),
      ),
    )
  }
  return (
    <div className="group flex flex-col gap-1 rounded-md border border-border bg-secondary/30 p-1.5 hover:border-primary/50">
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onDragEnd={endTemplateDrag}
        onClick={() => void runInsert(t, template)}
        className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm bg-slate-950"
        title={t('motionTemplates.insertHint')}
        aria-label={t('motionTemplates.insert', { name: template.name })}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : (
          <Sparkles className="h-4 w-4 text-muted-foreground" />
        )}
        {missing && (
          <TriangleAlert
            className="absolute right-1 top-1 h-3.5 w-3.5 text-destructive"
            aria-label={t('motionTemplates.mediaMissingBadge')}
          />
        )}
      </button>
      <div className="min-w-0 px-0.5">
        <div className="truncate text-[11px] font-medium leading-tight">{template.name}</div>
        <div className="truncate text-[10px] text-muted-foreground">
          {t(`motionTemplates.categories.${template.category}`)} ·{' '}
          {(template.durationInFrames / template.fps).toFixed(1)}s · v{template.version}
        </div>
      </div>
      {outdated && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 text-[10px]"
          onClick={() => runUpdate(t, template)}
        >
          {t('motionTemplates.updateFrom', { version: projectVersion })}
        </Button>
      )}
    </div>
  )
})

function useProjectTemplateVersions(): Map<string, number> {
  const compositions = useCompositionsStore((state) => state.compositions)
  return useMemo(() => {
    const versions = new Map<string, number>()
    for (const composition of compositions) {
      if (!composition.templateId) continue
      const version = composition.templateVersion ?? 0
      versions.set(
        composition.templateId,
        Math.max(version, versions.get(composition.templateId) ?? 0),
      )
    }
    return versions
  }, [compositions])
}

function filterEntries(entries: LibraryTemplate[], query: string, category: string) {
  const needle = query.trim().toLowerCase()
  return entries.filter(
    ({ template }) =>
      (category === ALL || template.category === category) &&
      (!needle ||
        template.name.toLowerCase().includes(needle) ||
        template.controls.some((control) => control.name.toLowerCase().includes(needle))),
  )
}

/** The Templates tab: the workspace's motion graphics templates, click or drag to insert. */
export function MotionTemplatesPanel({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const { entries, loaded, reload } = useMotionTemplateLibrary(active)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(ALL)
  const versions = useProjectTemplateVersions()
  const shown = filterEntries(entries, query, category)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('motionTemplates.search')}
            className="h-7 pl-7 text-xs"
            aria-label={t('motionTemplates.search')}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => void reload()}
          aria-label={t('motionTemplates.refresh')}
          data-tooltip={t('motionTemplates.refresh')}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Select value={category} onValueChange={setCategory}>
        <SelectTrigger className="h-7 text-xs" aria-label={t('motionTemplates.category')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL} className="text-xs">
            {t('motionTemplates.allCategories')}
          </SelectItem>
          {MOTION_TEMPLATE_CATEGORIES.map((id) => (
            <SelectItem key={id} value={id} className="text-xs">
              {t(`motionTemplates.categories.${id}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loaded && shown.length === 0 ? (
          <p className="px-1 py-4 text-center text-[11px] leading-snug text-muted-foreground">
            {entries.length === 0 ? t('motionTemplates.empty') : t('motionTemplates.noMatches')}
          </p>
        ) : (
          <div className={cn('grid grid-cols-2 gap-1.5')} data-testid="motion-templates-grid">
            {shown.map((entry) => (
              <TemplateCard
                key={entry.template.id}
                entry={entry}
                projectVersion={versions.get(entry.template.id)}
              />
            ))}
          </div>
        )}
      </div>
      <SaveMotionTemplateDialog onSaved={() => void reload()} />
    </div>
  )
}
