import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { resolveEffectiveTrackStates } from './group-utils'
import { getLinkedItemIds } from './linked-items'

/** The clip covers the frame: `from <= frame < end`. */
function isItemAtFrame(item: TimelineItem, frame: number): boolean {
  return frame >= item.from && frame < item.from + item.durationInFrames
}

/** The frame falls strictly inside the clip, so a cut there leaves two parts. */
function isFrameInsideItem(item: TimelineItem, frame: number): boolean {
  return frame > item.from && frame < item.from + item.durationInFrames
}

/** Lanes a keyboard edit may touch: not a Layer Group row, not locked (directly or by its group). */
function getEditableTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  return resolveEffectiveTrackStates(tracks).filter((track) => !track.locked)
}

function getEditableTrackIdSet(tracks: TimelineTrack[]): Set<string> {
  return new Set(getEditableTracks(tracks).map((track) => track.id))
}

/**
 * Every clip a click could select: all items on unlocked lanes of the open
 * composition level. Hidden lanes stay selectable, as they are by click.
 */
export function getSelectableItemIds(items: TimelineItem[], tracks: TimelineTrack[]): string[] {
  const editableTrackIds = getEditableTrackIdSet(tracks)
  return items.filter((item) => editableTrackIds.has(item.trackId)).map((item) => item.id)
}

interface PlayheadClipQuery {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  frame: number
  activeTrackId: string | null
  /** Require the frame strictly inside the clip (a trim or cut needs both sides). */
  strict?: boolean
}

/**
 * The clip at the playhead on the active track, else on the topmost visible
 * unlocked track that has one. Locked lanes are never targeted.
 */
export function findClipAtPlayhead({
  items,
  tracks,
  frame,
  activeTrackId,
  strict = false,
}: PlayheadClipQuery): TimelineItem | null {
  const covers = strict ? isFrameInsideItem : isItemAtFrame
  const editableTracks = getEditableTracks(tracks)
  const candidates = items.filter((item) => covers(item, frame))
  if (candidates.length === 0) return null

  const onTrack = (trackId: string) => candidates.find((item) => item.trackId === trackId) ?? null

  if (activeTrackId && editableTracks.some((track) => track.id === activeTrackId)) {
    const activeClip = onTrack(activeTrackId)
    if (activeClip) return activeClip
  }

  const orderedTracks = editableTracks
    .filter((track) => track.visible !== false)
    .toSorted((left, right) => left.order - right.order)
  for (const track of orderedTracks) {
    const clip = onTrack(track.id)
    if (clip) return clip
  }
  return null
}

interface PlayheadTargetQuery {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  selectedItemIds: readonly string[]
  frame: number
}

/** Selected clips on unlocked lanes that the frame falls strictly inside. */
export function getSelectedItemIdsInsideFrame({
  items,
  tracks,
  selectedItemIds,
  frame,
}: PlayheadTargetQuery): string[] {
  const editableTrackIds = getEditableTrackIdSet(tracks)
  const selected = new Set(selectedItemIds)
  return items
    .filter(
      (item) =>
        selected.has(item.id) &&
        editableTrackIds.has(item.trackId) &&
        isFrameInsideItem(item, frame),
    )
    .map((item) => item.id)
}

/**
 * Add Edit targets: the selected clips under the playhead when there are any,
 * otherwise every clip under the playhead on an unlocked lane.
 */
export function getAddEditTargetIds(query: PlayheadTargetQuery): string[] {
  const selectedTargets = getSelectedItemIdsInsideFrame(query)
  if (selectedTargets.length > 0) return selectedTargets

  const editableTrackIds = getEditableTrackIdSet(query.tracks)
  return query.items
    .filter((item) => editableTrackIds.has(item.trackId) && isFrameInsideItem(item, query.frame))
    .map((item) => item.id)
}

/** The selection a click on this clip would make, honouring linked selection. */
export function getClickSelectionIds(
  items: TimelineItem[],
  itemId: string,
  linkedSelectionEnabled: boolean,
): string[] {
  return linkedSelectionEnabled ? getLinkedItemIds(items, itemId) : [itemId]
}
