// The user's notes to the agent: `projects/<id>/agent/notes.json`. The editor
// writes them (the Concise Pass card, and comments pinned to a timecode on the
// timeline); `shred notes` reads them, says what sits at each one's frame and
// marks them read with what it did. Pure helpers here; file access and --watch
// live in shred.mjs.

import { resolveNoteSpan } from '../../../src/shared/projects/note-anchor.mjs'

const pad = (n) => String(n).padStart(2, '0')

/** MM:SS:FF (HH:MM:SS:FF past an hour), as the editor's timecodes read. */
export function timecode(frame, fps) {
  const rate = Math.max(1, Math.round(fps))
  const total = Math.floor(frame / rate)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const f = frame % rate
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}` : `${pad(m)}:${pad(s)}:${pad(f)}`
}

/** Notes still open: timed ones by frame, then general ones by age (the editor's order). */
export function openNotes(notes) {
  return notes
    .filter((note) => note.status === 'open')
    .sort(
      (a, b) =>
        (a.frame ?? Infinity) - (b.frame ?? Infinity) || a.createdAt.localeCompare(b.createdAt),
    )
}

/** The short id shown and accepted by `--read`. */
export const shortId = (note) => note.id.slice(0, 8)

function itemLine(item, tracks) {
  const track = tracks.find((t) => t.id === item.trackId)
  const what = item.type === 'text' ? JSON.stringify(item.text ?? '') : (item.label ?? '')
  return `${track?.name ?? 'track'}: ${item.type} ${what} ${item.from}-${item.from + item.durationInFrames} [${item.id}]`
}

const SPAN_NOTES = {
  trimmed: '    (its moment was trimmed out of the clip; it sits at the clip edge)',
  detached: '    (the clip it was pinned to is gone; frame as written)',
}

/**
 * Where a note sits now: it follows the clip it was pinned to (see
 * note-anchor.mjs), so frames match what the editor's Notes lane shows.
 */
export function noteSpan(note, timeline, fps) {
  return resolveNoteSpan(note, timeline?.items ?? [], fps)
}

/**
 * One note in words: its time (or range) and text, the timeline items at its
 * frame, the items the user had selected (by id, wherever they are now), and
 * the agent's last answer when the user reopened it.
 */
export function describeNote(note, timeline, fps) {
  const span = noteSpan(note, timeline, fps)
  const at = !span
    ? 'general'
    : span.endFrame === undefined
      ? `${timecode(span.frame, fps)} (frame ${span.frame})`
      : `${timecode(span.frame, fps)}-${timecode(span.endFrame, fps)} (frames ${span.frame}-${span.endFrame})`
  const lines = [`[${shortId(note)}] ${at}  ${JSON.stringify(note.text)}`]
  if (note.reply) {
    lines.push(
      `    reopened; your last answer${note.pass ? ` (${note.pass})` : ''}: ${JSON.stringify(note.reply)}`,
    )
  }
  if (span && SPAN_NOTES[span.state]) lines.push(SPAN_NOTES[span.state])
  if (!timeline) return lines
  const tracks = timeline.tracks ?? []
  const items = timeline.items ?? []
  const order = (item) => tracks.find((t) => t.id === item.trackId)?.order ?? 0
  if (span) {
    const last = span.endFrame ?? span.frame
    const under = items
      .filter((i) => i.from <= last && span.frame < i.from + i.durationInFrames)
      .sort((a, b) => order(a) - order(b) || a.from - b.from)
    const where = span.endFrame === undefined ? 'at this frame' : 'in this range'
    lines.push(under.length ? `    ${where}:` : `    ${where}: nothing`)
    for (const item of under) lines.push(`      ${itemLine(item, tracks)}`)
  }
  if (note.itemIds?.length) {
    lines.push('    selected when written:')
    for (const id of note.itemIds) {
      const item = items.find((i) => i.id === id)
      lines.push(`      ${item ? itemLine(item, tracks) : `[${id}] (no longer on the timeline)`}`)
    }
  }
  return lines
}

/**
 * Stamp `seenAt` on the open notes the agent was just shown (ids), so the
 * editor stops calling them waiting. Notes already seen keep their time.
 */
export function markSeen(notes, ids, now = new Date().toISOString()) {
  const shown = new Set(ids)
  let changed = 0
  const next = notes.map((note) => {
    if (note.status !== 'open' || note.seenAt || !shown.has(note.id)) return note
    changed += 1
    return { ...note, seenAt: now }
  })
  return { notes: next, changed }
}

/**
 * Mark notes read. `which` is "all" or a comma list of ids or id prefixes
 * (the 8-character short ids `shred notes` prints). `reply` (what was done, in
 * a line) and `pass` (the pass that did it) are kept on each note, so the user
 * can see them on the Notes lane once the note is done.
 */
export function markRead(notes, which, { reply, pass, now = new Date().toISOString() } = {}) {
  const wanted =
    which === 'all'
      ? null
      : which
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
  const unknown = (wanted ?? []).filter((w) => !notes.some((n) => n.id.startsWith(w)))
  let marked = 0
  const next = notes.map((note) => {
    const hit = note.status === 'open' && (!wanted || wanted.some((w) => note.id.startsWith(w)))
    if (!hit) return note
    marked += 1
    // A reopened note's old answer described the attempt that didn't land.
    const { reply: _old, pass: _oldPass, ...rest } = note
    return {
      ...rest,
      status: 'read',
      readAt: now,
      ...(reply ? { reply } : {}),
      ...(pass ? { pass } : {}),
    }
  })
  return { notes: next, marked, unknown }
}
