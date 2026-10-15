import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useCompositionNavigationStore } from '@/features/editor/deps/timeline-store'
import { useFormatPanelStore } from '../../stores/format-panel-store'
import { FormatChip } from './format-chip'
import { ProjectSpecsDrawer } from './project-specs-drawer'

vi.mock('./format-panel', () => ({
  FormatPanel: () => <div>Format Panel</div>,
}))
vi.mock('../properties-sidebar/canvas-panel', () => ({
  CanvasPanel: () => <div>Canvas Panel</div>,
}))
vi.mock('./notes-tab', () => ({
  NotesTab: () => <div>Notes Tab</div>,
}))
vi.mock('./style-tab', () => ({
  StyleTab: () => <div>Style Tab</div>,
}))
vi.mock('./project-format', () => ({
  useResolvedProjectFormat: () => ({ id: 'ten-shot', name: '10 Shot', variant: 'even' }),
}))

describe('Project specs', () => {
  beforeEach(() => {
    useFormatPanelStore.setState({ specsOpen: false, tab: 'canvas' })
    useCompositionNavigationStore.setState({ activeCompositionId: null })
  })

  it('opens from the format chip on the format, with the canvas one tab away', () => {
    render(
      <>
        <FormatChip />
        <ProjectSpecsDrawer />
      </>,
    )
    expect(screen.queryByTestId('project-specs-drawer')).toBeNull()
    fireEvent.click(screen.getByTestId('format-chip'))
    expect(screen.getByTestId('project-specs-drawer')).toBeInTheDocument()
    expect(screen.getByText('Format Panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Style' }))
    expect(screen.getByText('Style Tab')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }))
    expect(screen.getByText('Canvas Panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(screen.getByText('Notes Tab')).toBeInTheDocument()
  })

  it('shows only the canvas inside a composition', () => {
    useCompositionNavigationStore.setState({ activeCompositionId: 'comp-1' })
    useFormatPanelStore.setState({ specsOpen: true, tab: 'format' })
    render(<ProjectSpecsDrawer />)
    expect(screen.getByText('Canvas Panel')).toBeInTheDocument()
    expect(screen.queryByText('Format Panel')).toBeNull()
  })
})
