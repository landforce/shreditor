// Wire schemas for the motion template and composition ops (see
// src/headless/template-ops.ts). contract.mjs adds them to the edit op union.
import { z } from 'zod'

const id = z.string().min(1)
const frame = z.number().int().nonnegative()
const positiveFrames = z.number().int().positive()
const controlProperty = z.enum(['text.text', 'text.color', 'shape.fillColor', 'shape.strokeColor'])
// Control values by control name: text for text controls, a CSS colour for colour ones.
const controlValues = z
  .record(z.string().min(1), z.string())
  .refine((value) => Object.keys(value).length > 0, 'controls must not be empty')

export const TEMPLATE_OP_SCHEMAS = [
  z
    .object({
      op: z.literal('addTemplate'),
      template: z.string().min(1),
      from: frame.optional(),
      durationInFrames: positiveFrames.optional(),
      trackId: id.optional(),
      controls: controlValues.optional(),
    })
    .strict(),
  z.object({ op: z.literal('updateTemplate'), template: z.string().min(1) }).strict(),
  z
    .object({
      op: z.literal('setTemplateControls'),
      id,
      // null resets a control to the template's own value.
      controls: z
        .record(z.string().min(1), z.string().nullable())
        .refine((value) => Object.keys(value).length > 0, 'controls must not be empty'),
    })
    .strict(),
  z
    .object({
      op: z.literal('createComposition'),
      ids: z.array(id).min(1),
      name: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      op: z.literal('setCompositionControls'),
      compositionId: id,
      controls: z.array(
        z
          .object({
            name: z.string().trim().min(1).max(60),
            targetItemId: id,
            property: controlProperty,
            defaultValue: z.string().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
]

export const TEMPLATE_OP_DESCRIPTIONS = {
  addTemplate:
    'Place an instance of a library motion template: its version for the project aspect ratio (returns the composition item id)',
  updateTemplate: "Move every instance of a template to the library's latest version",
  setTemplateControls: "Change a template instance's control values by control name",
  createComposition: 'Group items into a layer composition (they keep their ids inside it)',
  setCompositionControls: "Set a composition's published controls (name, target item, property)",
}

export const TEMPLATE_OP_NAMES = Object.keys(TEMPLATE_OP_DESCRIPTIONS)
