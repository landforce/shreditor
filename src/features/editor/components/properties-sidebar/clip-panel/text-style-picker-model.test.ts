import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import {
  buildTextStylePickerGroups,
  duplicateTextStyle,
  libraryStateOf,
  newTextStyleFromItem,
} from './text-style-picker-model'

const style = (id: string, role: TextStyleDefinition['role'], extra = {}): TextStyleDefinition => ({
  id,
  name: id,
  role,
  style: { fontSize: 80 },
  version: 1,
  updatedAt: 1,
  ...extra,
})

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

  it('compares a project copy with the library ignoring version and time', () => {
    const copy = style('t', 'title', { version: 4, updatedAt: 9 })
    expect(libraryStateOf(copy, [])).toBe('missing')
    expect(libraryStateOf(copy, [style('t', 'title')])).toBe('same')
    expect(libraryStateOf(copy, [style('t', 'title', { style: { fontSize: 90 } })])).toBe('differs')
  })

  it('makes a new style from an item and refuses a taken name', () => {
    const item = {
      id: 'i',
      type: 'text',
      trackId: 't',
      from: 0,
      durationInFrames: 45,
      label: '',
      text: 'x',
      color: '#abc',
      fontSize: 72,
    } as TextItem
    const made = newTextStyleFromItem(
      item,
      { name: 'Hook', role: 'title' },
      { width: 1080, height: 1920 },
      [],
    )
    expect(made).toMatchObject({
      id: 'hook',
      role: 'title',
      defaultDurationFrames: 45,
      style: { color: '#abc', fontSize: 72 },
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
