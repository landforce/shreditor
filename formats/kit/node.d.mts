// Types for ./node.mjs (Node only).
import type { Kit } from './kit.mjs'

export function resolveKitPath(input: string): string
export function kitHash(kit: Kit): string
export function readKitFile(input: string): {
  path: string
  kit: Kit
  hash: string
  warnings: string[]
}
export function writeKitFile(file: string, kit: Kit): void
export function installedFontFamilies(): Set<string>
export function catalogFontFamilies(repo?: string): Set<string>
