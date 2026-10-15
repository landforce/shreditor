// Types for ./note-anchor.mjs (shared by the editor and the agent tools).

/** What a note is pinned to: the clip covering its frame when it was written. */
export interface NoteAnchor {
  itemId: string
  /** Frames from the clip's start. */
  offset: number
  /** Source frame (the clip's source fps) for video and audio clips. */
  sourceFrame?: number
}

/** The clip fields anchoring reads. */
export interface AnchorItem {
  id: string
  type: string
  from: number
  durationInFrames: number
  sourceStart?: number
  sourceFps?: number
  speed?: number
}

export interface AnchoredNote {
  frame?: number
  endFrame?: number
  anchor?: NoteAnchor
}

export type NoteSpanState = 'fixed' | 'anchored' | 'trimmed' | 'detached'

export interface NoteSpan {
  frame: number
  endFrame?: number
  state: NoteSpanState
}

export function noteAnchorFor(
  frame: number,
  selectedIds: readonly string[] | undefined,
  items: readonly AnchorItem[],
  fps: number,
): NoteAnchor | undefined

export function resolveNoteSpan(
  note: AnchoredNote,
  items: readonly AnchorItem[],
  fps: number,
): NoteSpan | undefined
