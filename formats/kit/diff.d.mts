// Types for ./diff.mjs.
import type { KitChange } from './save-back.mjs'

export function diffKits(before: unknown, after: unknown): KitChange[]
export function describeKitDiff(changes: KitChange[], limit?: number): string[]
