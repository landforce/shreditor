/**
 * Notes the user leaves for the agent's next pass:
 * `projects/{id}/agent/notes.json`.
 *
 * The editor adds and removes notes; the agent reads the open ones (`shred
 * notes`, which stamps `seenAt`: the note was picked up), acts on them and
 * marks them `read` with what it did. A note left on
 * the timeline carries the frame (or range) it is about, the clip it is pinned
 * to and the items that were selected. The user can mark a note done or reopen
 * it. Every write replaces the whole file, so callers read, change and write
 * back in one go.
 */

import type { NoteAnchor } from '@/shared/projects/note-anchor.mjs'
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
  /** Last frame (inclusive) of a note about a stretch; absent for a single moment. */
  endFrame?: number
  /** The clip covering `frame` when the note was left, so the note follows it. */
  anchor?: NoteAnchor
  /** Items selected when the note was left. */
  itemIds?: string[]
  /** When the agent first read the open note (`shred notes`); cleared when it is reopened. */
  seenAt?: string
  /** When the note was marked read (by the agent or the user). */
  readAt?: string
  /** What the agent did about it, in a line. */
  reply?: string
  /** The pass that addressed it, e.g. "Pass 5: end glitch fixed". */
  pass?: string
}

export interface AgentNotes {
  version: 1
  notes: AgentNote[]
}

const notesPath = (projectId: string) => [...projectDir(projectId), 'agent', 'notes.json']

const isFrame = (value: unknown) =>
  value === undefined || (Number.isInteger(value) && (value as number) >= 0)

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'

const isAnchor = (value: unknown) => {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const anchor = value as Partial<NoteAnchor>
  return (
    typeof anchor.itemId === 'string' &&
    Number.isInteger(anchor.offset) &&
    (anchor.sourceFrame === undefined || Number.isFinite(anchor.sourceFrame))
  )
}

const isIdList = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.every((id) => typeof id === 'string'))

const isString = (value: unknown) => typeof value === 'string'

/** Every field a stored note may carry, with its check (missing optional fields pass). */
const NOTE_FIELDS: Record<keyof AgentNote, (value: unknown) => boolean> = {
  id: isString,
  text: isString,
  createdAt: isString,
  status: (value) => value === 'open' || value === 'read',
  frame: isFrame,
  endFrame: isFrame,
  anchor: isAnchor,
  itemIds: isIdList,
  seenAt: isOptionalString,
  readAt: isOptionalString,
  reply: isOptionalString,
  pass: isOptionalString,
}

function isNote(value: unknown): value is AgentNote {
  if (!value || typeof value !== 'object') return false
  const note = value as Record<string, unknown>
  return Object.entries(NOTE_FIELDS).every(([field, check]) => check(note[field]))
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
