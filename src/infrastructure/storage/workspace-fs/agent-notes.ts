/**
 * Notes the user leaves for the agent's next pass:
 * `projects/{id}/agent/notes.json`.
 *
 * The editor adds and removes notes; the agent reads the open ones, acts on
 * them and marks them `read`. Every write replaces the whole file, so callers
 * read, change and write back in one go.
 */

import { requireWorkspaceRoot } from './root'
import { readJson, writeJsonAtomic } from './fs-primitives'
import { projectDir } from './paths'

export interface AgentNote {
  id: string
  text: string
  createdAt: string
  status: 'open' | 'read'
}

export interface AgentNotes {
  version: 1
  notes: AgentNote[]
}

const notesPath = (projectId: string) => [...projectDir(projectId), 'agent', 'notes.json']

function isNote(value: unknown): value is AgentNote {
  if (!value || typeof value !== 'object') return false
  const note = value as Partial<AgentNote>
  return (
    typeof note.id === 'string' &&
    typeof note.text === 'string' &&
    typeof note.createdAt === 'string' &&
    (note.status === 'open' || note.status === 'read')
  )
}

/** The project's notes; an empty list when the file is missing or malformed. */
export async function readAgentNotes(projectId: string): Promise<AgentNotes> {
  const stored = await readJson<Partial<AgentNotes>>(requireWorkspaceRoot(), notesPath(projectId))
  const notes = Array.isArray(stored?.notes) ? stored.notes.filter(isNote) : []
  return { version: 1, notes }
}

export async function writeAgentNotes(projectId: string, notes: AgentNotes): Promise<void> {
  await writeJsonAtomic(requireWorkspaceRoot(), notesPath(projectId), notes)
}
