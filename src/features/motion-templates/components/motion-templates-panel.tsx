import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, RefreshCw, Search, Sparkles, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
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
  templateAspects,
  type MotionTemplate,
} from '@/shared/motion-templates/template-core.mjs'
import { aspectKey, closestAspect } from '@/shared/projects/aspect.mjs'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { useCompositionsStore, updateMotionTemplate } from '../deps/timeline'
import { useProjectStore } from '../deps/projects'
import {
  endTemplateDrag,
  insertTemplateAtPlayhead,
  makeTemplateVariantForProject,
  MissingTemplateMediaError,
  MissingTemplateVariantError,
  projectAspect,
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

/** Transparent thumbnails sit on a checkerboard so their transparency reads. */
const CHECKERBOARD = {
  backgroundColor: '#1e293b',
  backgroundImage:
    'linear-gradient(45deg, #334155 25%, transparent 25%), linear-gradient(-45deg, #334155 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #334155 75%), linear-gradient(-45deg, transparent 75%, #334155 75%)',
  backgroundSize: '12px 12px',
  backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
    toast.error(errorText(error))
  }
}

async function runMakeVariant(t: Translate, template: MotionTemplate) {
  const aspect = projectAspect()
  try {
    await makeTemplateVariantForProject(template)
    toast.success(
      t('motionTemplates.madeVariant', {
        name: template.name,
        aspect,
        from: closestAspect(aspect, templateAspects(template)),
      }),
    )
  } catch (error) {
    toast.error(errorText(error))
  }
}

function insertErrorToast(t: Translate, template: MotionTemplate, error: unknown) {
  if (error instanceof MissingTemplateVariantError)
    return toast.error(t('motionTemplates.noVariant', { aspect: error.aspect }), {
      action: {
        label: t('motionTemplates.makeVariant', { aspect: error.aspect }),
        onClick: () => void runMakeVariant(t, template),
      },
    })
  if (error instanceof MissingTemplateMediaError)
    return toast.error(
      missingMediaMessage(
        t,
        template,
        error.missing.map((ref) => ref.fileName),
      ),
    )
  toast.error(errorText(error))
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
    insertErrorToast(t, template, error)
  }
}

/** The project's aspect first, else the closest one: what the card shows. */
function shownAspect(template: MotionTemplate, aspect: string): string {
  return template.variants[aspect]
    ? aspect
    : (closestAspect(aspect, templateAspects(template)) ?? aspect)
}

function AspectChips({ template, aspect }: { template: MotionTemplate; aspect: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-0.5" aria-label={t('motionTemplates.aspects')}>
      {templateAspects(template).map((key) => (
        <span
          key={key}
          data-testid="template-aspect-chip"
          className={cn(
            'rounded-sm border px-1 text-[9px] leading-[14px] tabular-nums',
            key === aspect
              ? 'border-primary/60 bg-primary/15 text-primary'
              : 'border-border text-muted-foreground',
          )}
        >
          {key}
        </span>
      ))}
    </div>
  )
}

/** Shown over a card's thumbnail when the template has no version for this project. */
function MissingVariantOverlay({ template, aspect }: { template: MotionTemplate; aspect: string }) {
  const { t } = useTranslation()
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 p-1 text-center">
      <span className="text-[10px] leading-tight text-white">
        {t('motionTemplates.noVariant', { aspect })}
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-6 gap-1 px-1.5 text-[10px]"
        onClick={(event) => {
          event.stopPropagation()
          void runMakeVariant(t, template)
        }}
      >
        <Copy className="h-3 w-3" />
        {t('motionTemplates.makeVariant', { aspect })}
      </Button>
    </div>
  )
}

function useCardDrag(t: Translate, entry: LibraryTemplate, hasVariant: boolean, aspect: string) {
  const { template, missingMedia } = entry
  return (event: React.DragEvent) => {
    if (hasVariant && missingMedia.length === 0)
      return startTemplateDrag(template, event.dataTransfer)
    event.preventDefault()
    if (!hasVariant) return insertErrorToast(t, template, new MissingTemplateVariantError(aspect))
    toast.error(
      missingMediaMessage(
        t,
        template,
        missingMedia.map((ref) => ref.fileName),
      ),
    )
  }
}

const TemplateCard = memo(function TemplateCard({
  entry,
  aspect,
  projectVersion,
  epoch,
}: {
  entry: LibraryTemplate
  aspect: string
  projectVersion: number | undefined
  epoch: number
}) {
  const { t } = useTranslation()
  const { template, missingMedia } = entry
  const variant = template.variants[shownAspect(template, aspect)]
  const hasVariant = Boolean(template.variants[aspect])
  const thumbnail = useTemplateThumbnail(template.id, variant?.thumbnail, epoch)
  const outdated =
    hasVariant &&
    projectVersion !== undefined &&
    projectVersion < template.variants[aspect]!.version
  const onDragStart = useCardDrag(t, entry, hasVariant, aspect)
  return (
    <div
      className="group flex flex-col gap-1 rounded-md border border-border bg-secondary/30 p-1.5 hover:border-primary/50"
      data-testid="motion-template-card"
      data-template-name={template.name}
    >
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onDragEnd={endTemplateDrag}
        onClick={() => void runInsert(t, template)}
        className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm"
        style={CHECKERBOARD}
        title={t('motionTemplates.insertHint')}
        aria-label={t('motionTemplates.insert', { name: template.name })}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : (
          <Sparkles className="h-4 w-4 text-muted-foreground" />
        )}
        {missingMedia.length > 0 && (
          <TriangleAlert
            className="absolute right-1 top-1 h-3.5 w-3.5 text-destructive"
            aria-label={t('motionTemplates.mediaMissingBadge')}
          />
        )}
        {!hasVariant && <MissingVariantOverlay template={template} aspect={aspect} />}
      </button>
      <div className="min-w-0 space-y-0.5 px-0.5">
        <div className="truncate text-[11px] font-medium leading-tight">{template.name}</div>
        <div className="truncate text-[10px] text-muted-foreground">
          {t(`motionTemplates.categories.${template.category}`)} ·{' '}
          {variant ? (variant.durationInFrames / variant.fps).toFixed(1) : '?'}s · v
          {template.version}
        </div>
        <AspectChips template={template} aspect={aspect} />
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

/** The newest version of each template the project has a copy of, by template and aspect. */
function useProjectTemplateVersions(): Map<string, number> {
  const compositions = useCompositionsStore((state) => state.compositions)
  return useMemo(() => {
    const versions = new Map<string, number>()
    for (const composition of compositions) {
      if (!composition.templateId) continue
      const variant = composition.templateAspect ?? aspectKey(composition.width, composition.height)
      const key = `${composition.templateId}|${variant}`
      versions.set(key, Math.max(composition.templateVersion ?? 0, versions.get(key) ?? 0))
    }
    return versions
  }, [compositions])
}

function useProjectAspect(): string {
  const width = useProjectStore((state) => state.currentProject?.metadata.width)
  const height = useProjectStore((state) => state.currentProject?.metadata.height)
  return aspectKey(width ?? DEFAULT_PROJECT_WIDTH, height ?? DEFAULT_PROJECT_HEIGHT)
}

interface EntryFilter {
  query: string
  category: string
  aspect: string | null
}

function filterEntries(entries: LibraryTemplate[], { query, category, aspect }: EntryFilter) {
  const needle = query.trim().toLowerCase()
  return entries.filter(
    ({ template }) =>
      (category === ALL || template.category === category) &&
      (!aspect || Boolean(template.variants[aspect])) &&
      (!needle ||
        template.name.toLowerCase().includes(needle) ||
        template.controls.some((control) => control.name.toLowerCase().includes(needle))),
  )
}

function SearchRow({
  query,
  onQuery,
  onReload,
}: {
  query: string
  onQuery: (value: string) => void
  onReload: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
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
        onClick={onReload}
        aria-label={t('motionTemplates.refresh')}
        data-tooltip={t('motionTemplates.refresh')}
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function CategorySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  return (
    <Select value={value} onValueChange={onChange}>
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
  )
}

function emptyMessage(t: Translate, total: number, onlyThisAspect: boolean, aspect: string) {
  if (total === 0) return t('motionTemplates.empty')
  return onlyThisAspect
    ? t('motionTemplates.noVariantMatches', { aspect })
    : t('motionTemplates.noMatches')
}

/** The Templates tab: the workspace's motion graphics templates, click or drag to insert. */
export function MotionTemplatesPanel({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const { entries, loaded, reload, epoch } = useMotionTemplateLibrary(active)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(ALL)
  const [onlyThisAspect, setOnlyThisAspect] = useState(false)
  const aspect = useProjectAspect()
  const versions = useProjectTemplateVersions()
  const shown = filterEntries(entries, {
    query,
    category,
    aspect: onlyThisAspect ? aspect : null,
  })

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <SearchRow query={query} onQuery={setQuery} onReload={() => void reload()} />
      <CategorySelect value={category} onChange={setCategory} />
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Switch
          checked={onlyThisAspect}
          onCheckedChange={setOnlyThisAspect}
          data-testid="motion-templates-aspect-filter"
        />
        {t('motionTemplates.thisProjectOnly', { aspect })}
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loaded && shown.length === 0 ? (
          <p className="px-1 py-4 text-center text-[11px] leading-snug text-muted-foreground">
            {emptyMessage(t, entries.length, onlyThisAspect, aspect)}
          </p>
        ) : (
          <div className={cn('grid grid-cols-2 gap-1.5')} data-testid="motion-templates-grid">
            {shown.map((entry) => (
              <TemplateCard
                key={entry.template.id}
                entry={entry}
                aspect={aspect}
                epoch={epoch}
                projectVersion={versions.get(`${entry.template.id}|${aspect}`)}
              />
            ))}
          </div>
        )}
      </div>
      <SaveMotionTemplateDialog onSaved={() => void reload()} />
    </div>
  )
}
