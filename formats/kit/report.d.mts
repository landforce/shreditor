// Types for ./report.mjs.
import type { FormatTarget } from '../registry.mjs'
import type { Kit } from './kit.mjs'

export function describePreferences(preferences?: Kit['preferences']): string[]
export function kitTargetOverrides(kit: Kit): Record<string, Partial<FormatTarget>>
export function kitReferenceFrames(
  kit: Kit,
): Array<{ format: string; name: string; path: string; placeholder: boolean | null }>
export function describeReferenceFrames(kit: Kit, folder?: string): string[]
export function kitBrandColors(kit: Kit): Array<{ hex: string; job?: string }>
export function describeMapping(kit: Kit): { mapped: string[]; unmapped: string[] }
export function summarizeKit(kit: Kit): string[]
