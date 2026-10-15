/**
 * Notes the user leaves for the agent's next pass:
 * `projects/{id}/agent/notes.json`.
 *
 * The editor adds and removes notes; the agent reads the open ones (`shred
 * notes`), acts on them and marks them `read`. A note left on the timeline
 * carries the frame it is about and the items that were selected. Every write replaces the whole file, so callers
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
  /** Timeline frame (project fps) the note is about; absent for a general note. */
  frame?: number
  /** Items selected when the note was left. */
  itemIds?: string[]
}

export interface AgentNotes {
  version: 1
  notes: AgentNote[]
}

const notesPath = (projectId: string) => [...projectDir(projectId), 'agent', 'notes.json']

const isFrame = (value: unknown) =>
  value === undefined || (Number.isInteger(value) && (value as number) >= 0)

const isIdList = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.every((id) => typeof id === 'string'))

function isNote(value: unknown): value is AgentNote {
  if (!value || typeof value !== 'object') return false
  const note = value as Partial<AgentNote>
  return (
    typeof note.id === 'string' &&
    typeof note.text === 'string' &&
    typeof note.createdAt === 'string' &&
    (note.status === 'open' || note.status === 'read') &&
    isFrame(note.frame) &&
    isIdList(note.itemIds)
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
