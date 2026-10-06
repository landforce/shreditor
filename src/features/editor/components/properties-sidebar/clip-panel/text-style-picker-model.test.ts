import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import {
  buildTextStylePickerGroups,
  duplicateTextStyle,
  libraryStateOf,
  newTextStyleFromItem,
  textStyleUpdatedFromItem,
  textStyleWithVersionFor,
} from './text-style-picker-model'

const VERTICAL = { width: 1080, height: 1920 }
const LANDSCAPE = { width: 1920, height: 1080 }

const style = (id: string, role: TextStyleDefinition['role'], extra = {}): TextStyleDefinition => ({
  id,
  name: id,
  role,
  variants: [{ aspect: '9:16', style: { fontSize: 80 } }],
  version: 1,
  updatedAt: 1,
  ...extra,
})

const textItem = (extra: Partial<TextItem> = {}): TextItem =>
  ({
    id: 'i',
    type: 'text',
    trackId: 't',
    from: 0,
    durationInFrames: 45,
    label: '',
    text: 'x',
    color: '#abc',
    fontSize: 72,
    ...extra,
  }) as TextItem

describe('text style picker model', () => {
  it('lists project styles, then library styles not in the project, suggesting the track role', () => {
    const groups = buildTextStylePickerGroups(
      [style('b-title', 'title'), style('a-caps', 'caption')],
      [style('a-caps', 'caption'), style('lib-label', 'label'), style('lib-caps', 'caption')],
      'captions',
    )
    expect(groups.project.map((e) => [e.style.id, e.suggested])).toEqual([
      ['a-caps', true],
      ['b-title', false],
    ])
    expect(groups.library.map((e) => e.style.id)).toEqual(['lib-caps', 'lib-label'])
  })

  it('offers styles with no look for the canvas last, marked', () => {
    const wide = style('wide', 'title', { variants: [{ aspect: '16:9', style: {} }] })
    const groups = buildTextStylePickerGroups([style('a', 'title'), wide], [], 'title', LANDSCAPE)
    expect(groups.project.map((e) => [e.style.id, e.fits])).toEqual([
      ['wide', true],
      ['a', false],
    ])
  })

  it("makes a version for the canvas's aspect from the closest one", () => {
    const made = textStyleWithVersionFor(style('a', 'title'), LANDSCAPE)
    expect(made.version).toBe(2)
    expect(made.variants.map((v) => [v.aspect, v.style.fontSize])).toEqual([
      ['9:16', 80],
      ['16:9', 80],
    ])
  })

  it("updates only the item's aspect's variant from the item", () => {
    const both = textStyleWithVersionFor(style('a', 'title'), LANDSCAPE)
    const updated = textStyleUpdatedFromItem(both, textItem({ fontSize: 60 }), LANDSCAPE)
    expect(updated.version).toBe(3)
    expect(updated.variants.map((v) => [v.aspect, v.style.fontSize])).toEqual([
      ['9:16', 80],
      ['16:9', 60],
    ])
  })

  it('compares a project copy with the library ignoring version and time', () => {
    const copy = style('t', 'title', { version: 4, updatedAt: 9 })
    expect(libraryStateOf(copy, [])).toBe('missing')
    expect(libraryStateOf(copy, [style('t', 'title')])).toBe('same')
    expect(
      libraryStateOf(copy, [
        style('t', 'title', { variants: [{ aspect: '9:16', style: { fontSize: 90 } }] }),
      ]),
    ).toBe('differs')
    // A version only the project has: save it to the library, nothing to take from it.
    const both = textStyleWithVersionFor(style('t', 'title'), LANDSCAPE)
    expect(libraryStateOf(both, [style('t', 'title')])).toBe('ahead')
  })

  it('makes a new style from an item and refuses a taken name', () => {
    const item = textItem()
    const made = newTextStyleFromItem(item, { name: 'Hook', role: 'title' }, VERTICAL, [])
    expect(made).toMatchObject({
      id: 'hook',
      role: 'title',
      defaultDurationFrames: 45,
      variants: [{ aspect: '9:16', style: { color: '#abc', fontSize: 72 } }],
    })
    expect(() =>
      newTextStyleFromItem(item, { name: 'hook', role: 'title' }, { width: 1080, height: 1920 }, [
        made,
      ]),
    ).toThrow()
    expect(duplicateTextStyle(made, 'Hook copy', [made])).toMatchObject({
      id: 'hook-copy',
      version: 1,
    })
  })
})
