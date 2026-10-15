import { describe, expect, it } from 'vite-plus/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { kitFieldGroups, kitValueText } from './style-kit-fields'

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../formats/kit-fixtures',
)
const stock = () =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, 'stock-kit.v3.json'), 'utf8')) as Record<
    string,
    unknown
  >

describe('kitFieldGroups', () => {
  it('reads fonts, the three text looks and the preference switches off a kit', () => {
    const groups = kitFieldGroups(stock())
    expect(groups.map((g) => g.id)).toEqual([
      'fonts',
      'titles',
      'captions',
      'overlays',
      'preferences',
    ])
    const titles = groups.find((g) => g.id === 'titles')!
    expect(titles.fields.map((f) => f.path)).toEqual([
      'titles.style.font',
      'titles.style.weight',
      'titles.style.size',
      'titles.style.color',
      'titles.style.box.color',
    ])
    expect(titles.fields[1]).toMatchObject({ kind: 'select', value: '700' })
    const fonts = groups.find((g) => g.id === 'fonts')!
    expect(fonts.fields[0]).toMatchObject({ path: 'fonts.classic.stack.0', kind: 'text' })
    const prefs = groups.find((g) => g.id === 'preferences')!
    expect(prefs.fields.map((f) => f.label)).toContain('Punch-ins')
    expect(prefs.fields.every((f) => f.kind === 'toggle')).toBe(true)
  })

  it('offers a font picked among options as a choice', () => {
    const kit = {
      ...stock(),
      fonts: {
        main: {
          choice: 'tiktok-sans',
          options: {
            'tiktok-sans': { label: 'TikTok Sans' },
            'instagram-sans': { label: 'Instagram Sans' },
          },
        },
      },
    }
    const font = kitFieldGroups(kit).find((g) => g.id === 'fonts')!.fields[0]!
    expect(font).toMatchObject({ path: 'fonts.main.choice', kind: 'select', value: 'tiktok-sans' })
    expect(font.options?.map((o) => o.label)).toEqual(['TikTok Sans', 'Instagram Sans'])
  })

  it('lists brand colours when the kit has them and leaves empty groups out', () => {
    const groups = kitFieldGroups({
      preferences: { brandColors: { on: true, colors: [{ hex: '#ff0000', job: 'Accent' }] } },
    })
    expect(groups.map((g) => g.id)).toEqual(['preferences'])
    expect(groups[0]!.fields[1]).toMatchObject({
      path: 'preferences.brandColors.colors.0.hex',
      label: 'Accent',
      kind: 'color',
    })
  })

  it('sends text as is and everything else as JSON', () => {
    expect(kitValueText('#ffffff')).toBe('#ffffff')
    expect(kitValueText(104)).toBe('104')
    expect(kitValueText(false)).toBe('false')
  })
})
