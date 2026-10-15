// Types for ./set.mjs.
import type { Kit } from './kit.mjs'
import type { KitChange } from './save-back.mjs'

export function kitPath(text: string): string[]
export function kitPairs(words: string[]): Array<[string, string]>
export function kitValue(text: string, current: unknown): unknown
export function kitWithValues(
  kit: Kit,
  pairs: Array<[string, string]>,
  options?: { force?: boolean },
): { kit: Kit; changes: KitChange[] }
