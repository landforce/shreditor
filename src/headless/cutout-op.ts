/**
 * The background removal edit ops (docs/background-removal.md). They only
 * store settings; masks and smart-stroke regions are analysed separately
 * (`shred cutout`, the editor's background job, or before a render).
 *
 * - `setCutout`: turn it on or off for a video clip and set how its masks are drawn.
 * - `addCutoutStroke`: paint one brush correction (plain or smart) on a source frame.
 * - `clearCutoutStrokes`: remove every correction.
 */
import type { VideoItem } from '@/types/timeline'
import type { CutoutSettings, CutoutStroke } from '@/types/cutout'
import { cutoutSettingsProblem, mergeCutoutSettings } from '@/shared/cutout/cutout-core.mjs'
import { withCutoutStroke, withoutCutoutStrokes } from '@/shared/cutout/cutout-strokes.mjs'
import { updateItem } from '@/features/timeline/stores/timeline-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'

const FIELDS = ['enabled', 'subject', 'feather', 'invert', 'refine', 'sampleRate'] as const
const DEFAULT_STROKE_SIZE = 0.03

type Op = Readonly<Record<string, unknown>>
type CutoutResult = { result: { id: string; cutout: CutoutSettings | undefined } }

/** The video clip an op names. */
function videoItem(op: Op): VideoItem {
  const id = typeof op.id === 'string' ? op.id : ''
  if (!id) throw new Error(`${String(op.op)} requires \`id\``)
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`id: item "${id}" does not exist`)
  if (item.type !== 'video')
    throw new Error(`id: item "${id}" is ${item.type}; background removal works on video clips`)
  return item
}

function store(item: VideoItem, cutout: CutoutSettings | undefined): CutoutResult {
  const problem = cutoutSettingsProblem(cutout)
  if (problem) throw new Error(problem)
  updateItem(item.id, { cutout } as Partial<VideoItem>)
  return { result: { id: item.id, cutout } }
}

function setCutout(op: Op): CutoutResult {
  const item = videoItem(op)
  const patch: Partial<CutoutSettings> = {}
  for (const field of FIELDS) {
    if (op[field] !== undefined) (patch as Record<string, unknown>)[field] = op[field]
  }
  return store(item, mergeCutoutSettings(item.cutout, patch))
}

function addCutoutStroke(op: Op): CutoutResult {
  const item = videoItem(op)
  const stroke = {
    tool: op.tool,
    at: op.at,
    size: op.size ?? DEFAULT_STROKE_SIZE,
    points: op.points,
  } as CutoutStroke
  return store(item, withCutoutStroke(item.cutout, stroke))
}

function clearCutoutStrokes(op: Op): CutoutResult {
  const item = videoItem(op)
  return store(item, withoutCutoutStrokes(item.cutout))
}

const OPS: Record<string, (op: Op) => CutoutResult> = {
  setCutout,
  addCutoutStroke,
  clearCutoutStrokes,
}

/** Apply a cutout op, or null when the op is another one. */
export function runCutoutOp(op: Op): CutoutResult | null {
  const name = String(op.op)
  return Object.hasOwn(OPS, name) ? OPS[name]!(op) : null
}
