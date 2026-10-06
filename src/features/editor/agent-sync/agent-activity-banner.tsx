import { memo, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import {
  receiveAgentActivity,
  sendAgentActivityAction,
  useAgentActivityStore,
} from './agent-activity-store'
import { useAgentWatchMode } from './use-agent-watch-mode'

/** m:ss, or h:mm:ss past an hour. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function Elapsed({ since }: { since: string | undefined }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const start = since ? Date.parse(since) : NaN
  if (Number.isNaN(start)) return null
  return <span className="tabular-nums text-muted-foreground">{formatElapsed(now - start)}</span>
}

function Bar({ tone, children }: { tone: 'working' | 'ready'; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="agent-activity-banner"
      className={cn(
        'flex items-center gap-3 border-b px-4 py-2 text-sm',
        tone === 'ready'
          ? 'border-emerald-500/40 bg-emerald-500/10'
          : 'border-primary/40 bg-primary/10',
      )}
    >
      {children}
    </div>
  )
}

function WorkingBar({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const activity = useAgentActivityStore((s) => s.activity)
  const [busy, setBusy] = useState(false)
  const act = async (action: 'release' | 'cancel') => {
    setBusy(true)
    try {
      await sendAgentActivityAction(projectId, action)
    } catch {
      toast.error(t('editor.agentActivity.actionFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Bar tone="working">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">
          {activity.label
            ? t('editor.agentActivity.working', { label: activity.label })
            : t('editor.agentActivity.workingNoLabel')}
        </span>{' '}
        <Elapsed since={activity.startedAt} />
        <span className="block text-xs text-muted-foreground">
          {t('editor.agentActivity.watchMode')}
        </span>
      </span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act('release')}>
        {t('editor.agentActivity.editAnyway')}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
        {t('editor.agentActivity.stop')}
      </Button>
    </Bar>
  )
}

/**
 * Top of the editor while an agent is mid-pass on this project ("Agent is
 * working on a pass: <label>", elapsed time, Edit anyway / Stop the agent),
 * while a stop is on its way to the agent, and briefly when the pass lands.
 * Working puts the editor in watch mode (see use-agent-watch-mode.ts).
 */
export const AgentActivityBanner = memo(function AgentActivityBanner({
  projectId,
}: {
  projectId: string
}) {
  const { t } = useTranslation()
  const state = useAgentActivityStore((s) => s.activity.state)
  const passReady = useAgentActivityStore((s) => s.passReady)
  useAgentWatchMode()
  // Another project's pass never carries over.
  useEffect(() => () => receiveAgentActivity(null), [projectId])

  if (state === 'working') return <WorkingBar projectId={projectId} />
  if (state === 'cancelled') {
    return (
      <Bar tone="working">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
        <span className="flex-1">{t('editor.agentActivity.stopping')}</span>
      </Bar>
    )
  }
  if (passReady) {
    return (
      <Bar tone="ready">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
        <span className="flex-1 font-medium">
          {passReady.label
            ? t('editor.agentActivity.passReady', { label: passReady.label })
            : t('editor.agentActivity.passReadyNoLabel')}
        </span>
      </Bar>
    )
  }
  return null
})
