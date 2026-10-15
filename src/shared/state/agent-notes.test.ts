import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { AgentNote } from '@/infrastructure/storage'

interface AgentNotes {
  version: 1
  notes: AgentNote[]
}

let file: AgentNotes = { version: 1, notes: [] }

vi.mock('@/infrastructure/storage', () => ({
  readAgentNotes: vi.fn(async () => structuredClone(file)),
  writeAgentNotes: vi.fn(async (_id: string, next: AgentNotes) => {
    file = structuredClone(next)
  }),
}))

const { doneAgentNotes, openAgentNotes, useAgentNotesStore, waitingAgentNotes } =
  await import('./agent-notes')

const note = (id: string, extra: Partial<AgentNote> = {}): AgentNote => ({
  id,
  text: id,
  createdAt: `2026-01-0${id.length}`,
  status: 'open',
  ...extra,
})

beforeEach(async () => {
  file = { version: 1, notes: [] }
  await useAgentNotesStore.getState().load('p1')
})

describe('agent notes store', () => {
  it('writes a comment with its frame and items, keeping what the agent marked', async () => {
    file = { version: 1, notes: [note('old', { status: 'read' })] }
    await useAgentNotesStore.getState().add({ text: 'Cut here', frame: 94.6, itemIds: ['c1'] })
    expect(file.notes).toHaveLength(2)
    expect(file.notes[1]).toMatchObject({ text: 'Cut here', frame: 95, itemIds: ['c1'] })
    expect(useAgentNotesStore.getState().notes).toEqual(file.notes)
  })

  it('leaves frame and items off a general note', async () => {
    await useAgentNotesStore.getState().add({ text: 'Warmer grade', itemIds: [] })
    expect(file.notes[0]).not.toHaveProperty('frame')
    expect(file.notes[0]).not.toHaveProperty('itemIds')
  })

  it('lists open notes by frame, then general notes by age', () => {
    const notes = [
      note('general'),
      note('late', { frame: 300 }),
      note('done', { frame: 10, status: 'read' }),
      note('early', { frame: 20 }),
    ]
    expect(openAgentNotes(notes).map((n) => n.id)).toEqual(['early', 'late', 'general'])
  })

  it('keeps a range and an anchor on a timed note', async () => {
    const anchor = { itemId: 'c1', offset: 4, sourceFrame: 208 }
    await useAgentNotesStore.getState().add({ text: 'Slow', frame: 40, endFrame: 70.4, anchor })
    expect(file.notes[0]).toMatchObject({ frame: 40, endFrame: 70, anchor })
  })

  it('drops a zero-length range and an anchor without a frame', async () => {
    const anchor = { itemId: 'c1', offset: 0 }
    await useAgentNotesStore.getState().add({ text: 'Here', frame: 40, endFrame: 40 })
    await useAgentNotesStore.getState().add({ text: 'General', anchor })
    expect(file.notes[0]).not.toHaveProperty('endFrame')
    expect(file.notes[1]).not.toHaveProperty('anchor')
  })

  it('marks a note done and reopens it, keeping the agent answer', async () => {
    file = { version: 1, notes: [note('n1', { frame: 10, reply: 'Moved it', pass: 'Pass 5' })] }
    await useAgentNotesStore.getState().load('p1')
    await useAgentNotesStore.getState().markDone('n1')
    expect(file.notes[0]).toMatchObject({ status: 'read' })
    expect(file.notes[0]?.readAt).toBeTypeOf('string')
    await useAgentNotesStore.getState().reopen('n1')
    expect(file.notes[0]).toMatchObject({ status: 'open', reply: 'Moved it', pass: 'Pass 5' })
    expect(file.notes[0]).not.toHaveProperty('readAt')
  })

  it('lists done notes, most recently done first', () => {
    const notes = [
      note('a', { status: 'read', readAt: '2026-10-02' }),
      note('b', { status: 'read', readAt: '2026-10-05' }),
      note('c'),
    ]
    expect(doneAgentNotes(notes).map((n) => n.id)).toEqual(['b', 'a'])
  })
})

describe('notes waiting for the agent', () => {
  it('are the open notes no shred notes has shown yet', () => {
    const notes = [
      note('a'),
      note('b', { seenAt: '2026-10-14T12:00:00Z' }),
      note('c', { status: 'read' }),
    ]
    expect(waitingAgentNotes(notes).map((n) => n.id)).toEqual(['a'])
  })

  it('wait again once reopened', async () => {
    file = { version: 1, notes: [note('a', { status: 'read', seenAt: 'x', readAt: 'y' })] }
    await useAgentNotesStore.getState().reopen('a')
    expect(file.notes[0]).not.toHaveProperty('seenAt')
    expect(waitingAgentNotes(file.notes)).toHaveLength(1)
  })
})
