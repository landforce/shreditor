import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'

const timelineState = vi.hoisted(() => ({ updateItem: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  } & React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...props}
    />
  ),
}))

vi.mock('@/components/ui/select', () => {
  const SelectContext = React.createContext<(value: string) => void>(() => {})
  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode
      onValueChange: (value: string) => void
    }) => <SelectContext.Provider value={onValueChange}>{children}</SelectContext.Provider>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const onValueChange = React.useContext(SelectContext)
      return (
        <button type="button" onClick={() => onValueChange(value)}>
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: () => null,
  }
})

vi.mock('../components', () => ({
  PropertySection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  PropertyRow: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  SliderInput: ({ onChange, unit }: { onChange: (value: number) => void; unit: string }) => (
    <button type="button" data-unit={unit} onClick={() => onChange(-20)}>
      slider
    </button>
  ),
}))

vi.mock('@/features/editor/deps/timeline-store', () => ({
  useTimelineStore: (selector: (state: typeof timelineState) => unknown) => selector(timelineState),
}))

import { AudioDynamicsSection } from './audio-dynamics-section'

const audioItem = (fields: Record<string, unknown> = {}) =>
  ({
    id: 'a1',
    type: 'audio',
    trackId: 't',
    from: 0,
    durationInFrames: 30,
    label: 'a1',
    src: 'x',
    ...fields,
  }) as unknown as TimelineItem

describe('AudioDynamicsSection', () => {
  beforeEach(() => timelineState.updateItem.mockClear())

  it('keeps every stage off until switched on, then enables only that stage', () => {
    render(<AudioDynamicsSection items={[audioItem()]} />)
    expect(screen.queryAllByText('slider')).toHaveLength(0)
    fireEvent.click(screen.getByLabelText('editor.audioSection.compressor'))
    expect(timelineState.updateItem).toHaveBeenCalledWith('a1', {
      audioCompressor: { enabled: true },
    })
  })

  it('edits one setting and keeps the rest of the stage', () => {
    render(
      <AudioDynamicsSection
        items={[audioItem({ audioCompressor: { enabled: true, ratio: 2 } })]}
      />,
    )
    // The compressor's first slider is its threshold.
    fireEvent.click(screen.getAllByText('slider')[0]!)
    expect(timelineState.updateItem).toHaveBeenCalledWith('a1', {
      audioCompressor: { enabled: true, ratio: 2, thresholdDb: -20 },
    })
  })

  it('applies the plosive preset as an EQ high-pass patch', () => {
    render(<AudioDynamicsSection items={[audioItem()]} />)
    fireEvent.click(screen.getByText('editor.audioSection.presetPlosiveRumble'))
    expect(timelineState.updateItem).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        audioEqBand1Enabled: true,
        audioEqBand1Type: 'high-pass',
        audioEqBand1FrequencyHz: 90,
        audioEqBand1SlopeDbPerOct: 18,
      }),
    )
  })
})
