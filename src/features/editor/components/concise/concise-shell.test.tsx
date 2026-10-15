import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const mocks = vi.hoisted(() => ({
  resizeCallbacks: [] as Array<(entries: unknown[]) => void>,
  editorState: {
    leftSidebarOpen: true,
    activeTab: 'media',
    sidebarWidth: 320,
    setLeftSidebarOpen: vi.fn(),
  },
}))

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}))
vi.mock('@/app/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/shared/state/editor', () => ({
  useEditorStore: (selector: (state: typeof mocks.editorState) => unknown) =>
    selector(mocks.editorState),
}))
vi.mock('@/features/editor/deps/timeline-ui', () => ({
  importTimeline: vi.fn().mockResolvedValue({ Timeline: () => <div data-testid="timeline" /> }),
}))
vi.mock('../preview-area', () => ({
  PreviewArea: ({ chrome, compact }: { chrome?: string; compact?: boolean }) => (
    <div data-testid="preview-area" data-chrome={chrome} data-compact={String(compact)} />
  ),
}))
vi.mock('../media-sidebar', () => ({
  MediaSidebar: () => <div data-testid="media-sidebar" />,
}))
vi.mock('./context-panel', () => ({
  ConciseContextPanel: () => <div data-testid="context-panel" />,
}))
vi.mock('./media-bin', () => ({
  ConciseMediaBin: ({ layout }: { layout: string }) => <div data-testid={`media-bin-${layout}`} />,
}))

import { ConciseShell } from './concise-shell'

const project = { width: 1080, height: 1920, fps: 30 }

function setWidth(width: number) {
  act(() => {
    for (const callback of mocks.resizeCallbacks) {
      callback([{ contentRect: { width, height: 880 } }])
    }
  })
}

describe('ConciseShell', () => {
  beforeEach(() => {
    mocks.resizeCallbacks.length = 0
    mocks.editorState.leftSidebarOpen = true
    mocks.editorState.activeTab = 'media'
    mocks.editorState.setLeftSidebarOpen.mockClear()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (entries: unknown[]) => void) {
          mocks.resizeCallbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the strip only when narrow', async () => {
    render(<ConciseShell project={project} />)
    setWidth(740)

    expect(screen.getByTestId('media-bin-strip')).toBeInTheDocument()
    expect(screen.queryByTestId('media-bin-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-area')).toHaveAttribute('data-compact', 'true')
    expect(screen.getByTestId('preview-area')).toHaveAttribute('data-chrome', 'concise')
    expect(await screen.findByTestId('context-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('timeline')).toBeInTheDocument()
  })

  it('renders the panel bin only when wide', () => {
    render(<ConciseShell project={project} />)
    setWidth(1600)

    expect(screen.getByTestId('media-bin-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('media-bin-strip')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-area')).toHaveAttribute('data-compact', 'false')
  })

  it('closes the full media sidebar on mount (the bin replaces it)', () => {
    render(<ConciseShell project={project} />)

    expect(mocks.editorState.setLeftSidebarOpen).toHaveBeenCalledWith(false)
  })

  it('shows the media sidebar drawer only for a non-media tab', () => {
    const { unmount } = render(<ConciseShell project={project} />)
    expect(screen.queryByTestId('media-sidebar')).not.toBeInTheDocument()
    unmount()

    mocks.editorState.activeTab = 'text'
    render(<ConciseShell project={project} />)
    expect(screen.getByTestId('media-sidebar')).toBeInTheDocument()
  })
})
