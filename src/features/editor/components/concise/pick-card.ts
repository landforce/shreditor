import type { TimelineItem } from '@/types/timeline'

export type ContextCardKind = 'pass' | 'shot' | 'text' | 'music' | 'properties'

/** Which card the selection gets. */
export function pickContextCard(
  items: readonly TimelineItem[],
  hasOtherSelection: boolean,
): ContextCardKind {
  if (items.length === 0) return hasOtherSelection ? 'properties' : 'pass'
  const types = new Set(items.map((item) => item.type))
  const mediaOnly = [...types].every(
    (type) => type === 'video' || type === 'image' || type === 'audio',
  )
  if (mediaOnly && (types.has('video') || types.has('image'))) return 'shot'
  if (types.size === 1 && types.has('text')) return 'text'
  if (types.size === 1 && types.has('audio')) return 'music'
  return 'properties'
}
