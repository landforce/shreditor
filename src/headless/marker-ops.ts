/**
 * Timeline markers and clip links as headless ops.
 *
 * Markers are reference points on the ruler (`timeline.markers`), the same ones
 * the user drops in the editor. The agent uses them for a plan's beats
 * (`shred build` labels each `<role>: <takeaway>`), so ids can be chosen
 * (`plan-b01`) to find and replace them later.
 *
 * Links: a video and its own audio share a `linkedGroupId`, and the editor's
 * remove expands a selection to the whole group. `unlinkItems` and
 * `removeItems { linked: false }` make one side its own item first, exactly as
 * the editor's Unlink does (a video that had an audio companion gets its
 * embedded audio muted, so removing the companion leaves it silent).
 */
import type { ProjectMarker } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { removeItems, unlinkItems } from '@/features/timeline/stores/timeline-actions'

type Op = Record<string, unknown>

/** Plan beats and other agent markers: amber, apart from the editor's default blue. */
const DEFAULT_MARKER_COLOR = '#F59E0B'

const idList = (value: unknown, name: string): string[] => {
  const ids = Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
  if (ids.length === 0) throw new Error(`${name} requires non-empty \`ids\``)
  return ids
}

function addMarkerOp(op: Op): { id: string; frame: number } {
  const frame = op.frame
  if (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 0)
    throw new Error('addMarker requires `frame` (a whole frame, 0 or more)')
  const markers = useMarkersStore.getState().markers
  const id = typeof op.id === 'string' && op.id ? op.id : crypto.randomUUID()
  if (markers.some((marker) => marker.id === id))
    throw new Error(`addMarker: a marker "${id}" already exists (removeMarkers it first)`)
  const marker: ProjectMarker = {
    id,
    frame,
    label: typeof op.label === 'string' ? op.label : '',
    color: typeof op.color === 'string' ? op.color : DEFAULT_MARKER_COLOR,
  }
  useMarkersStore.getState().setMarkers([...markers, marker])
  return { id, frame }
}

function removeMarkersOp(op: Op): { removed: string[] } {
  const ids = idList(op.ids, 'removeMarkers')
  const markers = useMarkersStore.getState().markers
  const missing = ids.filter((id) => !markers.some((marker) => marker.id === id))
  if (missing.length) throw new Error(`ids: marker(s) ${missing.join(', ')} do not exist`)
  const drop = new Set(ids)
  useMarkersStore.getState().setMarkers(markers.filter((marker) => !drop.has(marker.id)))
  return { removed: ids }
}

function requireItems(ids: string[]): void {
  const byId = useItemsStore.getState().itemById
  const missing = ids.filter((id) => !byId[id])
  if (missing.length) throw new Error(`ids: item(s) ${missing.join(', ')} do not exist`)
}

/** Ids whose link group changed: every member of the groups the given items were in. */
function unlinkOp(ids: string[]): string[] {
  const before = new Map(useItemsStore.getState().items.map((i) => [i.id, i.linkedGroupId]))
  unlinkItems(ids)
  return useItemsStore
    .getState()
    .items.filter((item) => before.get(item.id) !== item.linkedGroupId)
    .map((item) => item.id)
}

/**
 * `removeItems`: by default the editor's remove (linked companions go too, and
 * `linkedRemoved` names them); `linked: false` removes only the listed items.
 */
export function removeItemsOp(op: Op): { removed: string[]; linkedRemoved?: string[] } {
  const ids = idList(op.ids, 'removeItems')
  requireItems(ids)
  if (op.linked === false) unlinkOp(ids)
  const before = new Set(useItemsStore.getState().items.map((item) => item.id))
  removeItems(ids)
  const after = new Set(useItemsStore.getState().items.map((item) => item.id))
  const asked = new Set(ids)
  const linkedRemoved = [...before].filter((id) => !after.has(id) && !asked.has(id))
  return linkedRemoved.length ? { removed: ids, linkedRemoved } : { removed: ids }
}

/** Marker and link ops; null when `op` is none of them. */
export function runMarkerOp(op: Op): { result: unknown } | null {
  switch (op.op) {
    case 'addMarker':
      return { result: addMarkerOp(op) }
    case 'removeMarkers':
      return { result: removeMarkersOp(op) }
    case 'unlinkItems': {
      const ids = idList(op.ids, 'unlinkItems')
      requireItems(ids)
      return { result: { unlinked: unlinkOp(ids) } }
    }
    default:
      return null
  }
}
