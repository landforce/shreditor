import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { useTimelineCommittedZoomContext } from '../contexts/timeline-zoom-context'
import { useTimelineBeats } from '../hooks/use-timeline-beats'

/** Closest two drawn beats may sit; denser grids are thinned to every Nth beat. */
const MIN_BEAT_SPACING_PX = 5
const RULER_TICK_PX = 6
const RULER_DOWNBEAT_TICK_PX = 10

interface TimelineBeatGridProps {
  /** `ruler`: ticks along the ruler and the tempo label. `tracks`: faint lines down the lanes. */
  variant: 'ruler' | 'tracks'
}

/**
 * The music's beat as thin vertical ticks. Shown when the "Show beat grid"
 * setting is on (it is by default; Concise's More menu and Settings toggle it). Downbeats are stronger.
 */
export const TimelineBeatGrid = memo(function TimelineBeatGrid({ variant }: TimelineBeatGridProps) {
  const { t } = useTranslation()
  const visible = useSettingsStore((s) => s.showBeatGrid)
  const { bpm, beatFrames, downbeatFrames, status } = useTimelineBeats({ enabled: visible })
  const { frameToPixels } = useTimelineCommittedZoomContext()

  const ticks = useMemo(() => {
    if (!visible || status !== 'ready' || beatFrames.length === 0) return []
    const downbeats = new Set(downbeatFrames)
    const spacing = frameToPixels(beatFrames[1] ?? 0) - frameToPixels(beatFrames[0] ?? 0)
    const stride = spacing > 0 ? Math.max(1, Math.ceil(MIN_BEAT_SPACING_PX / spacing)) : 1
    const result: Array<{ left: number; strong: boolean }> = []
    for (let i = 0; i < beatFrames.length; i += stride) {
      const frame = beatFrames[i]!
      result.push({ left: frameToPixels(frame), strong: downbeats.has(frame) })
    }
    return result
  }, [visible, status, beatFrames, downbeatFrames, frameToPixels])

  if (!visible || status !== 'ready') return null

  if (variant === 'tracks') {
    return (
      <div
        data-testid="timeline-beat-grid-tracks"
        className="absolute inset-0 pointer-events-none"
        aria-hidden
      >
        {ticks.map((tick) => (
          <div
            key={tick.left}
            className="absolute top-0 bottom-0 w-px bg-foreground"
            style={{ left: `${tick.left}px`, opacity: tick.strong ? 0.12 : 0.05 }}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      data-testid="timeline-beat-grid-ruler"
      className="absolute inset-0 pointer-events-none"
      aria-hidden
    >
      {ticks.map((tick) => (
        <div
          key={tick.left}
          className="absolute bottom-0 w-px bg-foreground"
          style={{
            left: `${tick.left}px`,
            height: tick.strong ? RULER_DOWNBEAT_TICK_PX : RULER_TICK_PX,
            opacity: tick.strong ? 0.6 : 0.3,
          }}
        />
      ))}
      {bpm ? (
        <span
          data-testid="timeline-beat-grid-bpm"
          className="sticky left-1 top-0.5 z-10 inline-block w-max rounded-sm bg-background/80 px-1 text-[9px] leading-3 tabular-nums text-muted-foreground"
        >
          {t('timeline.concise.bpm', { bpm: Math.round(bpm) })}
        </span>
      ) : null}
    </div>
  )
})
