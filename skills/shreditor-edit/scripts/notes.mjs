// The user's notes to the agent: `projects/<id>/agent/notes.json`. The editor
// writes them (the Concise Pass card, and comments pinned to a timecode on the
// timeline); `shred notes` reads them, says what sits at each one's frame and
// marks them read. Pure helpers here; file access and --watch live in shred.mjs.

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

/**
 * One note in words: its time and text, the timeline items at its frame, and
 * the items the user had selected (by id, wherever they are now).
 */
export function describeNote(note, timeline, fps) {
  const at =
    note.frame === undefined ? 'general' : `${timecode(note.frame, fps)} (frame ${note.frame})`
  const lines = [`[${shortId(note)}] ${at}  ${JSON.stringify(note.text)}`]
  if (!timeline) return lines
  const tracks = timeline.tracks ?? []
  const items = timeline.items ?? []
  const order = (item) => tracks.find((t) => t.id === item.trackId)?.order ?? 0
  if (note.frame !== undefined) {
    const under = items
      .filter((i) => i.from <= note.frame && note.frame < i.from + i.durationInFrames)
      .sort((a, b) => order(a) - order(b))
    lines.push(under.length ? '    at this frame:' : '    at this frame: nothing')
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
 * Mark notes read. `which` is "all" or a comma list of ids or id prefixes
 * (the 8-character short ids `shred notes` prints).
 */
export function markRead(notes, which) {
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
    return { ...note, status: 'read' }
  })
  return { notes: next, marked, unknown }
}
