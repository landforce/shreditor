import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BookOpen, LayoutTemplate, Repeat2 } from 'lucide-react'
import { getFormat, projectFormatRecord, type ResolvedFormat } from '@formats/registry.mjs'
import type { Scorecard } from '@formats/scorecard.mjs'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { FormatLayoutCue } from '@/shared/formats/format-layout-cue'
import { formatRuleLines, formatTagline, variantName } from '@/shared/formats/format-text'
import { useFormatScorecardStore } from '@/shared/state/format-scorecard'
import { cn } from '@/shared/ui/cn'
import { useProjectStore } from '@/features/editor/deps/projects'
import { PropertySection } from '../properties-sidebar/components'
import { ChangeFormatDialog } from './change-format-dialog'
import { FormatGuideDialog } from './format-guide-dialog'
import { useResolvedProjectFormat } from './project-format'
import { ScorecardList } from './scorecard-list'

const ANY_VARIANT = '__any__'

function VariantSelect({ projectId, format }: { projectId: string; format: ResolvedFormat }) {
  const { t } = useTranslation()
  const definition = getFormat(format.id)!
  if (definition.variants.length === 0) return null
  const change = async (value: string) => {
    const variant = value === ANY_VARIANT ? null : value
    try {
      await useProjectStore
        .getState()
        .setProjectFormat(projectId, projectFormatRecord(format.id, variant))
    } catch (error) {
      toast.error(t('formats.panel.saveFailed'), {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }
  return (
    <Select value={format.variant?.id ?? ANY_VARIANT} onValueChange={(v) => void change(v)}>
      <SelectTrigger
        className="h-7 w-auto min-w-28 text-xs"
        aria-label={t('formats.panel.variant')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!definition.defaultVariant && (
          <SelectItem value={ANY_VARIANT}>{t('formats.picker.anyVariant')}</SelectItem>
        )}
        {definition.variants.map((variant) => (
          <SelectItem key={variant.id} value={variant.id}>
            {variantName(t, format.id, variant)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SummaryCounts({ card }: { card: Scorecard }) {
  const { t } = useTranslation()
  const counts = [
    { key: 'fail', value: card.summary.fail, className: 'bg-destructive/10 text-destructive' },
    { key: 'warn', value: card.summary.warn, className: 'bg-amber-500/10 text-amber-700' },
    { key: 'pass', value: card.summary.pass, className: 'bg-emerald-500/10 text-emerald-700' },
  ] as const
  return (
    <div className="flex items-center gap-1.5" data-testid="format-summary">
      {counts.map((count) => (
        <span
          key={count.key}
          className={cn('rounded-md px-2 py-1 text-xs font-semibold tabular-nums', count.className)}
        >
          {t(`formats.panel.count.${count.key}`, { count: count.value })}
        </span>
      ))}
      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
        {t('formats.panel.duration', { seconds: card.durationSec })}
      </span>
    </div>
  )
}

function RulesList({ format }: { format: ResolvedFormat }) {
  const { t } = useTranslation()
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      {formatRuleLines(t, format).map((line) => (
        <div key={line.key} className="contents">
          <dt className="font-semibold text-foreground">{line.label}</dt>
          <dd className="text-secondary-foreground">{line.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function NoFormat({ onSet }: { onSet: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-4">
      <LayoutTemplate className="h-5 w-5 text-primary-text" />
      <div>
        <h3 className="text-sm font-bold text-foreground">{t('formats.panel.noFormatTitle')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('formats.panel.noFormatBody')}</p>
      </div>
      <Button size="sm" onClick={onSet}>
        {t('formats.panel.setFormat')}
      </Button>
    </div>
  )
}

function FormatHeader({
  projectId,
  format,
  onGuide,
  onChange,
}: {
  projectId: string
  format: ResolvedFormat
  onGuide: () => void
  onChange: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2.5">
      <div className="flex gap-3">
        <FormatLayoutCue id={format.id} className="h-[72px] w-[40px]" />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-display text-base font-extrabold leading-tight tracking-tight text-foreground">
            {format.name}
          </h3>
          <p className="text-xs text-muted-foreground">{formatTagline(t, format)}</p>
          <VariantSelect projectId={projectId} format={format} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onGuide}>
          <BookOpen className="h-3.5 w-3.5" />
          {t('formats.panel.readGuide')}
        </Button>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onChange}>
          <Repeat2 className="h-3.5 w-3.5" />
          {t('formats.panel.changeFormat')}
        </Button>
      </div>
    </div>
  )
}

function ScorecardSection({ format }: { format: ResolvedFormat }) {
  const { t } = useTranslation()
  const card = useFormatScorecardStore((s) => s.card)
  const stale = useFormatScorecardStore((s) => s.stale)
  const showRanges = useFormatScorecardStore((s) => s.showTimelineRanges)
  const setShowRanges = useFormatScorecardStore((s) => s.setShowTimelineRanges)
  const current = card?.format === format.id ? card : null
  return (
    <div className="space-y-2.5">
      {current ? (
        <>
          <SummaryCounts card={current} />
          {stale && <p className="text-[11px] text-amber-700">{t('formats.panel.scoringMain')}</p>}
          {current.durationSec === 0 && (
            <p className="text-[11px] text-muted-foreground">{t('formats.panel.empty')}</p>
          )}
          <ScorecardList card={current} format={format} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('formats.panel.scoring')}</p>
      )}
      <label className="flex items-center justify-between gap-3 pt-1 text-xs text-secondary-foreground">
        {t('formats.panel.showRanges')}
        <Switch checked={showRanges} onCheckedChange={setShowRanges} />
      </label>
    </div>
  )
}

/**
 * The project's format: what it is, its rules in plain words and a live
 * scorecard of the timeline against it. Change it, switch the variant or read
 * the guide from here; projects without one can set it.
 */
export const FormatPanel = memo(function FormatPanel() {
  const { t } = useTranslation()
  const projectId = useProjectStore((s) => s.currentProject?.id)
  const format = useResolvedProjectFormat()
  const [changeOpen, setChangeOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  if (!projectId) return null

  return (
    <div className="space-y-3" data-testid="format-panel">
      {format ? (
        <>
          <FormatHeader
            projectId={projectId}
            format={format}
            onGuide={() => setGuideOpen(true)}
            onChange={() => setChangeOpen(true)}
          />
          <PropertySection title={t('formats.panel.scorecard')}>
            <ScorecardSection format={format} />
          </PropertySection>
          <PropertySection title={t('formats.rules.title')}>
            <RulesList format={format} />
          </PropertySection>
          <FormatGuideDialog format={format} open={guideOpen} onOpenChange={setGuideOpen} />
        </>
      ) : (
        <NoFormat onSet={() => setChangeOpen(true)} />
      )}
      <ChangeFormatDialog projectId={projectId} open={changeOpen} onOpenChange={setChangeOpen} />
    </div>
  )
})
