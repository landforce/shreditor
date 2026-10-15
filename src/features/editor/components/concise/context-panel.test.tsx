import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useItemsStore, useTimelineCommandStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import type { TextItem, VideoItem } from '@/types/timeline'
import { ConciseContextPanel } from './context-panel'

vi.mock('../properties-sidebar', () => ({
  PropertiesSidebar: () => <div>Properties Sidebar</div>,
}))
vi.mock('../properties-sidebar/clip-panel/text-section', () => ({
  TextContentSection: () => <div>Text Content</div>,
}))
vi.mock('../properties-sidebar/clip-panel/text-styles-section', () => ({
  TextStylesSection: () => <div>Text Styles</div>,
}))
vi.mock('../format-panel/change-format-dialog', () => ({
  ChangeFormatDialog: () => null,
}))
vi.mock('@/infrastructure/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infrastructure/storage')>()),
  readAgentNotes: vi.fn(async () => ({ version: 1, notes: [] })),
  writeAgentNotes: vi.fn(async () => undefined),
}))

const VIDEO: VideoItem = {
  id: 'v1',
  type: 'video',
  trackId: 't1',
  from: 0,
  durationInFrames: 90,
  label: 'beach.mp4',
  src: 'blob:v1',
}
const VIDEO_2: VideoItem = { ...VIDEO, id: 'v2', from: 90, label: 'pool.mp4', src: 'blob:v2' }
const TEXT: TextItem = {
  id: 'x1',
  type: 'text',
  trackId: 't2',
  from: 0,
  durationInFrames: 60,
  label: 'Hook',
  text: 'Hello',
  color: '#fff',
} as TextItem

function select(ids: string[]) {
  useSelectionStore.setState({
    selectedItemIds: ids,
    selectedMarkerId: null,
    selectedTransitionId: null,
    selectionType: ids.length > 0 ? 'item' : null,
  })
}

describe('ConciseContextPanel', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([VIDEO, VIDEO_2, TEXT])
    useTimelineCommandStore.setState({ undoStack: [] })
    select([])
  })

  it('shows nothing with nothing selected, or a hint where the panel has its own room', () => {
    const { container, unmount } = render(<ConciseContextPanel />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    render(<ConciseContextPanel hintWhenEmpty />)
    expect(screen.getByTestId('concise-nothing-selected')).toBeInTheDocument()
  })

  it('shows the Shot card for a video item, numbered on its track', () => {
    select(['v2'])
    render(<ConciseContextPanel />)
    expect(screen.getByTestId('concise-shot-card')).toBeInTheDocument()
    expect(screen.getByText('Shot 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('pool.mp4')).toBeInTheDocument()
  })

  it('shows the Text card for a text item', () => {
    select(['x1'])
    render(<ConciseContextPanel />)
    expect(screen.getByTestId('concise-text-card')).toBeInTheDocument()
    expect(screen.getByText('Text Content')).toBeInTheDocument()
  })

  it('opens the full properties sidebar from More', () => {
    select(['v1'])
    render(<ConciseContextPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByTestId('concise-more-drawer')).toBeInTheDocument()
    expect(screen.getByText('Properties Sidebar')).toBeInTheDocument()
  })

  it('falls back to the properties sidebar for other selections', () => {
    useSelectionStore.setState({ selectedMarkerId: 'm1', selectedItemIds: [] })
    render(<ConciseContextPanel />)
    expect(screen.getByText('Properties Sidebar')).toBeInTheDocument()
  })

  it('gives a shot a ramp preset from the Speed field, shows it and clears it', () => {
    select(['v1'])
    render(<ConciseContextPanel />)
    const ramps = screen.getByTestId('concise-shot-speed-ramp')
    const hero = within(ramps).getByRole('button', { name: 'Hero slow-mo' })
    expect(within(ramps).getByRole('button', { name: 'None' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(hero)
    const item = useItemsStore.getState().itemById.v1
    expect(item?.speedRamp?.length).toBeGreaterThan(0)
    expect(within(ramps).getByRole('button', { name: 'Hero slow-mo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('concise-shot-speed-ramp-readout')).toHaveTextContent(
      'Speed ramp: 0.3x–2x',
    )
    expect(screen.getByRole('button', { name: '1x' })).toBeDisabled()

    fireEvent.click(within(ramps).getByRole('button', { name: 'None' }))
    expect(useItemsStore.getState().itemById.v1?.speedRamp).toBeUndefined()
    expect(screen.queryByTestId('concise-shot-speed-ramp-readout')).toBeNull()
  })
})
