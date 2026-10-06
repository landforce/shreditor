// What changed between two saved timelines: items, markers and the in/out points.
// `shred changes` prints it, and `shred publish` stores it in the pass record.
// Every entry is { id, kind: added|removed|changed, type, name, from, ... },
// sorted by frame. Markers are often the user's notes to the agent, so a
// marker-only tweak must show up here.

// Items keyed by id: added, removed, changed (timing, source, text, transform, other).
function diffItems(before, after) {
  const b = new Map((before?.items ?? []).map((i) => [i.id, i]))
  const a = new Map((after?.items ?? []).map((i) => [i.id, i]))
  const out = []
  const name = (i) => i.label || i.text || `${i.type} ${i.id}`
  for (const [id, item] of a) {
    const old = b.get(id)
    if (!old) {
      out.push({ id, kind: 'added', name: name(item), type: item.type, from: item.from, frames: item.durationInFrames })
      continue
    }
    const fields = []
    if (old.from !== item.from || old.durationInFrames !== item.durationInFrames || old.trackId !== item.trackId) fields.push('timing')
    if (old.sourceStart !== item.sourceStart || old.sourceEnd !== item.sourceEnd) fields.push('source')
    if (old.text !== item.text) fields.push('text')
    if (JSON.stringify(old.transform) !== JSON.stringify(item.transform)) fields.push('frame')
    const rest = (i) => JSON.stringify({ ...i, from: 0, durationInFrames: 0, trackId: 0, sourceStart: 0, sourceEnd: 0, text: 0, transform: 0 })
    if (rest(old) !== rest(item)) fields.push('other')
    if (fields.length) out.push({ id, kind: 'changed', name: name(item), type: item.type, from: item.from, frames: item.durationInFrames, fields })
  }
  for (const [id, item] of b) if (!a.has(id)) out.push({ id, kind: 'removed', name: name(item), type: item.type, from: item.from, frames: item.durationInFrames })
  return out
}

// The editor names an unlabelled marker by its position along the timeline
// ("Marker 2"), ties broken by id; see src/shared/timeline/marker-names.ts.
function markerNames(markers) {
  const sorted = [...markers].sort((x, y) => x.frame - y.frame || String(x.id).localeCompare(String(y.id)))
  return new Map(sorted.map((m, n) => [m.id, m.label?.trim() || `Marker ${n + 1}`]))
}

// Markers keyed by id: added, removed, changed (frame = moved, label, color).
function diffMarkers(before, after) {
  const bList = before?.markers ?? []
  const aList = after?.markers ?? []
  const b = new Map(bList.map((m) => [m.id, m]))
  const a = new Map(aList.map((m) => [m.id, m]))
  const bNames = markerNames(bList)
  const aNames = markerNames(aList)
  const out = []
  for (const [id, m] of a) {
    const old = b.get(id)
    if (!old) {
      out.push({ id, kind: 'added', type: 'marker', name: aNames.get(id), from: m.frame, label: m.label ?? '', color: m.color })
      continue
    }
    const fields = []
    if (old.frame !== m.frame) fields.push('frame')
    if ((old.label ?? '').trim() !== (m.label ?? '').trim()) fields.push('label')
    if (old.color !== m.color) fields.push('color')
    if (fields.length) {
      out.push({ id, kind: 'changed', type: 'marker', name: aNames.get(id), from: m.frame, label: m.label ?? '', color: m.color, fields, was: { frame: old.frame, label: old.label ?? '', color: old.color } })
    }
  }
  for (const [id, m] of b) {
    if (!a.has(id)) out.push({ id, kind: 'removed', type: 'marker', name: bNames.get(id), from: m.frame, label: m.label ?? '', color: m.color })
  }
  return out
}

// In/out points: numbers, or null/absent when unset.
function diffPoints(before, after) {
  const out = []
  for (const [key, type, name] of [['inPoint', 'in-point', 'In point'], ['outPoint', 'out-point', 'Out point']]) {
    const old = before?.[key] ?? null
    const now = after?.[key] ?? null
    if (old === now) continue
    const kind = old === null ? 'added' : now === null ? 'removed' : 'changed'
    out.push({ id: key, kind, type, name, from: now ?? old, ...(kind === 'changed' ? { fields: ['frame'], was: { frame: old } } : {}) })
  }
  return out
}

export function diffTimelines(before, after) {
  return [...diffItems(before, after), ...diffMarkers(before, after), ...diffPoints(before, after)].sort((x, y) => x.from - y.from)
}

const quote = (s) => `"${s}"`

/** One line per change for `shred changes`. */
export function describeChange(d) {
  const head = `${d.kind.padEnd(7)} ${String(d.from).padStart(5)}  `
  if (d.type === 'marker') {
    const details = []
    if (d.fields?.includes('frame')) details.push(`moved from ${d.was.frame}`)
    if (d.fields?.includes('label')) details.push(`label was ${d.was.label ? quote(d.was.label) : 'empty'}`)
    if (d.fields?.includes('color')) details.push(`color was ${d.was.color}`)
    // A labelled marker's name is its label; an unlabelled one gets its ordinal.
    return `${head}marker ${quote(d.name)}${details.length ? `  (${details.join(', ')})` : ''}`
  }
  if (d.type === 'in-point' || d.type === 'out-point') {
    return `${head}${d.name}${d.was ? `  (moved from ${d.was.frame})` : ''}`
  }
  return `${head}${d.name}${d.fields ? `  (${d.fields.join(', ')})` : ''}`
}

/** "2 item(s), 1 marker(s), in/out points" for the changes header. */
export function countChanges(diff) {
  const items = diff.filter((d) => d.type !== 'marker' && d.type !== 'in-point' && d.type !== 'out-point').length
  const markers = diff.filter((d) => d.type === 'marker').length
  const points = diff.some((d) => d.type === 'in-point' || d.type === 'out-point')
  return [`${items} item(s)`, ...(markers ? [`${markers} marker(s)`] : []), ...(points ? ['the in/out points'] : [])].join(', ')
}
