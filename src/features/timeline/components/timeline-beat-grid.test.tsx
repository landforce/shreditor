import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const beats = vi.hoisted(() => ({
  value: {
    status: 'ready' as 'ready' | 'pending',
    bpm: 128 as number | null,
    beatFrames: [0, 30, 60, 90, 120],
    downbeatFrames: [0, 120],
    itemId: 'a1' as string | null,
  },
}))
const settings = vi.hoisted(() => ({ showBeatGrid: true }))

vi.mock('../hooks/use-timeline-beats', () => ({ useTimelineBeats: () => beats.value }))
vi.mock('../contexts/timeline-zoom-context', () => ({
  // 30 fps, 100 px per second
  useTimelineCommittedZoomContext: () => ({ frameToPixels: (frame: number) => (frame / 30) * 100 }),
}))
vi.mock('@/features/timeline/deps/settings', () => ({
  useSettingsStore: (selector: (state: typeof settings) => unknown) => selector(settings),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { bpm?: number }) => (values?.bpm ? `${values.bpm} BPM` : key),
  }),
}))

import { TimelineBeatGrid } from './timeline-beat-grid'

describe('TimelineBeatGrid', () => {
  beforeEach(() => {
    settings.showBeatGrid = true
    beats.value = { ...beats.value, status: 'ready', bpm: 128 }
  })

  it('draws a tick per beat on the ruler, downbeats taller, with the tempo', () => {
    const { container } = render(<TimelineBeatGrid variant="ruler" />)
    const ticks = container.querySelectorAll<HTMLElement>(
      '[data-testid="timeline-beat-grid-ruler"] > div',
    )
    expect(ticks).toHaveLength(5)
    expect(ticks[1]!.style.left).toBe('100px')
    expect(ticks[0]!.style.height).toBe('10px')
    expect(ticks[1]!.style.height).toBe('6px')
    expect(screen.getByTestId('timeline-beat-grid-bpm').textContent).toBe('128 BPM')
  })

  it('draws faint lanes lines without the tempo label', () => {
    const { container } = render(<TimelineBeatGrid variant="tracks" />)
    expect(
      container.querySelectorAll('[data-testid="timeline-beat-grid-tracks"] > div'),
    ).toHaveLength(5)
    expect(screen.queryByTestId('timeline-beat-grid-bpm')).toBeNull()
  })

  it('renders nothing when the setting is off or the analysis is not ready', () => {
    settings.showBeatGrid = false
    const { container, rerender } = render(<TimelineBeatGrid variant="ruler" />)
    expect(container.firstChild).toBeNull()
    settings.showBeatGrid = true
    beats.value = { ...beats.value, status: 'pending' }
    rerender(<TimelineBeatGrid variant="ruler" />)
    expect(container.firstChild).toBeNull()
  })

  it('thins a dense grid so ticks stay apart', () => {
    beats.value = {
      ...beats.value,
      beatFrames: Array.from({ length: 100 }, (_, i) => i * 0.9),
      downbeatFrames: [],
    }
    const { container } = render(<TimelineBeatGrid variant="ruler" />)
    expect(
      container.querySelectorAll('[data-testid="timeline-beat-grid-ruler"] > div').length,
    ).toBeLessThan(60)
  })
})
