import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { AudioItem, ImageItem, TextItem, VideoItem } from '@/types/timeline'
import { PropertiesHost } from './card-parts'
import { pickContextCard } from './pick-card'
import { MusicCard } from './music-card'
import { ShotCard } from './shot-card'
import { TextCard } from './text-card'

/** Nothing selected, where the panel has room of its own (narrow layout): a hint. */
function NothingSelected() {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 p-4 text-center" data-testid="concise-nothing-selected">
      <p className="text-sm font-medium">{t('formats.specs.nothingSelected')}</p>
      <p className="text-xs text-muted-foreground">{t('formats.specs.nothingSelectedBody')}</p>
    </div>
  )
}

/**
 * The panel beside the preview in the concise workspace: one card for the
 * current selection. Nothing selected shows nothing in the wide layout (the
 * media bin takes the room; the format, scorecard, canvas and notes are in
 * Project specs) and a short hint in the narrow one. Anything without a card
 * of its own gets the full properties sidebar inline.
 */
export const ConciseContextPanel = memo(function ConciseContextPanel({
  hintWhenEmpty = false,
}: {
  hintWhenEmpty?: boolean
}) {
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
      return hintWhenEmpty ? <NothingSelected /> : null
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
