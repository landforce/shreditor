import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { buildEffectCatalog } from './effect-catalog'

const CATALOG_FILE = path.resolve(__dirname, '../../../headless/lib/effect-catalog.json')

describe('effect catalog', () => {
  it('matches headless/lib/effect-catalog.json (UPDATE_EFFECT_CATALOG=1 rewrites it)', () => {
    const expected = `${JSON.stringify(buildEffectCatalog(), null, 2)}\n`
    if (process.env.UPDATE_EFFECT_CATALOG) fs.writeFileSync(CATALOG_FILE, expected)
    expect(fs.readFileSync(CATALOG_FILE, 'utf8')).toBe(expected)
  })

  it('describes colour effects with numeric ranges', () => {
    const exposure = buildEffectCatalog().find((effect) => effect.id === 'gpu-exposure')
    expect(exposure?.category).toBe('color')
    const ranged = Object.values(exposure?.params ?? {}).filter((param) => param.type === 'number')
    expect(ranged.length).toBeGreaterThan(0)
    for (const param of ranged)
      expect(typeof param.min === 'number' && typeof param.max === 'number').toBe(true)
  })
})
