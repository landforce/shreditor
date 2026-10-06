import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Scorecard } from '@formats/scorecard.mjs'
import { checkLabel } from '@/shared/formats/format-text'
import { useFormatScorecardStore } from '@/shared/state/format-scorecard'
import { useTimelineCommittedZoomContext } from '../contexts/timeline-zoom-context'

interface FailBand {
  startFrame: number
  endFrame: number
  labels: string[]
}

/** The failing checks' ranges, overlapping ones merged, each with the checks it fails. */
function failBands(card: Scorecard, t: TFunction): FailBand[] {
  const spans = card.checks
    .filter((check) => check.status === 'fail')
    .flatMap((check) =>
      check.ranges.map((range) => ({
        ...range,
        label: `${checkLabel(t, check)}: ${check.detail}`,
      })),
    )
    .sort((a, b) => a.startFrame - b.startFrame)
  const bands: FailBand[] = []
  for (const span of spans) {
    const last = bands[bands.length - 1]
    // Overlapping ranges merge; touching ones (back-to-back stretches) stay apart.
    if (last && span.startFrame < last.endFrame) {
      last.endFrame = Math.max(last.endFrame, span.endFrame)
      if (!last.labels.includes(span.label)) last.labels.push(span.label)
    } else {
      bands.push({ startFrame: span.startFrame, endFrame: span.endFrame, labels: [span.label] })
    }
  }
  return bands
}

/**
 * Marks where the timeline fails its format (fail-severity checks, e.g. "no
 * new image for 6 s") on the ruler, below the in/out lane. Toggled from the
 * format panel.
 */
export const TimelineFormatRanges = memo(function TimelineFormatRanges({ top }: { top: number }) {
  const { t } = useTranslation()
  const card = useFormatScorecardStore((s) => s.card)
  const show = useFormatScorecardStore((s) => s.showTimelineRanges)
  const { frameToPixels } = useTimelineCommittedZoomContext()
  const bands = useMemo(() => (card && show ? failBands(card, t) : []), [card, show, t])
  if (bands.length === 0) return null

  return (
    <>
      {bands.map((band) => {
        const left = frameToPixels(band.startFrame)
        const width = Math.max(2, frameToPixels(band.endFrame) - left)
        return (
          <div
            key={`${band.startFrame}-${band.endFrame}`}
            data-testid="timeline-format-range"
            className="absolute bottom-0 bg-destructive/10 pointer-events-none"
            style={{ left, width, top, zIndex: 7 }}
          >
            <div
              className="absolute inset-x-0 bottom-0 h-[3px] bg-destructive/70 pointer-events-auto"
              title={band.labels.join('\n')}
            />
          </div>
        )
      })}
    </>
  )
})
