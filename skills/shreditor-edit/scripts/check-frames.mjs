// What to open after `shred check`: one frame from every flagged range.

const LOOK_STATUSES = new Set(['fail', 'warn', 'look'])
const MAX_LOOK_FRAMES = 20

/**
 * One frame (the middle) of every range a check flagged, format and kit alike:
 * what to open after `shred check`. Returns [{ frame, ids }] in frame order.
 */
export function flaggedFrames(card, kitCard) {
  const byFrame = new Map()
  const add = (id, ranges) => {
    for (const r of ranges ?? []) {
      const frame = Math.round((r.startFrame + r.endFrame) / 2)
      byFrame.set(frame, [...(byFrame.get(frame) ?? []), id])
    }
  }
  for (const c of card?.checks ?? []) if (LOOK_STATUSES.has(c.status)) add(c.key, c.ranges)
  for (const c of kitCard?.checks ?? []) if (LOOK_STATUSES.has(c.status)) add(c.id, c.ranges)
  return [...byFrame]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_LOOK_FRAMES)
    .map(([frame, ids]) => ({ frame, ids }))
}
