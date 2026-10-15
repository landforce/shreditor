import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, screen } from '@testing-library/react'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'

vi.mock('@/infrastructure/storage', () => ({
  readAgentNotes: vi.fn(async () => ({ version: 1, notes: [] })),
  writeAgentNotes: vi.fn(async () => {}),
}))

const { useAgentNotesStore } = await import('@/shared/state/agent-notes')
const { usePlaybackStore } = await import('@/shared/state/playback')
const { useSelectionStore } = await import('@/shared/state/selection')
const { useZoomStore } = await import('../stores/zoom-store')
const { useTimelineStore } = await import('../stores/timeline-store')
const { AddAgentNoteMenuItem, noteForAgentAt, timelineFrameAtClientX } =
  await import('./timeline-agent-comments')

let ruler: HTMLDivElement

beforeEach(async () => {
  await useAgentNotesStore.getState().load('p1')
  useZoomStore.setState({ pixelsPerSecond: 100 })
  useTimelineStore.setState({ fps: 30 })
  ruler = document.createElement('div')
  ruler.setAttribute('data-timeline-committed-surface', 'ruler')
  ruler.getBoundingClientRect = () => ({ left: 50 }) as DOMRect
  document.body.appendChild(ruler)
})

afterEach(() => {
  ruler.remove()
  vi.useRealTimers()
})

describe('notes from context menus', () => {
  it('reads the frame under a screen x from the ruler, with scroll and zoom', () => {
    expect(timelineFrameAtClientX(250)).toBe(60)
    expect(timelineFrameAtClientX(10)).toBeNull()
  })

  it('opens the composer at a frame with the selected clips, and moves there', () => {
    useSelectionStore.setState({ selectedItemIds: ['c1'] })
    noteForAgentAt(45)
    expect(useAgentNotesStore.getState().composer).toEqual({ frame: 45, itemIds: ['c1'] })
    expect(usePlaybackStore.getState().currentFrame).toBe(45)
  })

  it('leads a menu and notes the right-clicked frame', () => {
    vi.useFakeTimers()
    useAgentNotesStore.getState().closeComposer()
    render(
      <ContextMenu>
        <ContextMenuTrigger>
          <div data-testid="target">clip</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <AddAgentNoteMenuItem />
          <div role="menuitem">Delete</div>
        </ContextMenuContent>
      </ContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('target'), { clientX: 350, clientY: 10 })
    const items = screen.getAllByRole('menuitem')
    expect(items[0]?.textContent).toContain('Add note for agent')
    fireEvent.click(items[0]!)
    vi.runAllTimers()
    expect(useAgentNotesStore.getState().composer?.frame).toBe(90)
  })
})
