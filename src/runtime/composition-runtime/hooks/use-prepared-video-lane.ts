/**
 * The clip after the next cut on a stable video group, to prepare hidden on its
 * own lane ahead of the cut (see ../utils/video-cut-prepare.ts).
 */

import { useMemo } from 'react'
import { useMediaLibraryStore, usePlaybackStore } from '@/runtime/composition-runtime/deps/stores'
import type { TimelineItem } from '@/types/timeline'
import type { ResolvedTransitionWindow } from '@/shared/timeline/transitions/transition-planner'
import type { StableVideoGroup } from '../utils/video-scene'
import {
  VIDEO_CUT_PREPARE_LOOKAHEAD_SECONDS,
  getVideoLanePoolClipId,
  getVideoPlaybackLane,
  resolvePreparedVideoItemIndex,
} from '../utils/video-cut-prepare'
import type { VideoLane } from '../components/video-lane-slots'

interface LaneVideoItem {
  id: string
  from: number
  durationInFrames: number
  mediaId?: string
  speed?: number
  isReversed?: boolean
  sourceStart?: number
  sourceEnd?: number
}

type PreparedLaneItem<TItem> = TItem & {
  _sequenceFrameOffset: number
  _poolClipId: string
  _sharedTransitionSync: boolean
}

/** Ids that must not be prepared here: transition participants and media the browser can't decode. */
function collectUnpreparedItemIds(
  items: readonly LaneVideoItem[],
  transitionWindows: readonly ResolvedTransitionWindow<TimelineItem>[],
): Set<string> {
  const ids = new Set<string>()
  for (const window of transitionWindows) {
    ids.add(window.transition.leftClipId)
    ids.add(window.transition.rightClipId)
  }
  const mediaById = useMediaLibraryStore.getState().mediaById
  for (const item of items) {
    if (item.mediaId && mediaById[item.mediaId]?.videoCodecSupported === false) ids.add(item.id)
  }
  return ids
}

/**
 * The clip to prepare on its own lane ahead of the next cut, or null. Not while
 * scrubbing (hidden churn) or shuttling in reverse (seek-driven anyway).
 */
export function usePreparedVideoLane<TItem extends LaneVideoItem>({
  group,
  lanes,
  activeItemIndex,
  globalFrame,
  fps,
  transitionWindows,
}: {
  group: StableVideoGroup<TItem>
  lanes: readonly number[]
  activeItemIndex: number
  globalFrame: number
  fps: number
  transitionWindows: readonly ResolvedTransitionWindow<TimelineItem>[]
}): VideoLane<PreparedLaneItem<TItem>> | null {
  const canPrepareCut = usePlaybackStore(
    (s) => (s.isPlaying || s.previewFrame === null) && s.playbackRate > 0,
  )
  const unpreparedItemIds = useMemo(
    () => collectUnpreparedItemIds(group.items, transitionWindows),
    [group.items, transitionWindows],
  )
  const preparedItemIndex = canPrepareCut
    ? resolvePreparedVideoItemIndex({
        items: group.items,
        lanes,
        activeItemIndex,
        globalFrame,
        lookaheadFrames: Math.round(fps * VIDEO_CUT_PREPARE_LOOKAHEAD_SECONDS),
        excludedItemIds: unpreparedItemIds,
      })
    : -1
  const preparedItem = group.items[preparedItemIndex]
  const preparedLane = getVideoPlaybackLane(lanes, preparedItemIndex)

  return useMemo(() => {
    if (!preparedItem) return null
    return {
      lane: preparedLane,
      item: {
        ...preparedItem,
        _sequenceFrameOffset: preparedItem.from - group.minFrom,
        _poolClipId: getVideoLanePoolClipId(group.originKey, preparedLane),
        _sharedTransitionSync: false,
      },
    }
  }, [group.minFrom, group.originKey, preparedItem, preparedLane])
}
