import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Brush, Eraser, Sparkles, Trash2, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/shared/ui/cn'
import type { VideoItem } from '@/types/timeline'
import type { CutoutStrokeTool } from '@/types/cutout'
import {
  getCutoutPaint,
  setCutoutPaint,
  subscribeCutoutPaint,
} from '@/infrastructure/cutout/cutout-paint'
import {
  getCutoutRegionJobs,
  subscribeCutoutRegionJobs,
} from '@/infrastructure/cutout/cutout-regions'
import { clearClipCutoutStrokes } from '@/features/editor/hooks/use-cutout-status'
import { PropertyRow, SliderInput } from '../components'

const TOOLS: Array<{ tool: CutoutStrokeTool; icon: typeof Brush }> = [
  { tool: 'smartBrush', icon: WandSparkles },
  { tool: 'smartEraser', icon: Sparkles },
  { tool: 'brush', icon: Brush },
  { tool: 'eraser', icon: Eraser },
]
const RUNNING = new Set(['queued', 'downloading', 'tracking'])

/** Smart-stroke tracking for one media: samples tracked / at most, while any runs. */
function useTracking(mediaId: string | undefined) {
  const jobs = useSyncExternalStore(subscribeCutoutRegionJobs, getCutoutRegionJobs)
  const mine = jobs.filter((job) => job.mediaId === mediaId)
  const running = mine.filter((job) => RUNNING.has(job.state))
  const failed = mine.find((job) => job.state === 'error')
  const done = running.reduce((sum, job) => sum + job.done, 0)
  const count = running.reduce((sum, job) => sum + job.count, 0)
  return { running: running.length > 0, done, count, error: failed?.error }
}

function ToolButtons({ active }: { active: CutoutStrokeTool }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-1" role="group" aria-label={t('editor.cutout.paint.tool')}>
      {TOOLS.map(({ tool, icon: Icon }) => (
        <Button
          key={tool}
          variant="outline"
          size="sm"
          aria-pressed={tool === active}
          data-testid={`cutout-tool-${tool}`}
          className={cn(
            'h-7 gap-1 px-2 text-xs',
            tool === active && 'border-primary bg-primary/10',
          )}
          onClick={() => setCutoutPaint({ tool })}
        >
          <Icon className="h-3 w-3" />
          {t(`editor.cutout.paint.tools.${tool}`)}
        </Button>
      ))}
    </div>
  )
}

/**
 * Fix the mask by painting (Full view's Remove background section): the
 * Painting toggle, the four tools, brush size, how many strokes the clip has
 * and Clear, and the smart strokes' tracking progress.
 */
export function CutoutBrushControls({ item }: { item: VideoItem }) {
  const { t } = useTranslation()
  const paint = useSyncExternalStore(subscribeCutoutPaint, getCutoutPaint)
  const tracking = useTracking(item.mediaId)
  const painting = paint.itemId === item.id
  const strokes = item.cutout?.strokes?.length ?? 0

  // Leaving the clip (another selection, the section closing) stops painting it.
  useEffect(
    () => () => {
      if (getCutoutPaint().itemId === item.id) setCutoutPaint({ itemId: null })
    },
    [item.id],
  )

  return (
    <div className="space-y-2 border-t border-border pt-2" data-testid="cutout-brush">
      <PropertyRow
        label={t('editor.cutout.paint.painting')}
        tooltip={t('editor.cutout.paint.paintingHint')}
      >
        <Switch
          checked={painting}
          onCheckedChange={(checked) => setCutoutPaint({ itemId: checked ? item.id : null })}
          aria-label={t('editor.cutout.paint.painting')}
          data-testid="cutout-painting"
        />
      </PropertyRow>
      <ToolButtons active={paint.tool} />
      <PropertyRow label={t('editor.cutout.paint.size')}>
        <SliderInput
          value={Math.round(paint.size * 100)}
          onChange={(next) => setCutoutPaint({ size: Math.max(1, next) / 100 })}
          onLiveChange={(next) => setCutoutPaint({ size: Math.max(1, next) / 100 })}
          min={1}
          max={25}
          step={1}
          unit="%"
          className="flex-1 min-w-0"
        />
      </PropertyRow>
      <p className="text-[11px] text-muted-foreground">{t('editor.cutout.paint.hint')}</p>
      {tracking.running && (
        <div className="space-y-1">
          <Progress value={(tracking.done / Math.max(1, tracking.count)) * 100} className="h-1" />
          <p className="text-xs text-muted-foreground tabular-nums">
            {t('editor.cutout.paint.tracking', tracking)}
          </p>
        </div>
      )}
      {tracking.error && (
        <p className="text-xs text-destructive">
          {t('editor.cutout.status.error', { error: tracking.error })}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('editor.cutout.paint.strokes', { count: strokes })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled={strokes === 0}
          onClick={() => clearClipCutoutStrokes([item])}
        >
          <Trash2 className="h-3 w-3" />
          {t('editor.cutout.paint.clear')}
        </Button>
      </div>
    </div>
  )
}
