/**
 * Seamless cuts in the preview.
 *
 * The preview plays clips through pooled `<video>` elements. A cut that lands
 * on an element which first has to load or seek shows the outgoing frame (or
 * nothing) until that element decodes, and then the picture jumps to catch up.
 * To avoid that, the clip after the cut is prepared on its own element ahead of
 * time: loaded, parked paused and hidden on its first frame, so the cut only has
 * to swap which element is shown and start it playing.
 *
 * Within one stable video group (split clips of the same origin), consecutive
 * clips whose source carries straight on share one element that simply keeps
 * playing. A clip that jumps in the source alternates to the group's other
 * lane, so it can be prepared while the current clip plays.
 */

/** How far ahead of its cut the next clip is mounted, loaded and parked on its first frame. */
export const VIDEO_CUT_PREPARE_LOOKAHEAD_SECONDS = 1

interface PreparableVideoItem {
  id: string
  from: number
  durationInFrames: number
  speed?: number
  isReversed?: boolean
  sourceStart?: number
  sourceEnd?: number
}

/**
 * Whether `next` continues `prev`'s source with no jump, so one element can play
 * through the cut. Clips without a recorded source window keep the old
 * single-element behaviour.
 */
export function isSourceContinuousCut(
  prev: PreparableVideoItem,
  next: PreparableVideoItem,
): boolean {
  if (next.from !== prev.from + prev.durationInFrames) return false
  if ((prev.speed ?? 1) !== (next.speed ?? 1)) return false
  if (prev.isReversed === true || next.isReversed === true) return false
  if (prev.sourceEnd === undefined || next.sourceStart === undefined) return true
  return Math.abs(next.sourceStart - prev.sourceEnd) <= 1
}

/** The playback lane (0 or 1) for each item of a group sorted by `from`. */
export function assignVideoPlaybackLanes(items: readonly PreparableVideoItem[]): number[] {
  const lanes: number[] = []
  for (let index = 0; index < items.length; index += 1) {
    if (index === 0) {
      lanes.push(0)
      continue
    }
    const previousLane = lanes[index - 1]!
    lanes.push(
      isSourceContinuousCut(items[index - 1]!, items[index]!) ? previousLane : 1 - previousLane,
    )
  }
  return lanes
}

/** The lane of the item at `index`, or lane 0 when there is none. */
export function getVideoPlaybackLane(lanes: readonly number[], index: number): number {
  return index >= 0 ? (lanes[index] ?? 0) : 0
}

/** The pool identity for a group's lane. Lane 0 keeps the group's historical id. */
export function getVideoLanePoolClipId(originKey: string, lane: number): string {
  return lane === 0 ? `group-${originKey}` : `group-${originKey}:lane-${lane}`
}

/**
 * The index of the item to prepare ahead of its cut, or -1.
 *
 * With no active item (the group's Sequence is premounting before its first
 * clip) that is the group's first item. Otherwise it is the item right after the
 * active one when it starts within `lookaheadFrames` on the other lane. Reversed
 * clips (seek-driven anyway) and transition participants (prepared by the
 * transition machinery) are left alone.
 */
export function resolvePreparedVideoItemIndex({
  items,
  lanes,
  activeItemIndex,
  globalFrame,
  lookaheadFrames,
  excludedItemIds,
}: {
  items: readonly PreparableVideoItem[]
  lanes: readonly number[]
  activeItemIndex: number
  globalFrame: number
  lookaheadFrames: number
  excludedItemIds?: ReadonlySet<string>
}): number {
  const candidateIndex = activeItemIndex < 0 ? 0 : activeItemIndex + 1
  const candidate = items[candidateIndex]
  if (!candidate || candidate.from <= globalFrame) return -1
  if (candidate.from - globalFrame > lookaheadFrames) return -1
  if (candidate.isReversed === true) return -1
  if (excludedItemIds?.has(candidate.id)) return -1

  if (activeItemIndex >= 0) {
    const active = items[activeItemIndex]!
    if (lanes[candidateIndex] === lanes[activeItemIndex]) return -1
    // Overlapping items are a transition's business, not a cut's.
    if (candidate.from < active.from + active.durationInFrames) return -1
  }

  return candidateIndex
}
