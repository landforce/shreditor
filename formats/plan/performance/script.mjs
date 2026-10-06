// A performance plan as a readable script (`shred plan`): every line in plan
// order with its timecode in the final cut, KEEP or CUT (with the reason), what
// is said and where it comes from, and under it the visuals and text that go
// with it. Then the "To source" list: every visual still to find or make, with
// the line it goes on. Pure: lines of text.

const clock = (frames, fps) => {
  const s = frames / fps
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`
}
const span = (start, end, fps) => `${clock(start, fps)}-${clock(end, fps)}`
const sec = (value) => value.toFixed(2)
const INDENT = ' '.repeat(16)

function verdict(line) {
  if (line.keep) return 'KEEP'
  const take = line.takeOf ? ` of ${line.takeOf}` : ''
  return `CUT (${line.reason ?? 'no reason'}${take})`
}

function said(line) {
  if (line.text) return line.text
  const length = line.source.outSec - line.source.inSec
  return `[${sec(length)} s without words]`
}

const sourceOf = (line) =>
  `${line.media?.fileName ?? line.source.mediaId} ${sec(line.source.inSec)}-${sec(line.source.outSec)} s`

function visualLines(line, layout, fps) {
  const visuals = layout.visuals
    .filter((v) => v.lineId === line.id)
    .map((v) => {
      const what = v.media ? v.media.fileName : `TO SOURCE: ${v.toSource}`
      const fit = typeof v.visual.fit === 'string' ? ` (${v.visual.fit})` : ''
      const note = v.visual.note ? `  (${v.visual.note})` : ''
      return `${INDENT}+ ${v.trackRole.padEnd(7)} ${what}${fit}  ${span(v.start, v.end, fps)}${note}`
    })
  const texts = layout.texts
    .filter((t) => t.lineId === line.id)
    .map((t) => `${INDENT}+ ${t.role.padEnd(7)} "${t.text}"  ${span(t.start, t.end, fps)}`)
  return [...visuals, ...texts]
}

function aboutLines(line) {
  return [
    line.takeaway && `${INDENT}takeaway  ${line.takeaway}`,
    line.why && `${INDENT}why       ${line.why}`,
  ].filter(Boolean)
}

/** Where each line sits in the cut: a kept line's start, a cut line's cut point (the next kept line). */
function cutPoints(lines, layout) {
  const points = new Map()
  let next = layout.durationFrames
  for (const line of [...lines].reverse()) {
    const own = layout.spans.get(line.id)
    if (own) next = own.start
    points.set(line.id, next)
  }
  return points
}

/** The script, one entry per printed line. */
export function performanceScript(plan, lines, layout) {
  const { fps } = plan
  const points = cutPoints(lines, layout)
  return lines.flatMap((line) => {
    const at = clock(points.get(line.id), fps)
    const time = line.keep ? ` ${at} ` : `(${at})`
    const head = `${time.padEnd(10)} ${verdict(line).padEnd(22)} ${line.id.padEnd(5)} ${(line.role ?? '-').padEnd(6)} ${said(line)}`
    const kept = line.keep && layout.spans.has(line.id)
    return [
      head,
      `${INDENT}${sourceOf(line)}`,
      ...(kept ? visualLines(line, layout, fps) : []),
      ...aboutLines(line),
    ]
  })
}

/** Every visual still to find or make, with the line it goes on and when. */
export function toSourceList(lines, layout, fps) {
  const byId = new Map(lines.map((line) => [line.id, line]))
  return layout.visuals
    .filter((visual) => visual.toSource)
    .map((visual) => {
      const line = byId.get(visual.lineId)
      return `${visual.id.padEnd(8)} ${clock(visual.start, fps)}  ${visual.trackRole.padEnd(7)} ${visual.toSource}   (on ${line.id} ${line.role ?? ''}: "${line.text}")`
    })
}
