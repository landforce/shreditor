import { memo, useMemo } from 'react'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { AudioItem, ImageItem, TextItem, VideoItem } from '@/types/timeline'
import { PropertiesHost } from './card-parts'
import { pickContextCard } from './pick-card'
import { MusicCard } from './music-card'
import { PassCard } from './pass-card'
import { ShotCard } from './shot-card'
import { TextCard } from './text-card'

/**
 * The panel beside the preview in the concise workspace: one card for the
 * current selection (nothing selected is the "Pass" card). Anything without a
 * card of its own gets the full properties sidebar inline.
 */
export const ConciseContextPanel = memo(function ConciseContextPanel() {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const hasOtherSelection = useSelectionStore(
    (s) => s.selectedMarkerId !== null || s.selectedTransitionId !== null,
  )
  const allItems = useTimelineStore((s) => s.items)
  const selected = useMemo(() => {
    const byId = new Map(allItems.map((item) => [item.id, item]))
    return selectedItemIds.flatMap((id) => byId.get(id) ?? [])
  }, [allItems, selectedItemIds])

  const kind = pickContextCard(selected, hasOtherSelection)
  switch (kind) {
    case 'pass':
      return <PassCard />
    case 'shot':
      return (
        <ShotCard
          items={selected.filter(
            (item): item is VideoItem | ImageItem => item.type === 'video' || item.type === 'image',
          )}
        />
      )
    case 'text':
      return <TextCard items={selected as TextItem[]} />
    case 'music':
      return <MusicCard items={selected as AudioItem[]} />
    default:
      return <PropertiesHost />
  }
})
