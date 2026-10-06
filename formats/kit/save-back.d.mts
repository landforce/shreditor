// Types for ./save-back.mjs.
import type { Kit } from './kit.mjs'
import type { KitStyleInput } from './mapping.mjs'

export interface KitChange {
  path: string
  from: unknown
  to: unknown
}

export function kitWithStyles(
  kit: Kit,
  styles: KitStyleInput[],
  options: { familyFor: (fontKey: string) => string },
): { kit: Kit; changes: KitChange[]; notes: string[] }
export function withChangelogEntry(
  kit: Kit,
  changes: KitChange[],
  options?: { now?: Date; why?: string },
): Kit
