import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TextItem, VideoItem } from '@/types/timeline'

const bridge = vi.hoisted(() => ({
  readMotionClip: vi.fn(),
  rerenderMotionClip: vi.fn(),
  saveOpenEditorNow: vi.fn(async () => true),
}))
vi.mock('@/infrastructure/storage/bridge-fs/bridge-agent-commands', () => bridge)

const { useProjectStore } = await import('@/features/editor/deps/projects')
const { useItemsStore } = await import('@/features/editor/deps/timeline-store')
const { useSelectionStore } = await import('@/shared/state/selection')
const { MotionGraphicSection } = await import('./motion-graphic-section')

const clip = {
  id: 'clip-1',
  trackId: 'motion',
  type: 'video',
  label: 'Motion: hole-title',
  mediaId: 'm1',
  src: '',
  from: 0,
  durationInFrames: 60,
} as VideoItem

describe('MotionGraphicSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ currentProject: { id: 'p1' } } as never)
    bridge.readMotionClip.mockResolvedValue({
      clipId: 'clip-1',
      folder: '/w/motion/hole-title',
      source: '/w/motion/hole-title',
      variables: [
        { id: 'title', type: 'string', label: 'Title' },
        { id: 'accent', type: 'color', label: 'Accent' },
      ],
      values: { title: 'Hole 1', accent: '#f59e0b' },
    })
  })

  it('shows nothing for a clip shred motion did not place', () => {
    const text = {
      id: 't',
      type: 'text',
      label: 'Two',
      trackId: 'v1',
      from: 0,
      durationInFrames: 30,
    } as TextItem
    const { container } = render(<MotionGraphicSection items={[text]} />)
    expect(container).toBeEmptyDOMElement()
    expect(bridge.readMotionClip).not.toHaveBeenCalled()
  })

  it('re-renders with only the changed values, after saving, and selects the new clip', async () => {
    bridge.rerenderMotionClip.mockResolvedValue('clip-2')
    render(<MotionGraphicSection items={[clip]} />)
    const title = await screen.findByLabelText('Title')
    expect(title).toHaveValue('Hole 1')
    const update = screen.getByRole('button', { name: 'Update graphic' })
    expect(update).toBeDisabled()
    fireEvent.change(title, { target: { value: 'Hole 2' } })
    useItemsStore.setState({ itemById: { 'clip-2': { ...clip, id: 'clip-2' } } } as never)
    fireEvent.click(update)
    await waitFor(() =>
      expect(bridge.rerenderMotionClip).toHaveBeenCalledWith('p1', 'clip-1', { title: 'Hole 2' }),
    )
    expect(bridge.saveOpenEditorNow).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(useSelectionStore.getState().selectedItemIds).toEqual(['clip-2']))
  })

  it('shows why a render failed', async () => {
    bridge.rerenderMotionClip.mockRejectedValue(new Error('Variable "titel" is not declared'))
    render(<MotionGraphicSection items={[clip]} />)
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update graphic' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not declared')
  })
})
