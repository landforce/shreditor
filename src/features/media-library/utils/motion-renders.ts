import type { MediaMetadata } from '@/types/storage'

/**
 * Renders of a motion graphic `shred motion` made: `<graphic>-<12 hex>.webm`
 * (skills/shreditor-edit/scripts/motion.mjs), or `shreditor-<time>.webm` from
 * before renders were named by graphic.
 */
const RENDER = /^(.+)-[0-9a-f]{12}\.webm$/
const OLD_RENDER = /^shreditor-\d+\.webm$/

/** The graphic a render belongs to, or null for media that isn't a motion render. */
export function motionRenderGraphic(fileName: string): string | null {
  if (OLD_RENDER.test(fileName)) return 'shreditor'
  return RENDER.exec(fileName)?.[1] ?? null
}

/**
 * The motion renders a re-render replaced: not used on the timeline (or in a
 * composition) and not the newest render of their graphic. The media bin
 * hides them; they stay in the project, so undoing a swap still finds them.
 */
export function supersededMotionRenders(
  items: readonly MediaMetadata[],
  usedMediaIds: ReadonlySet<string>,
): Set<string> {
  const newest = new Map<string, MediaMetadata>()
  for (const item of items) {
    const graphic = motionRenderGraphic(item.fileName)
    if (!graphic) continue
    const best = newest.get(graphic)
    if (!best || item.createdAt > best.createdAt) newest.set(graphic, item)
  }
  const hidden = new Set<string>()
  for (const item of items) {
    const graphic = motionRenderGraphic(item.fileName)
    if (graphic && !usedMediaIds.has(item.id) && newest.get(graphic) !== item) hidden.add(item.id)
  }
  return hidden
}
