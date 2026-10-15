// Wire schema for the background removal op (see src/headless/cutout-op.ts).
// contract.mjs adds it to the edit op union. The ranges match
// cutoutSettingsProblem in src/shared/cutout/cutout-core.mjs.
import { z } from 'zod'

const id = z.string().min(1)

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
]

export const CUTOUT_OP_DESCRIPTIONS = {
  setCutout:
    'Remove the background of a video clip (person, object or auto); masks are analysed from the source and applied at draw time',
}

export const CUTOUT_OP_NAMES = Object.keys(CUTOUT_OP_DESCRIPTIONS)
