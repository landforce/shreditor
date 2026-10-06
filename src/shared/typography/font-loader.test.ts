// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { isFontFamilyInstalled, shouldFetchGoogleFont } from './font-loader'

/** Fake canvas metrics: generics have fixed widths, installed families their own. */
function measurer(installed: Record<string, number>) {
  const generics: Record<string, number> = { monospace: 600, serif: 510, 'sans-serif': 520 }
  return (cssFont: string): number => {
    const family = /"([^"]+)"/.exec(cssFont)?.[1]
    if (family && installed[family] !== undefined) return installed[family]
    const generic = cssFont.split(/,\s*|\s+/).at(-1)!
    return generics[generic]!
  }
}

describe('isFontFamilyInstalled', () => {
  it('is false for a family that falls back to every generic', () => {
    expect(isFontFamilyInstalled('Neue Haas Display', measurer({}))).toBe(false)
  })

  it('is true for an installed family, even one that coincides with a generic', () => {
    // Helvetica is the macOS sans-serif, so it only differs from monospace and serif.
    expect(isFontFamilyInstalled('Helvetica', measurer({ Helvetica: 520 }))).toBe(true)
    expect(isFontFamilyInstalled('Helvetica Neue', measurer({ 'Helvetica Neue': 547 }))).toBe(true)
  })
})

describe('shouldFetchGoogleFont', () => {
  it('never fetches an installed system family (Google would shadow it)', () => {
    expect(shouldFetchGoogleFont('Helvetica Neue', () => true)).toBe(false)
    expect(shouldFetchGoogleFont('Avenir Next', () => true)).toBe(false)
  })

  it('still fetches catalog Google fonts, installed or not', () => {
    expect(shouldFetchGoogleFont('Inter', () => true)).toBe(true)
    expect(shouldFetchGoogleFont('Montserrat', () => false)).toBe(true)
  })

  it('tries Google for an unknown family that is not installed', () => {
    expect(shouldFetchGoogleFont('Some Web Font', () => false)).toBe(true)
  })
})
