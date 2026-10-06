// The edit against its plan (`shred check`'s Plan section): beats whose clip is
// no longer where the plan puts it, beats now playing out of the planned order,
// and length drift. Never a failure: the user's tweaks are decisions, and a
// restructure is a reason to update the plan, not to undo the edit.

const sec = (frames, fps) => (frames / fps).toFixed(2)
const range = (startFrame, endFrame) => ({ startFrame, endFrame })
const describe = (r, fps) =>
  `frames ${r.startFrame}-${r.endFrame} [${sec(r.startFrame, fps)}-${sec(r.endFrame, fps)} s]`

/** Root timeline clips from this beat's media (pictures for a picture beat). */
function clipsOf(beat, items) {
  const audio = beat.media.kind === 'audio'
  return items.filter(
    (item) => item.mediaId === beat.media.mediaId && (item.type === 'audio') === audio,
  )
}

const overlaps = (item, beat) =>
  item.from < beat.end && item.from + item.durationInFrames > beat.start

/** Where the beat's clip is now: on its planned frames, else its nearest use, else nowhere. */
function locate(beat, items) {
  const clips = clipsOf(beat, items)
  const onPlan = clips.find((item) => overlaps(item, beat))
  if (onPlan) return { item: onPlan, onPlan: true }
  const nearest = [...clips].sort(
    (a, b) => Math.abs(a.from - beat.start) - Math.abs(b.from - beat.start),
  )[0]
  return nearest ? { item: nearest, onPlan: false } : null
}

function missingFinding(beat, where, fps) {
  const planned = range(beat.start, beat.end)
  const label = `${beat.id} ${beat.role ?? 'beat'}: no clip from ${beat.media.fileName} at ${describe(planned, fps)}`
  if (!where)
    return { level: 'warn', message: `${label}; it is not on the timeline`, ranges: [planned] }
  const now = range(where.item.from, where.item.from + where.item.durationInFrames)
  return {
    level: 'warn',
    message: `${label}; it plays at ${describe(now, fps)}`,
    ranges: [planned, now],
  }
}

function orderFindings(located, fps) {
  const byTrack = new Map()
  for (const entry of located)
    byTrack.set(entry.beat.trackRole, [...(byTrack.get(entry.beat.trackRole) ?? []), entry])
  const findings = []
  for (const entries of byTrack.values()) {
    const planned = entries.sort((a, b) => a.beat.start - b.beat.start)
    for (const [i, entry] of planned.entries()) {
      const before = planned[i - 1]
      if (!before || entry.where.item.from >= before.where.item.from) continue
      findings.push({
        level: 'warn',
        message: `${entry.beat.id} now plays before ${before.beat.id} (planned ${before.beat.id} then ${entry.beat.id})`,
        ranges: [entry, before].map(({ where: { item } }) =>
          range(item.from, item.from + item.durationInFrames),
        ),
      })
    }
  }
  return findings.map((f) => ({
    ...f,
    message: `${f.message} at ${f.ranges.map((r) => describe(r, fps)).join(' and ')}`,
  }))
}

function lengthFinding(plan, end) {
  const drift = end - plan.durationFrames
  if (drift === 0) return null
  const level = Math.abs(drift) > plan.fps / 2 ? 'warn' : 'info'
  return {
    level,
    message: `the timeline is ${sec(end, plan.fps)} s, the plan ${sec(plan.durationFrames, plan.fps)} s (${drift > 0 ? '+' : ''}${drift} frames)`,
    ranges: [range(Math.min(end, plan.durationFrames), Math.max(end, plan.durationFrames))],
  }
}

/**
 * Compare a timeline with the plan's validated beats (each with `media` and
 * `trackRole`). Returns `{ findings: [{ level: 'warn'|'info', message, ranges }],
 * checked, skipped }`; beats whose media isn't imported are skipped.
 */
export function comparePlan(plan, beats, timeline) {
  const items = timeline?.items ?? []
  const usable = beats.filter((beat) => beat.media?.mediaId)
  const located = []
  const findings = []
  for (const beat of usable) {
    const where = locate(beat, items)
    if (!where?.onPlan) findings.push(missingFinding(beat, where, plan.fps))
    if (where) located.push({ beat, where })
  }
  findings.push(...orderFindings(located, plan.fps))
  const end = Math.max(0, ...items.map((item) => item.from + item.durationInFrames))
  const length = lengthFinding(plan, end)
  if (length) findings.push(length)
  return { findings, checked: usable.length, skipped: beats.length - usable.length }
}
