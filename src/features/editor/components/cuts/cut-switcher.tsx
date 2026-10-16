import { memo, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Layers, Plus, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { CutSummary } from '@/infrastructure/storage'
import { useCutsStore, useCutsSync, type CutPublish } from '@/shared/state/cuts'
import { useFormatScorecardStore } from '@/shared/state/format-scorecard'
import { cn } from '@/shared/ui/cn'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { UnsavedChangesDialog } from '../unsaved-changes-dialog'
import { ManageCutsDialog } from './manage-cuts-dialog'
import { NewCutDialog } from './new-cut-dialog'

type Score = { pass: number; warn: number; fail: number } | null | undefined

const scoreTone = (summary: Score) =>
  !summary ? null : summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'pass'

const TONE_CLASS = {
  fail: 'bg-destructive',
  warn: 'bg-amber-500',
  pass: 'bg-emerald-500',
} as const

function ScoreDot({ summary }: { summary: Score }) {
  const { t } = useTranslation()
  const tone = scoreTone(summary)
  if (!tone) return null
  return (
    <span
      className={cn('h-2 w-2 shrink-0 rounded-full', TONE_CLASS[tone])}
      role="img"
      aria-label={t(`cuts.switcher.score.${tone}`)}
      title={t(`cuts.switcher.score.${tone}`)}
      data-testid={`cut-score-${tone}`}
    />
  )
}

/**
 * Follow the agent: when it publishes into another cut of the group, switch
 * to that cut through `switchTo` (which asks first when there are unsaved
 * edits; nothing is ever discarded silently).
 */
function useFollowPublishes(switchTo: (id: string) => void) {
  const { t } = useTranslation()
  const follow = useCutsStore((s) => s.follow)
  useEffect(() => {
    if (!follow) return
    useCutsStore.setState({ follow: null })
    toast.info(t('cuts.switcher.followed', { label: labelOf(follow) }))
    switchTo(follow.projectId)
    // switchTo is rebuilt every render; only a new publish matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow])
}

const labelOf = (publish: CutPublish) =>
  useCutsStore.getState().group?.cuts.find((cut) => cut.id === publish.projectId)?.label ?? ''

interface CutSwitcherProps {
  projectId: string
  canvas: { width: number; height: number }
  compact?: boolean
  onSave?: () => Promise<void>
}

/**
 * The cut switcher beside the format chip (docs/cuts.md). Alone, a quiet
 * "+ Cut"; in a group, the current cut's label with a menu of the cuts
 * (size, scorecard dot, "new pass"), New cut… and Manage cuts….
 */
export const CutSwitcher = memo(function CutSwitcher({
  projectId,
  canvas,
  compact = false,
  onSave,
}: CutSwitcherProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  useCutsSync(projectId)
  const group = useCutsStore((s) => (s.projectId === projectId ? s.group : null))
  const fresh = useCutsStore((s) => s.fresh)
  const liveScore = useFormatScorecardStore((s) => s.card?.summary)
  const [newOpen, setNewOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  const go = (id: string) => navigate({ to: '/editor/$projectId', params: { projectId: id } })
  const switchTo = (id: string) => {
    if (id === projectId) return
    if (useTimelineStore.getState().isDirty) setPending(id)
    else void go(id)
  }
  useFollowPublishes(switchTo)

  const newCut = (
    <NewCutDialog
      open={newOpen}
      onOpenChange={setNewOpen}
      projectId={projectId}
      canvas={canvas}
      onSave={onSave}
    />
  )

  if (!group || group.cuts.length < 2) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setNewOpen(true)}
          data-testid="cut-add"
          aria-label={t('cuts.switcher.addAria')}
          data-tooltip={t('cuts.switcher.addAria')}
          data-tooltip-side="bottom"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('cuts.switcher.add')}
        </Button>
        {newCut}
      </>
    )
  }

  const current = group.cuts.find((cut) => cut.id === projectId)
  const scoreOf = (cut: CutSummary) =>
    cut.id === projectId ? (liveScore ?? cut.lastPass?.summary) : cut.lastPass?.summary
  const pendingCut = group.cuts.find((cut) => cut.id === pending)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="cut-switcher"
            aria-label={t('cuts.switcher.open', { label: current?.label ?? '' })}
            className={cn(
              'relative flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 text-xs font-semibold transition-colors hover:bg-muted',
              compact ? 'max-w-[140px]' : 'max-w-[220px]',
            )}
          >
            <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{current?.label}</span>
            {!compact && (
              <span className="font-medium text-muted-foreground">
                {t('cuts.switcher.count', { count: group.cuts.length })}
              </span>
            )}
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            {fresh.length > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary"
                aria-label={t('cuts.switcher.freshAria')}
                data-testid="cut-fresh"
              />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">
            {t('cuts.switcher.title')}
          </DropdownMenuLabel>
          {group.cuts.map((cut) => (
            <DropdownMenuItem
              key={cut.id}
              className="gap-2"
              data-testid="cut-option"
              onSelect={() => switchTo(cut.id)}
            >
              <Check
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  cut.id === projectId ? 'opacity-100' : 'opacity-0',
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{cut.label}</span>
              {fresh.includes(cut.id) && (
                <span className="rounded-full bg-primary-soft px-1.5 text-[10px] font-semibold text-primary-text">
                  {t('cuts.switcher.newPass')}
                </span>
              )}
              <span className="font-mono text-[10px] text-muted-foreground">
                {cut.width}×{cut.height}
              </span>
              <ScoreDot summary={scoreOf(cut)} />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2" onSelect={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('cuts.switcher.newCut')}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onSelect={() => setManageOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('cuts.switcher.manage')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {newCut}
      <ManageCutsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        projectId={projectId}
        group={group}
      />
      {onSave && (
        <UnsavedChangesDialog
          open={pending !== null}
          onOpenChange={(open) => !open && setPending(null)}
          onSave={onSave}
          projectName={current?.label}
          onLeave={() => {
            if (pendingCut) void go(pendingCut.id)
            setPending(null)
          }}
        />
      )}
    </>
  )
})
