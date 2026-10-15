/**
 * The `setCutout` edit op: turn background removal on or off for a video clip
 * and set how its masks are drawn (docs/background-removal.md). It only stores
 * settings; the masks are analysed separately (`shred cutout`, the editor's
 * background job, or before a render).
 */
import type { VideoItem } from '@/types/timeline'
import type { CutoutSettings } from '@/types/cutout'
import { cutoutSettingsProblem, mergeCutoutSettings } from '@/shared/cutout/cutout-core.mjs'
import { updateItem } from '@/features/timeline/stores/timeline-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'

const FIELDS = ['enabled', 'subject', 'feather', 'invert', 'refine', 'sampleRate'] as const

/** Apply `{ op: 'setCutout', id, enabled, subject?, ... }`, or null when the op is another one. */
export function runCutoutOp(
  op: Readonly<Record<string, unknown>>,
): { result: { id: string; cutout: CutoutSettings } } | null {
  if (op.op !== 'setCutout') return null
  const id = typeof op.id === 'string' ? op.id : ''
  if (!id) throw new Error('setCutout requires `id`')
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`id: item "${id}" does not exist`)
  if (item.type !== 'video')
    throw new Error(`id: item "${id}" is ${item.type}; background removal works on video clips`)
  const patch: Partial<CutoutSettings> = {}
  for (const field of FIELDS) {
    if (op[field] !== undefined) (patch as Record<string, unknown>)[field] = op[field]
  }
  const cutout = mergeCutoutSettings((item as VideoItem).cutout, patch)
  const problem = cutoutSettingsProblem(cutout)
  if (problem) throw new Error(problem)
  updateItem(id, { cutout } as Partial<VideoItem>)
  return { result: { id, cutout } }
}
