// Types for ./fonts.mjs.
import type { Kit } from './kit.mjs'

export interface FontAvailability {
  installed: Set<string>
  catalog: Set<string>
}

export interface FontResolution {
  family: string
  source: 'installed' | 'catalog' | 'missing'
  kitResolved: string | null
  families: Array<{
    family: string
    license: string | null
    status: 'installed' | 'catalog' | 'missing'
  }>
  weights: number[]
}

export function resolveFontStack(
  font: Kit['fonts'][string],
  available: FontAvailability,
): FontResolution
export function resolveKitFonts(
  kit: Kit,
  available: FontAvailability,
): Record<string, FontResolution>
export function describeKitFonts(fonts: Record<string, FontResolution>): string[]
