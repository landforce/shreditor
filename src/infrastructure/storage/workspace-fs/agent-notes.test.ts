// @vitest-environment node

import { afterEach, describe, expect, it } from 'vite-plus/test'
import '../test-utils/logger-test-mocks'

import { readAgentNotes, writeAgentNotes } from './agent-notes'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

afterEach(() => setWorkspaceRoot(null))

describe('agent notes', () => {
  it('reads an empty list when the file is missing', async () => {
    setWorkspaceRoot(asHandle(createRoot()))
    expect(await readAgentNotes('p1')).toEqual({ version: 1, notes: [] })
  })

  it('round-trips notes under projects/<id>/agent/notes.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const notes = {
      version: 1 as const,
      notes: [
        { id: 'n1', text: 'Tighten the hook', createdAt: '2026-01-01', status: 'open' as const },
      ],
    }
    await writeAgentNotes('p1', notes)
    expect(await readAgentNotes('p1')).toEqual(notes)
    expect(await readFileText(root, 'projects', 'p1', 'agent', 'notes.json')).toContain('n1')
  })

  it('keeps a timed note with its items and drops one with a bad frame', async () => {
    setWorkspaceRoot(asHandle(createRoot()))
    const timed = {
      id: 'n2',
      text: 'Cut here',
      createdAt: '2026-01-01',
      status: 'open' as const,
      frame: 95,
      itemIds: ['clip-1'],
    }
    const badFrame = { ...timed, id: 'n3', frame: -4 }
    const badItems = { ...timed, id: 'n4', itemIds: [7] }
    const badStatus = { ...timed, id: 'n5', status: 'done' }
    // @ts-expect-error malformed notes on disk
    await writeAgentNotes('p1', { version: 1, notes: [timed, badFrame, badItems, badStatus, null] })
    expect((await readAgentNotes('p1')).notes).toEqual([timed])
  })
})
