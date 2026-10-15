import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, screen } from '@testing-library/react'
import type { AgentNote } from '@/infrastructure/storage'

let stored: { version: 1; notes: AgentNote[] } = { version: 1, notes: [] }

vi.mock('@/infrastructure/storage', () => ({
  readAgentNotes: vi.fn(async () => structuredClone(stored)),
  writeAgentNotes: vi.fn(async (_id: string, next: typeof stored) => {
    stored = structuredClone(next)
  }),
}))
vi.mock('../contexts/timeline-zoom-context', () => ({
  // 30 fps, 100 px per second
  useTimelineCommittedZoomContext: () => ({
    frameToPixels: (frame: number) => (frame / 30) * 100,
    pixelsToFrame: (px: number) => Math.round((px / 100) * 30),
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}))

const { useAgentNotesStore } = await import('@/shared/state/agent-notes')
const { useItemsStore } = await import('../stores/items-store')
const { TimelineNotesLane, TimelineNotesLaneHeader } = await import('./timeline-notes-lane')
const { placeNotes } = await import('./timeline-notes-lane-layout')

const note = (id: string, extra: Partial<AgentNote> = {}): AgentNote => ({
  id,
  text: `note ${id}`,
  createdAt: '2026-10-14T00:00:00Z',
  status: 'open',
  ...extra,
})

const px = (frame: number) => (frame / 30) * 100

async function loadNotes(notes: AgentNote[]) {
  stored = { version: 1, notes }
  await useAgentNotesStore.getState().load('p1')
}

beforeEach(async () => {
  useItemsStore.setState({ items: [] })
  useAgentNotesStore.setState({ showDone: false })
  await loadNotes([])
})

describe('placeNotes', () => {
  const resolve = (n: AgentNote) =>
    n.frame === undefined
      ? undefined
      : { frame: n.frame, endFrame: n.endFrame, state: 'fixed' as const }

  it('spans a range and runs a moment label up to the next note', () => {
    const placed = placeNotes(
      [note('b', { frame: 60 }), note('a', { frame: 0, endFrame: 29 }), note('g')],
      false,
      resolve,
      px,
    )
    expect(placed.map((p) => [p.note.id, p.left, p.width])).toEqual([
      ['a', 0, 100],
      ['b', 200, 220],
    ])
  })

  it('leaves done notes out unless asked, then draws them after open ones', () => {
    const notes = [note('open', { frame: 30 }), note('done', { frame: 30, status: 'read' })]
    expect(placeNotes(notes, false, resolve, px).map((p) => p.note.id)).toEqual(['open'])
    expect(placeNotes(notes, true, resolve, px).map((p) => [p.note.id, p.done])).toEqual([
      ['open', false],
      ['done', true],
    ])
  })
})

describe('Notes lane', () => {
  it('follows the clip a note is pinned to', async () => {
    useItemsStore.setState({
      items: [{ id: 'c1', type: 'text', trackId: 't', from: 30, durationInFrames: 60 } as never],
    })
    await loadNotes([note('n1', { frame: 40, anchor: { itemId: 'c1', offset: 10 } })])
    render(<TimelineNotesLane />)
    expect(screen.getByTestId('timeline-note-open').style.left).toBe(`${px(40)}px`)
    useItemsStore.setState({
      items: [{ id: 'c1', type: 'text', trackId: 't', from: 0, durationInFrames: 60 } as never],
    })
    expect((await screen.findByTestId('timeline-note-open')).style.left).toBe(`${px(10)}px`)
  })

  it('hides done notes until the eye toggle shows them', async () => {
    await loadNotes([
      note('open1', { frame: 10 }),
      note('done1', { frame: 50, status: 'read', reply: 'Cut it', pass: 'Pass 5: cut' }),
    ])
    render(
      <>
        <TimelineNotesLaneHeader compact={false} />
        <TimelineNotesLane />
      </>,
    )
    expect(screen.queryByTestId('timeline-note-done')).toBeNull()
    fireEvent.click(screen.getByTestId('timeline-notes-show-done'))
    fireEvent.click(await screen.findByTestId('timeline-note-done'))
    expect((await screen.findByTestId('timeline-note-reply')).textContent).toContain('Cut it')
    fireEvent.click(screen.getByTestId('timeline-note-reopen'))
    await vi.waitFor(() => expect(stored.notes[1]?.status).toBe('open'))
    expect(stored.notes[1]?.reply).toBe('Cut it')
  })

  it('marks an open note done from its details', async () => {
    await loadNotes([note('open1', { frame: 10 })])
    render(<TimelineNotesLane />)
    fireEvent.click(screen.getByTestId('timeline-note-open'))
    fireEvent.click(await screen.findByTestId('timeline-note-mark-done'))
    await vi.waitFor(() => expect(stored.notes[0]?.status).toBe('read'))
  })

  it('writes a note from the composer, pinned to the clip under it', async () => {
    useItemsStore.setState({
      items: [
        {
          id: 'v1',
          type: 'video',
          trackId: 't',
          from: 0,
          durationInFrames: 90,
          sourceStart: 30,
          sourceFps: 30,
        } as never,
      ],
    })
    useAgentNotesStore.getState().openComposer(20, [], 40)
    render(<TimelineNotesLane />)
    fireEvent.change(await screen.findByTestId('timeline-agent-comment-input'), {
      target: { value: 'Too slow here' },
    })
    fireEvent.keyDown(screen.getByTestId('timeline-agent-comment-input'), {
      key: 'Enter',
      metaKey: true,
    })
    await vi.waitFor(() => expect(stored.notes).toHaveLength(1))
    expect(stored.notes[0]).toMatchObject({
      text: 'Too slow here',
      frame: 20,
      endFrame: 40,
      anchor: { itemId: 'v1', offset: 20, sourceFrame: 50 },
    })
    expect(useAgentNotesStore.getState().composer).toBeNull()
  })

  it('opens as a tray of cards and folds to a strip, remembering it', async () => {
    useAgentNotesStore.setState({ trayCollapsed: false })
    await loadNotes([note('n1', { frame: 30, text: 'Punch in here' })])
    render(
      <>
        <TimelineNotesLaneHeader compact={false} />
        <TimelineNotesLane />
      </>,
    )
    const header = screen.getByTestId('timeline-notes-header')
    expect(header.style.height).toBe('64px')
    expect(screen.getByTestId('timeline-note-open').textContent).toContain('Punch in here')
    fireEvent.click(screen.getByTestId('timeline-notes-fold'))
    expect(header.style.height).toBe('22px')
    expect(localStorage.getItem('shreditor.notesTray.collapsed')).toBe('1')
    fireEvent.click(screen.getByTestId('timeline-notes-fold'))
    expect(header.style.height).toBe('64px')
  })

  it('right-click on a note: add a note first, then open, mark done and delete', async () => {
    await loadNotes([note('n1', { frame: 30 })])
    render(<TimelineNotesLane />)
    fireEvent.contextMenu(screen.getByTestId('timeline-note-open'), { clientX: 120, clientY: 10 })
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'timeline.notes.addForAgent',
      'timeline.notes.open',
      'timeline.notes.markDone',
      'timeline.notes.delete',
    ])
    fireEvent.click(items[2]!)
    await vi.waitFor(() => expect(stored.notes[0]?.status).toBe('read'))
  })

  it('right-click on the empty tray offers only adding a note', async () => {
    await loadNotes([note('n1', { frame: 30 })])
    render(<TimelineNotesLane />)
    fireEvent.contextMenu(screen.getByTestId('timeline-note-open').parentElement!, {
      clientX: 900,
      clientY: 10,
    })
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['timeline.notes.addForAgent'])
  })
})
