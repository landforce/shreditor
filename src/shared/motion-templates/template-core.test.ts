import { describe, expect, it } from 'vite-plus/test'
import {
  buildMotionTemplate,
  compositionClosure,
  findMotionTemplate,
  parseMotionTemplate,
  type StoredComposition,
} from './template-core.mjs'

const composition = (id: string, items: unknown[], extra: object = {}) =>
  ({
    id,
    name: id,
    items,
    tracks: [],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 60,
    ...extra,
  }) as unknown as StoredComposition

const text = {
  id: 'title',
  type: 'text',
  text: 'Jane',
  color: '#fff',
  label: 'Title',
  trackId: 't',
  from: 0,
  durationInFrames: 60,
}
const image = {
  id: 'logo',
  type: 'image',
  mediaId: 'm-logo',
  label: 'Logo',
  trackId: 't',
  from: 0,
  durationInFrames: 60,
}
const nestedRef = {
  id: 'nest',
  type: 'composition',
  compositionId: 'inner',
  trackId: 't',
  from: 0,
  durationInFrames: 60,
  label: 'Inner',
}
const root = composition('root', [text, nestedRef], {
  tracks: [{ id: 't', name: 'V1', items: [text] }],
  templateId: 'old',
  templateVersion: 3,
  inPoint: 4,
  compositionControls: {
    version: 1,
    controls: [
      {
        id: 'c1',
        name: 'Name',
        targetItemId: 'title',
        property: 'text.text',
        kind: 'text',
        defaultValue: 'Jane',
      },
    ],
  },
})
const inner = composition('inner', [image])
const unrelated = composition('other', [])

describe('template core', () => {
  it('collects the root and nested compositions only', () => {
    expect(compositionClosure('root', [unrelated, inner, root]).map((c) => c.id)).toEqual([
      'root',
      'inner',
    ])
  })

  it('builds a template: canvas, controls, media with file names, tags stripped', () => {
    const template = buildMotionTemplate({
      rootCompositionId: 'root',
      compositions: [root, inner, unrelated],
      name: '  Lower third ',
      category: 'lower-third',
      role: 'labels',
      mediaFileName: (id) => `${id}.png`,
      now: 5,
      newId: () => 'tpl',
    })
    expect(template).toMatchObject({
      formatVersion: 1,
      id: 'tpl',
      name: 'Lower third',
      version: 1,
      createdAt: 5,
      width: 1920,
      height: 1080,
      durationInFrames: 60,
      media: [{ mediaId: 'm-logo', fileName: 'm-logo.png' }],
    })
    expect(template.composition.editorKind).toBe('composite-2d')
    expect(template.composition).not.toHaveProperty('templateId')
    expect(template.composition).not.toHaveProperty('inPoint')
    // Tracks keep no stale item copies (the items list is the source).
    expect((template.composition.tracks[0] as { items?: unknown[] }).items).toEqual([])
    expect(template.subCompositions.map((c) => c.id)).toEqual(['inner'])
    expect(template.controls.map((c) => c.name)).toEqual(['Name'])
    expect(parseMotionTemplate(JSON.parse(JSON.stringify(template)))).toEqual(template)
  })

  it('saving again under an existing template bumps its version and keeps its id', () => {
    const template = buildMotionTemplate({
      rootCompositionId: 'root',
      compositions: [root, inner],
      name: 'Lower third',
      previous: { id: 'keep', version: 4, createdAt: 1 },
      now: 9,
    })
    expect([template.id, template.version, template.createdAt, template.updatedAt]).toEqual([
      'keep',
      5,
      1,
      9,
    ])
  })

  it('chosen controls replace the published ones and are validated', () => {
    const template = buildMotionTemplate({
      rootCompositionId: 'root',
      compositions: [root, inner],
      name: 'T',
      controls: [{ name: 'Colour', targetItemId: 'title', property: 'text.color' }],
      newId: () => 'id',
    })
    expect(template.controls).toEqual([
      {
        id: 'id',
        name: 'Colour',
        targetItemId: 'title',
        property: 'text.color',
        kind: 'color',
        defaultValue: '#fff',
      },
    ])
    expect(() =>
      buildMotionTemplate({
        rootCompositionId: 'root',
        compositions: [root, inner],
        name: 'T',
        controls: [
          { name: 'A', targetItemId: 'title', property: 'text.text' },
          { name: 'a', targetItemId: 'title', property: 'text.color' },
          { name: 'B', targetItemId: 'nest', property: 'text.text' },
        ],
      }),
    ).toThrow(/two controls are named "a".*|text.text does not apply/)
  })

  it('rejects bad metadata and malformed files', () => {
    expect(() =>
      buildMotionTemplate({ rootCompositionId: 'root', compositions: [root], name: '' }),
    ).toThrow(/needs a name/)
    expect(() =>
      buildMotionTemplate({
        rootCompositionId: 'root',
        compositions: [root],
        name: 'x',
        category: 'nope' as never,
      }),
    ).toThrow(/category/)
    expect(() =>
      buildMotionTemplate({ rootCompositionId: 'missing', compositions: [root], name: 'x' }),
    ).toThrow(/does not exist/)
    expect(() => parseMotionTemplate({ formatVersion: 2 })).toThrow(/formatVersion/)
    expect(() => parseMotionTemplate({ formatVersion: 1, id: '../x' })).toThrow(/invalid id/)
  })

  it('finds by id, then by name ignoring case; an ambiguous name throws', () => {
    const list = [
      { id: 'a', name: 'Title' },
      { id: 'b', name: 'title' },
      { id: 'c', name: 'Callout' },
    ]
    expect(findMotionTemplate(list, 'c')?.id).toBe('c')
    expect(findMotionTemplate(list, 'CALLOUT')?.id).toBe('c')
    expect(findMotionTemplate(list, 'missing')).toBeNull()
    expect(() => findMotionTemplate(list, 'TITLE')).toThrow(/use the id/)
  })
})
