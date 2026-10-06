import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Crosshair } from 'lucide-react'
import type { ResolvedFormat } from '@formats/registry.mjs'
import type { CheckStatus, Scorecard, ScorecardCheck } from '@formats/scorecard.mjs'
import { checkLabel } from '@/shared/formats/format-text'
import { usePlaybackStore } from '@/shared/state/playback'
import { cn } from '@/shared/ui/cn'

const STATUS_ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2, info: 3, na: 4 }

const STATUS_STYLE: Record<CheckStatus, { dot: string; text: string }> = {
  pass: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-700' },
  fail: { dot: 'bg-destructive', text: 'text-destructive' },
  info: { dot: 'bg-sky-500', text: 'text-sky-700' },
  na: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
}

function formatValue(t: TFunction, check: ScorecardCheck, unit: string | undefined): string {
  if (check.value === null) return '–'
  if (typeof check.value === 'boolean') {
    return check.value ? t('formats.panel.present') : t('formats.panel.absent')
  }
  return unit && unit !== 'count' ? `${check.value} ${unit}` : String(check.value)
}

/** Jump the playhead to a check's ranges, one after another on repeat clicks. */
function useRangeJumps() {
  const [next, setNext] = useState<Record<string, number>>({})
  const jump = (check: ScorecardCheck) => {
    const index = (next[check.key] ?? 0) % check.ranges.length
    const range = check.ranges[index]!
    const playback = usePlaybackStore.getState()
    playback.pause()
    playback.setCurrentFrame(range.startFrame)
    setNext((current) => ({ ...current, [check.key]: index + 1 }))
  }
  return { next, jump }
}

const CheckRow = memo(function CheckRow({
  check,
  unit,
  visits,
  onJump,
}: {
  check: ScorecardCheck
  unit: string | undefined
  visits: number | undefined
  onJump: (check: ScorecardCheck) => void
}) {
  const { t } = useTranslation()
  const style = STATUS_STYLE[check.status]
  const jumpable = check.ranges.length > 0
  const content = (
    <>
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="line-clamp-2 text-xs font-semibold text-foreground">
            {checkLabel(t, check)}
          </span>
          <span className={cn('shrink-0 font-mono text-[11px] font-semibold', style.text)}>
            {formatValue(t, check, unit)}
          </span>
        </span>
        <span className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="line-clamp-2 min-w-0">{check.detail}</span>
          <span className="shrink-0 font-mono">{check.target}</span>
        </span>
        {jumpable && (
          <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-primary-text">
            <Crosshair className="h-3 w-3" aria-hidden="true" />
            {visits
              ? t('formats.panel.jumpedTo', {
                  index: ((visits - 1) % check.ranges.length) + 1,
                  count: check.ranges.length,
                })
              : t('formats.panel.jump', { count: check.ranges.length })}
          </span>
        )}
      </span>
    </>
  )
  const className = 'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left'
  return jumpable ? (
    <button
      type="button"
      data-testid={`format-check-${check.key}`}
      data-status={check.status}
      onClick={() => onJump(check)}
      className={cn(className, 'transition-colors hover:bg-secondary')}
    >
      {content}
    </button>
  ) : (
    <div data-testid={`format-check-${check.key}`} data-status={check.status} className={className}>
      {content}
    </div>
  )
})

/** The scorecard's checks, worst first; checks with ranges jump the playhead. */
export function ScorecardList({ card, format }: { card: Scorecard; format: ResolvedFormat }) {
  const { next, jump } = useRangeJumps()
  const units = new Map(format.targets.map((target) => [target.key, target.unit]))
  const checks = [...card.checks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
  return (
    <div className="-mx-2 space-y-0.5">
      {checks.map((check) => (
        <CheckRow
          key={check.key}
          check={check}
          unit={units.get(check.key)}
          visits={next[check.key]}
          onJump={jump}
        />
      ))}
    </div>
  )
}
