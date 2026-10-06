/**
 * Same-track overlap guard for headless edits.
 *
 * The editor's add actions resolve a collision by silently pushing the new
 * item later, and move/update let items overlap. For an agent that is a
 * silent wrong edit, so the headless path checks the requested placement
 * BEFORE calling the store actions and fails the op (and with it the whole
 * batch) instead. The interactive editor keeps its own behaviour.
 */
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { getTransitionLinkedIds } from '@/features/timeline/stores/items-store-indexes'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { getSynchronizedLinkedItemsForEdit } from '@/features/timeline/stores/actions/linked-edit'
import { clampTrimAmount } from '@/features/timeline/utils/trim-utils'
import { useEditorStore } from '@/shared/state/editor'

/** Where an item would sit after the op. */
interface Placement {
  /** Existing item id (moves, trims, updates), or the new item's id. */
  id?: string
  trackId: string
  from: number
  durationInFrames: number
  /** How the error names the item, e.g. `text "Hook"`. */
  name?: string
}

export interface OverlapContext {
  op: string
  callerId?: string
}

const range = (from: number, duration: number) => `[${from}, ${from + duration})`

function describeItem(item: Pick<TimelineItem, 'id' | 'type' | 'label'> & { text?: unknown }) {
  // Text items are named by what they say (their label defaults to "Text").
  const label = (typeof item.text === 'string' && item.text) || item.label || ''
  return `${item.type}${label ? ` "${label.slice(0, 40)}"` : ''} (${item.id})`
}

function trackName(trackId: string): string {
  const track = useItemsStore.getState().tracks.find((t) => t.id === trackId)
  return track ? `${track.name} (${track.id})` : trackId
}

/** The first item on the placement's track whose frames intersect it. */
function findTrackConflict(
  placement: Placement,
  ignoreIds: ReadonlySet<string> = new Set(),
): TimelineItem | undefined {
  const end = placement.from + placement.durationInFrames
  // Clips joined by a transition are allowed to overlap (the editor's trim clamp skips them too).
  const transitionLinked = placement.id ? getTransitionLinkedIds(placement.id) : new Set<string>()
  return useItemsStore
    .getState()
    .items.filter(
      (other) =>
        other.trackId === placement.trackId &&
        other.id !== placement.id &&
        !ignoreIds.has(other.id) &&
        !transitionLinked.has(other.id) &&
        other.from < end &&
        placement.from < other.from + other.durationInFrames,
    )
    .sort((a, b) => a.from - b.from)[0]
}

/** Throw a descriptive error when the placement overlaps another item on its track. */
export function assertNoTrackOverlap(
  context: OverlapContext,
  placement: Placement,
  ignoreIds?: ReadonlySet<string>,
): void {
  const conflict = findTrackConflict(placement, ignoreIds)
  if (!conflict) return
  const who = context.callerId
    ? `callerId "${context.callerId}" (${context.op})`
    : `op ${context.op}`
  const subject = placement.name ?? (placement.id ? `item ${placement.id}` : 'the item')
  throw new Error(
    `same-track overlap: ${who} would put ${subject} at frames ` +
      `${range(placement.from, placement.durationInFrames)} on track ${trackName(placement.trackId)}, ` +
      `which overlaps ${describeItem(conflict)} at frames ${range(conflict.from, conflict.durationInFrames)}. ` +
      'Items on one track cannot overlap and nothing was shifted: the batch was not applied. ' +
      'Use a free range, another track, or move/trim the other item first.',
  )
}

/** Placement check for an existing item changing position, length or track. */
export function assertItemPlacement(
  context: OverlapContext,
  item: TimelineItem,
  next: { trackId?: string; from?: number; durationInFrames?: number },
): void {
  assertNoTrackOverlap(context, {
    id: item.id,
    trackId: next.trackId ?? item.trackId,
    from: next.from ?? item.from,
    durationInFrames: next.durationInFrames ?? item.durationInFrames,
    name: describeItem(item),
  })
}

/**
 * Check a trim before the store clamps it against neighbours. Mirrors the
 * action: linked items trim together and the amount is limited by each
 * item's source window first, so only a real collision is reported.
 */
export function assertTrimPlacement(
  context: OverlapContext,
  id: string,
  handle: 'start' | 'end',
  amount: number,
): void {
  const items = useItemsStore.getState().items
  const linked = getSynchronizedLinkedItemsForEdit(
    items,
    id,
    useEditorStore.getState().linkedSelectionEnabled,
  )
  const fps = useTimelineSettingsStore.getState().fps || 30
  let applied = amount
  for (const item of linked) {
    const clamped = clampTrimAmount(item, handle, applied, fps).clampedAmount
    applied = applied < 0 ? Math.max(applied, clamped) : Math.min(applied, clamped)
  }
  const grows = handle === 'start' ? applied < 0 : applied > 0
  if (!grows) return
  const linkedIds = new Set(linked.map((item) => item.id))
  for (const item of linked) {
    const next =
      handle === 'start'
        ? { from: item.from + applied, durationInFrames: item.durationInFrames - applied }
        : { durationInFrames: item.durationInFrames + applied }
    assertNoTrackOverlap(
      context,
      {
        id: item.id,
        trackId: item.trackId,
        from: next.from ?? item.from,
        durationInFrames: next.durationInFrames,
        name: describeItem(item),
      },
      linkedIds,
    )
  }
}

/** The first track of `kind` (in track order) with the range free, if any. */
export function findFreeTrack(
  kind: 'video' | 'audio',
  from: number,
  durationInFrames: number,
): TimelineTrack | undefined {
  return [...useItemsStore.getState().tracks]
    .filter((track) => !track.isGroup && (track.kind ?? 'video') === kind)
    .sort((a, b) => a.order - b.order)
    .find((track) => !findTrackConflict({ trackId: track.id, from, durationInFrames }))
}
