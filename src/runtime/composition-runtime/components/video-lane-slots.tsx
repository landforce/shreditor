/**
 * The playback lanes of a stable video group: the active clip's slot, and the
 * slot of the clip prepared hidden ahead of the next cut.
 */

import React, { useMemo } from 'react'

export interface VideoLane<TItem> {
  lane: number
  item: TItem
}

const VIDEO_LANE_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
}

// Opacity, not visibility: rendered items set `visibility` explicitly, which
// would override a hidden ancestor.
const PREPARED_VIDEO_LANE_STYLE: React.CSSProperties = {
  ...VIDEO_LANE_STYLE,
  opacity: 0,
  pointerEvents: 'none',
}

/**
 * Each lane keeps one keyed slot, in lane order, so the prepared slot becomes
 * the active one at the cut without remounting or moving its element.
 */
export function VideoLaneSlots<TItem>({
  active,
  prepared,
  renderItem,
}: {
  active: VideoLane<TItem> | null
  prepared: VideoLane<TItem> | null
  renderItem: (item: TItem) => React.ReactNode
}) {
  // Memoize the rendered output so renderItem isn't called every frame
  // (canvas-based effects like halftone would re-render on every frame).
  const activeItem = active?.item
  const preparedItem = prepared?.item
  const activeContent = useMemo(
    () => (activeItem ? renderItem(activeItem) : null),
    [activeItem, renderItem],
  )
  const preparedContent = useMemo(
    () => (preparedItem ? renderItem(preparedItem) : null),
    [preparedItem, renderItem],
  )

  const slots = [
    ...(active ? [{ lane: active.lane, content: activeContent, isPrepared: false }] : []),
    ...(prepared ? [{ lane: prepared.lane, content: preparedContent, isPrepared: true }] : []),
  ].sort((a, b) => a.lane - b.lane)

  return slots.map((slot) => (
    <div
      key={`lane-${slot.lane}`}
      data-video-lane={slot.isPrepared ? 'prepared' : 'active'}
      style={slot.isPrepared ? PREPARED_VIDEO_LANE_STYLE : VIDEO_LANE_STYLE}
    >
      {slot.content}
    </div>
  ))
}
