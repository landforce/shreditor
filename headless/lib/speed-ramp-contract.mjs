// Wire schemas for the speed ramp ops (see src/headless/speed-ramp-ops.ts).
// contract.mjs adds them to the edit op union. The browser checks the keys
// against the clip (frames inside it, the source window against the media).
import { z } from 'zod'
import {
  MAX_SPEED,
  MIN_SPEED,
  SPEED_RAMP_PRESETS,
} from '../../src/shared/timeline/speed-ramp.mjs'

const id = z.string().min(1)
const speed = z.number().min(MIN_SPEED).max(MAX_SPEED)
// Easing names only on the wire (a custom curve: addKeyframe on the `speed` lane).
const easing = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'])
const key = z
  .object({ frame: z.number().int().nonnegative(), speed, easing: easing.optional() })
  .strict()

export const SPEED_RAMP_OP_SCHEMAS = [
  z
    .object({
      op: z.literal('setSpeedRamp'),
      id,
      // Clip-local frames; [] removes the ramp. Or a preset with its options.
      keys: z.array(key).optional(),
      preset: z.enum(SPEED_RAMP_PRESETS).optional(),
      frame: z.number().int().nonnegative().optional(),
      speed: speed.optional(),
      baseSpeed: speed.optional(),
      startSpeed: speed.optional(),
      endSpeed: speed.optional(),
      holdFrames: z.number().int().nonnegative().optional(),
      rampFrames: z.number().int().positive().optional(),
      // false: only this clip, not its linked audio (they drift apart).
      linked: z.boolean().optional(),
    })
    .strict()
    .refine((value) => (value.keys === undefined) !== (value.preset === undefined), {
      message: 'setSpeedRamp needs exactly one of keys or preset',
      path: ['keys'],
    }),
  z.object({ op: z.literal('clearSpeedRamp'), id, linked: z.boolean().optional() }).strict(),
]

export const SPEED_RAMP_OP_DESCRIPTIONS = {
  setSpeedRamp: 'Set a clip speed ramp (keys or preset); linked audio follows',
  clearSpeedRamp: 'Remove a clip speed ramp',
}

export const SPEED_RAMP_OP_NAMES = Object.keys(SPEED_RAMP_OP_DESCRIPTIONS)
