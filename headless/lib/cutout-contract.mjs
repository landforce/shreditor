// Wire schemas for the background removal ops (see src/headless/cutout-op.ts).
// contract.mjs adds them to the edit op union. The ranges match
// cutoutSettingsProblem in src/shared/cutout/cutout-core.mjs and
// cutoutStrokeProblem in src/shared/cutout/cutout-strokes.mjs.
import { z } from 'zod'

const id = z.string().min(1)
const fraction = z.number().min(0).max(1)

export const CUTOUT_OP_SCHEMAS = [
  z
    .object({
      op: z.literal('setCutout'),
      id,
      enabled: z.boolean(),
      subject: z.enum(['auto', 'person', 'object']).optional(),
      feather: z.number().min(0).max(100).optional(),
      invert: z.boolean().optional(),
      refine: z.number().min(0).max(1).optional(),
      sampleRate: z.union([z.literal('full'), z.number().min(1).max(120)]).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addCutoutStroke'),
      id,
      tool: z.enum(['brush', 'eraser', 'smartBrush', 'smartEraser']),
      points: z.array(z.tuple([fraction, fraction])).min(1).max(512),
      size: z.number().gt(0).max(0.5).optional(),
      at: z.number().min(0),
    })
    .strict(),
  z.object({ op: z.literal('clearCutoutStrokes'), id }).strict(),
]

export const CUTOUT_OP_DESCRIPTIONS = {
  setCutout:
    'Remove the background of a video clip (person, object or auto); masks are analysed from the source and applied at draw time',
  addCutoutStroke:
    'Fix a cutout by painting on source frame `at` (s): points are source-frame fractions, size a radius (short-side fraction); smart tools track the region they hit',
  clearCutoutStrokes: 'Remove every brush stroke from a cut-out clip',
}

export const CUTOUT_OP_NAMES = Object.keys(CUTOUT_OP_DESCRIPTIONS)
