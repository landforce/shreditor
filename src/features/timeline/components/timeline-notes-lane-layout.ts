import type { AgentNote } from '@/infrastructure/storage'
import type { NoteSpan } from '@/shared/projects/note-anchor.mjs'
import { doneAgentNotes, openAgentNotes, useAgentNotesStore } from '@/shared/state/agent-notes'
import { TIMELINE_NOTES_TRAY_HEIGHT } from '../constants'

/** Widest a single-moment note card runs before the next note. */
export const MAX_CARD_PX = 260
const PIN_PX = 14

/** The Notes lane shows for a project whose notes the editor has loaded. */
export function useNotesLaneVisible(): boolean {
  return useAgentNotesStore((s) => s.projectId !== null)
}

/** Height the Notes tray takes in the timeline, or 0 when it isn't shown. */
export function useNotesLaneHeight(): number {
  return useNotesLaneVisible() ? TIMELINE_NOTES_TRAY_HEIGHT : 0
}

export interface PlacedNote {
  note: AgentNote
  span: NoteSpan
  left: number
  width: number
  done: boolean
}

/**
 * Where each visible note draws: open notes, plus done ones when shown. A range
 * spans its frames; a single moment runs to the next note, up to `maxWidth`.
 */
export function placeNotes(
  notes: AgentNote[],
  showDone: boolean,
  resolve: (note: AgentNote) => NoteSpan | undefined,
  frameToPixels: (frame: number) => number,
  maxWidth = MAX_CARD_PX,
): PlacedNote[] {
  const visible = [...openAgentNotes(notes), ...(showDone ? doneAgentNotes(notes) : [])]
  const placed = visible
    .map((note) => ({ note, span: resolve(note) }))
    .filter((entry): entry is { note: AgentNote; span: NoteSpan } => entry.span !== undefined)
    .map(({ note, span }) => {
      const left = frameToPixels(span.frame)
      const rangeWidth = span.endFrame === undefined ? 0 : frameToPixels(span.endFrame + 1) - left
      return { note, span, left, width: Math.max(PIN_PX, rangeWidth), done: note.status === 'read' }
    })
    .sort((a, b) => a.left - b.left || Number(a.done) - Number(b.done))
  return placed.map((entry, index) => {
    if (entry.span.endFrame !== undefined) return entry
    const next = placed[index + 1]
    const room = next ? next.left - entry.left - 2 : maxWidth
    return { ...entry, width: Math.max(PIN_PX, Math.min(maxWidth, room)) }
  })
}
