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

const { openAgentNotes, useAgentNotesStore } = await import('./agent-notes')

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
})
