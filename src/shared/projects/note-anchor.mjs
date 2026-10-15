// Where a note for the agent sits on the timeline once the clip it is about
// has moved or been trimmed. Shared by the editor (the Notes lane) and the
// agent tools (`shred notes`), so both read a note at the same frame.
//
// A note keeps the frame it was written at. When a clip covers that frame, the
// note is also anchored to it: by source frame for media (so a trim that keeps
// the moment keeps the note on it) and by offset from the clip's start for
// everything else.

const MEDIA_TYPES = new Set(['video', 'audio'])

// Which clip a note is about when several cover its frame: the picture over
// the words over the sound.
const TYPE_RANK = { video: 0, image: 1, composition: 2, text: 4, subtitle: 4, audio: 5 }
const rank = (item) => TYPE_RANK[item.type] ?? 3

const covers = (item, frame) => item.from <= frame && frame < item.from + item.durationInFrames

/** Source frames per timeline frame for a media clip. */
function sourceRate(item, fps) {
  const speed = item.speed > 0 ? item.speed : 1
  const sourceFps = item.sourceFps > 0 ? item.sourceFps : fps
  return (speed * sourceFps) / fps
}

/**
 * The anchor for a note written at `frame`: a selected clip covering the frame
 * when there is one, else the clip covering it that shows the picture.
 * Undefined when nothing covers the frame.
 */
export function noteAnchorFor(frame, selectedIds, items, fps) {
  const under = items.filter((item) => covers(item, frame))
  if (!under.length) return undefined
  const selected = under.filter((item) => selectedIds?.includes(item.id))
  const pool = selected.length ? selected : under
  const item = [...pool].sort((a, b) => rank(a) - rank(b))[0]
  const anchor = { itemId: item.id, offset: frame - item.from }
  if (MEDIA_TYPES.has(item.type)) {
    anchor.sourceFrame = Math.round(
      (item.sourceStart ?? 0) + (frame - item.from) * sourceRate(item, fps),
    )
  }
  return anchor
}

/**
 * Where a note sits now. `state` is `fixed` (no anchor: the frame as written),
 * `anchored` (follows its clip), `trimmed` (its moment was trimmed out of the
 * clip, so it sits at the clip's nearest edge) or `detached` (the clip is
 * gone, so the frame as written). Ranges keep their length.
 */
export function resolveNoteSpan(note, items, fps) {
  if (note.frame === undefined) return undefined
  const length = note.endFrame === undefined ? undefined : Math.max(0, note.endFrame - note.frame)
  const span = (frame, state) => ({
    frame,
    ...(length === undefined ? {} : { endFrame: frame + length }),
    state,
  })
  if (!note.anchor) return span(note.frame, 'fixed')
  const item = items.find((candidate) => candidate.id === note.anchor.itemId)
  if (!item) return span(note.frame, 'detached')
  let frame =
    MEDIA_TYPES.has(item.type) && note.anchor.sourceFrame !== undefined
      ? item.from +
        Math.round((note.anchor.sourceFrame - (item.sourceStart ?? 0)) / sourceRate(item, fps))
      : item.from + note.anchor.offset
  const last = item.from + Math.max(0, item.durationInFrames - 1)
  if (frame < item.from || frame > last) {
    frame = Math.min(Math.max(frame, item.from), last)
    return span(frame, 'trimmed')
  }
  return span(frame, 'anchored')
}
