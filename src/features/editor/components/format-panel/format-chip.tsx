import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutTemplate } from 'lucide-react'
import { useEditorStore } from '@/shared/state/editor'
import { useFormatScorecardStore } from '@/shared/state/format-scorecard'
import { useSelectionStore } from '@/shared/state/selection'
import { variantName } from '@/shared/formats/format-text'
import { cn } from '@/shared/ui/cn'
import { useFormatPanelStore } from '../../stores/format-panel-store'
import { useResolvedProjectFormat } from './project-format'

/** Show the format panel: right sidebar open, nothing selected, Format tab. */
function openFormatPanel() {
  useSelectionStore.getState().clearSelection()
  useEditorStore.getState().setRightSidebarOpen(true)
  useFormatPanelStore.getState().setTab('format')
}

function StatusBadge() {
  const { t } = useTranslation()
  const summary = useFormatScorecardStore((s) => s.card?.summary)
  if (!summary) return null
  const [count, className, key] =
    summary.fail > 0
      ? [summary.fail, 'bg-destructive text-white', 'fail']
      : summary.warn > 0
        ? [summary.warn, 'bg-amber-500 text-white', 'warn']
        : [summary.pass, 'bg-emerald-500 text-white', 'pass']
  return (
    <span
      className={cn('rounded-full px-1.5 text-[10px] font-bold leading-4 tabular-nums', className)}
      title={t('formats.panel.summary', summary)}
    >
      {t(`formats.chip.${key}`, { count })}
    </span>
  )
}

/** The project's format in the top bar, with its scorecard status; opens the format panel. */
export const FormatChip = memo(function FormatChip() {
  const { t } = useTranslation()
  const format = useResolvedProjectFormat()
  return (
    <button
      type="button"
      onClick={openFormatPanel}
      data-testid="format-chip"
      aria-label={t('formats.chip.open')}
      data-tooltip={t('formats.chip.open')}
      data-tooltip-side="bottom"
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors',
        format
          ? 'border-transparent bg-primary-soft text-primary-text hover:bg-primary/15'
          : 'border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
      )}
    >
      <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
      {format ? (
        <>
          <span>{format.name}</span>
          {format.variant && (
            <span className="font-medium opacity-75">
              · {variantName(t, format.id, format.variant)}
            </span>
          )}
          <StatusBadge />
        </>
      ) : (
        <span>{t('formats.chip.none')}</span>
      )}
    </button>
  )
})
