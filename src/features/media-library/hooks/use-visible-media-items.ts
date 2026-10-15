import { useMemo } from 'react'
import type { MediaMetadata } from '@/types/storage'
import { useCompositionsStore, useTimelineStore } from '../deps/timeline-stores'
import { useFilteredMediaItems, useMediaLibraryStore } from '../stores/media-library-store'
import { supersededMotionRenders } from '../utils/motion-renders'

/**
 * The motion renders a re-render replaced, out of the whole library: not on
 * the timeline or in a composition, and not the newest of their graphic.
 */
export function useSupersededMotionRenders(): Set<string> {
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const items = useTimelineStore((s) => s.items)
  const compositionMediaIds = useCompositionsStore((s) => s.mediaDependencyIds)
  return useMemo(() => {
    const used = new Set(compositionMediaIds)
    for (const item of items) if (item.mediaId) used.add(item.mediaId)
    return supersededMotionRenders(mediaItems, used)
  }, [mediaItems, items, compositionMediaIds])
}

/** The filtered media list, without replaced motion renders unless the user shows them. */
export function useVisibleMediaItems(): MediaMetadata[] {
  const filtered = useFilteredMediaItems()
  const hidden = useSupersededMotionRenders()
  const showOlder = useMediaLibraryStore((s) => s.showOlderRenders)
  return useMemo(
    () => (showOlder || !hidden.size ? filtered : filtered.filter((item) => !hidden.has(item.id))),
    [filtered, hidden, showOlder],
  )
}
