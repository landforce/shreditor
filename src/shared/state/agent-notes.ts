import { useEffect } from 'react'
import { create } from 'zustand'
import { readAgentNotes, writeAgentNotes, type AgentNote } from '@/infrastructure/storage'
import type { NoteAnchor } from '@/shared/projects/note-anchor.mjs'
import { createLogger } from '@/shared/logging/logger'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'

const logger = createLogger('AgentNotes')

/** How often the open project's notes are re-read, so the agent's `read` marks show up. */
const REFRESH_MS = 4000

interface NoteInput {
  text: string
  frame?: number
  /** Last frame (inclusive) of a note about a stretch. */
  endFrame?: number
  anchor?: NoteAnchor
  itemIds?: string[]
}

interface Composer {
  frame: number
  /** Set when the note is about a stretch (dragged across the Notes lane). */
  endFrame?: number
  itemIds: string[]
}

interface AgentNotesState {
  projectId: string | null
  /** Every note in the file, open and read. */
  notes: AgentNote[]
  /** The last write failed. */
  failed: boolean
  /** Where a timeline comment is being written; null when the composer is closed. */
  composer: Composer | null
  /** The Notes lane also shows notes that are done (greyed). */
  showDone: boolean
  /** The Notes tray is folded to a slim strip (remembered per browser). */
  trayCollapsed: boolean
  load: (projectId: string | null) => Promise<void>
  refresh: () => Promise<void>
  add: (input: NoteInput) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  /** The user marks a note done without the agent. */
  markDone: (id: string) => Promise<boolean>
  /** Back to open, keeping the agent's last answer so it sees what it tried. */
  reopen: (id: string) => Promise<boolean>
  setShowDone: (showDone: boolean) => void
  setTrayCollapsed: (collapsed: boolean) => void
  openComposer: (frame: number, itemIds: string[], endFrame?: number) => void
  closeComposer: () => void
}

const sameNotes = (a: AgentNote[], b: AgentNote[]) => JSON.stringify(a) === JSON.stringify(b)

const TRAY_COLLAPSED_KEY = 'shreditor.notesTray.collapsed'

function readTrayCollapsed(): boolean {
  try {
    return localStorage.getItem(TRAY_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Notes the user leaves for the agent (`projects/<id>/agent/notes.json`): the
 * Pass card's notes and the comments pinned to a timecode on the timeline.
 * Every write re-reads the file first, so the agent's `read` marks survive.
 */
export const useAgentNotesStore = create<AgentNotesState>()((set, get) => {
  const change = async (apply: (current: AgentNote[]) => AgentNote[]) => {
    const projectId = get().projectId
    if (!projectId) return false
    try {
      const stored = await readAgentNotes(projectId)
      const next = { version: 1 as const, notes: apply(stored.notes) }
      await writeAgentNotes(projectId, next)
      if (get().projectId === projectId) set({ notes: next.notes, failed: false })
      return true
    } catch (error) {
      logger.warn('Saving agent notes failed', error)
      set({ failed: true })
      return false
    }
  }

  return {
    projectId: null,
    notes: [],
    failed: false,
    composer: null,
    showDone: false,
    trayCollapsed: readTrayCollapsed(),

    load: async (projectId) => {
      set({ projectId, notes: [], failed: false, composer: null })
      if (projectId) await get().refresh()
    },

    refresh: async () => {
      const projectId = get().projectId
      if (!projectId) return
      try {
        const { notes } = await readAgentNotes(projectId)
        if (get().projectId === projectId && !sameNotes(get().notes, notes)) set({ notes })
      } catch (error) {
        logger.warn('Reading agent notes failed', error)
      }
    },

    add: ({ text, frame, endFrame, anchor, itemIds }) => {
      const start = frame === undefined ? undefined : Math.max(0, Math.round(frame))
      const end =
        start === undefined || endFrame === undefined
          ? undefined
          : Math.max(start, Math.round(endFrame))
      return change((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          text,
          createdAt: new Date().toISOString(),
          status: 'open',
          ...(start === undefined ? {} : { frame: start }),
          ...(end === undefined || end === start ? {} : { endFrame: end }),
          ...(start !== undefined && anchor ? { anchor } : {}),
          ...(itemIds?.length ? { itemIds } : {}),
        },
      ])
    },

    remove: (id) => change((current) => current.filter((note) => note.id !== id)),

    markDone: (id) =>
      change((current) =>
        current.map((note) =>
          note.id === id && note.status === 'open'
            ? { ...note, status: 'read', readAt: new Date().toISOString() }
            : note,
        ),
      ),

    reopen: (id) =>
      change((current) =>
        current.map((note) => {
          if (note.id !== id || note.status === 'open') return note
          const { readAt: _readAt, ...rest } = note
          return { ...rest, status: 'open' }
        }),
      ),

    setShowDone: (showDone) => set({ showDone }),

    setTrayCollapsed: (trayCollapsed) => {
      try {
        localStorage.setItem(TRAY_COLLAPSED_KEY, trayCollapsed ? '1' : '0')
      } catch {
        // Private windows and blocked storage: the tray just won't remember.
      }
      set({ trayCollapsed })
    },

    openComposer: (frame, itemIds, endFrame) =>
      set({ composer: { frame, itemIds, ...(endFrame === undefined ? {} : { endFrame }) } }),
    closeComposer: () => set({ composer: null }),
  }
})

/** Open notes, in timeline order: timed notes by frame, then general ones by age. */
export function openAgentNotes(notes: AgentNote[]): AgentNote[] {
  return notes
    .filter((note) => note.status === 'open')
    .sort(
      (a, b) =>
        (a.frame ?? Infinity) - (b.frame ?? Infinity) || a.createdAt.localeCompare(b.createdAt),
    )
}

/** Notes that are done (read by the agent or marked done), newest first. */
export function doneAgentNotes(notes: AgentNote[]): AgentNote[] {
  return notes
    .filter((note) => note.status === 'read')
    .sort((a, b) => (b.readAt ?? b.createdAt).localeCompare(a.readAt ?? a.createdAt))
}

/** Pause and open the comment composer at the playhead, with the selected items. */
export function startAgentComment(): void {
  const notes = useAgentNotesStore.getState()
  if (!notes.projectId) return
  const playback = usePlaybackStore.getState()
  playback.pause()
  notes.openComposer(playback.currentFrame, useSelectionStore.getState().selectedItemIds)
}

/** Keep the store on the open project, re-reading on focus and every few seconds. */
export function useAgentNotesSync(projectId: string | null | undefined) {
  useEffect(() => {
    const store = useAgentNotesStore.getState()
    void store.load(projectId ?? null)
    if (!projectId) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void useAgentNotesStore.getState().refresh()
    }
    const timer = window.setInterval(refresh, REFRESH_MS)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [projectId])
}
