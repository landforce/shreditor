import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ReactNode } from 'react'
import type { CompositionItem, VideoItem } from '@/types/timeline'
import { useKeyframesStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { speedRampPreset } from '@/shared/timeline/speed-ramp.mjs'
import { VideoSection } from './video-section'

const keyframeToggleSpy = vi.hoisted(() => vi.fn())
const applySpeedRampChoiceSpy = vi.hoisted(() => vi.fn())

vi.mock('./speed-ramp-choices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./speed-ramp-choices')>()
  return { ...actual, applySpeedRampChoice: applySpeedRampChoiceSpy }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/features/editor/deps/preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/editor/deps/preview')>()
  return { ...actual, useThrottledFrame: () => 0 }
})

vi.mock('@/features/editor/deps/keyframes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/editor/deps/keyframes')>()
  return {
    ...actual,
    KeyframeToggle: (props: unknown) => {
      keyframeToggleSpy(props)
      return null
    },
  }
})

vi.mock('../components', () => ({
  PropertySection: ({ children }: { children: ReactNode }) => <>{children}</>,
  PropertyRow: ({ label, children }: { label: string; children: ReactNode }) => (
    <div data-testid={`property-row-${label}`}>{children}</div>
  ),
  SliderInput: ({ max, disabled }: { max: number; disabled?: boolean }) => (
    <output data-testid="slider-input" data-max={max} data-disabled={disabled ? 'true' : 'false'} />
  ),
}))

const VIDEO_ITEM: VideoItem = {
  id: 'video-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'video.mp4',
  src: 'blob:video',
  mediaId: 'media-1',
  sourceWidth: 1920,
  sourceHeight: 1080,
}

const COMPOSITION_ITEM: CompositionItem = {
  id: 'composition-1',
  type: 'composition',
  trackId: 'track-2',
  from: 0,
  durationInFrames: 90,
  label: 'Compound clip',
  compositionId: 'nested-1',
  compositionWidth: 3840,
  compositionHeight: 2160,
}

function getCropSliderMax(property: 'cropLeft' | 'cropRight' | 'cropTop' | 'cropBottom'): number {
  const row = screen.getByTestId(`property-row-editor.videoSection.${property}`)
  return Number(within(row).getByTestId('slider-input').getAttribute('data-max'))
}

describe('VideoSection crop controls', () => {
  beforeEach(() => {
    keyframeToggleSpy.mockClear()
    useTimelineStore.setState({ items: [VIDEO_ITEM, COMPOSITION_ITEM], fps: 30 })
    useKeyframesStore.setState({ keyframesByItemId: {} })
  })

  it('caps mixed-selection crop ranges at the smallest selected source dimensions', () => {
    render(<VideoSection items={[VIDEO_ITEM, COMPOSITION_ITEM]} />)

    expect(getCropSliderMax('cropLeft')).toBe(1920)
    expect(getCropSliderMax('cropRight')).toBe(1920)
    expect(getCropSliderMax('cropTop')).toBe(1080)
    expect(getCropSliderMax('cropBottom')).toBe(1080)
  })

  it('passes each selected item crop value to the multi-item keyframe toggle', () => {
    const video = { ...VIDEO_ITEM, crop: { left: 0.25 } }
    const composition = { ...COMPOSITION_ITEM, crop: { left: 0.25 } }

    render(<VideoSection items={[video, composition]} />)

    const cropLeftProps = keyframeToggleSpy.mock.calls
      .map(
        ([props]) => props as { property: string; currentValuesByItemId: Record<string, number> },
      )
      .find((props) => props.property === 'cropLeft')
    expect(cropLeftProps?.currentValuesByItemId).toEqual({
      [video.id]: 480,
      [composition.id]: 960,
    })
  })
})

describe('VideoSection speed ramp controls', () => {
  beforeEach(() => {
    applySpeedRampChoiceSpy.mockClear()
    useKeyframesStore.setState({ keyframesByItemId: {} })
  })

  function speedSlider(): HTMLElement {
    const row = screen.getByTestId('property-row-editor.videoSection.speed')
    return within(row).getByTestId('slider-input')
  }

  it('offers the ramp presets on a constant-speed clip and keeps the speed slider live', () => {
    useTimelineStore.setState({ items: [VIDEO_ITEM], fps: 30 })
    render(<VideoSection items={[VIDEO_ITEM]} />)

    expect(speedSlider().getAttribute('data-disabled')).toBe('false')
    expect(screen.queryByTestId('speed-ramp-range')).toBeNull()
    const none = screen.getByRole('button', { name: 'editor.speedRamp.none' })
    expect(none.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'editor.speedRamp.hero' }))
    expect(applySpeedRampChoiceSpy).toHaveBeenCalledWith([VIDEO_ITEM.id], 'hero')
  })

  it('shows the ramp, disables constant speed and resets the ramp', () => {
    const ramped: VideoItem = {
      ...VIDEO_ITEM,
      speedRamp: speedRampPreset('hero', { durationInFrames: VIDEO_ITEM.durationInFrames }),
    }
    useTimelineStore.setState({ items: [ramped], fps: 30 })
    render(<VideoSection items={[ramped]} />)

    expect(speedSlider().getAttribute('data-disabled')).toBe('true')
    expect(screen.getByTestId('speed-ramp-range')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'editor.speedRamp.hero' }).getAttribute('aria-pressed'),
    ).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'editor.speedRamp.reset' }))
    expect(applySpeedRampChoiceSpy).toHaveBeenCalledWith([ramped.id], 'none')
  })
})
