import { describe, expect, it } from 'vite-plus/test'
import {
  buildMotionTemplate,
  chooseTemplateVariant,
  compositionClosure,
  findMotionTemplate,
  parseMotionTemplate,
  parseTemplateHold,
  templateAspects,
  templateVariant,
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
      formatVersion: 2,
      id: 'tpl',
      name: 'Lower third',
      version: 1,
      createdAt: 5,
      media: [{ mediaId: 'm-logo', fileName: 'm-logo.png' }],
    })
    expect(templateAspects(template)).toEqual(['16:9'])
    const variant = template.variants['16:9']!
    expect(variant).toMatchObject({
      aspect: '16:9',
      version: 1,
      width: 1920,
      height: 1080,
      durationInFrames: 60,
      thumbnail: 'thumbnail-16x9.webp',
    })
    expect(variant.composition.editorKind).toBe('composite-2d')
    expect(variant.composition).not.toHaveProperty('templateId')
    expect(variant.composition).not.toHaveProperty('inPoint')
    // Tracks keep no stale item copies (the items list is the source).
    expect((variant.composition.tracks[0] as { items?: unknown[] }).items).toEqual([])
    expect(variant.subCompositions.map((c) => c.id)).toEqual(['inner'])
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
    expect(template.variants['16:9']!.controls).toEqual([
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
    expect(() => parseMotionTemplate({ formatVersion: 3 })).toThrow(/formatVersion/)
    expect(() => parseMotionTemplate({ formatVersion: 1, id: '../x' })).toThrow(/invalid id/)
    expect(() =>
      parseMotionTemplate({ formatVersion: 2, id: 'x', name: 'x', version: 1, variants: {} }),
    ).toThrow(/no variants/)
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

const portrait = composition('portrait', [text], {
  width: 1080,
  height: 1920,
  compositionControls: {
    version: 1,
    controls: [
      {
        id: 'p1',
        name: 'name',
        targetItemId: 'title',
        property: 'text.color',
        kind: 'color',
        defaultValue: '#fff',
      },
    ],
  },
})

/** A format 1 file, as the library wrote it before variants. */
const format1 = {
  formatVersion: 1,
  id: 'old-tpl',
  name: 'Old',
  category: 'title',
  version: 3,
  createdAt: 1,
  updatedAt: 2,
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 60,
  composition: { ...root, width: 1080, height: 1920 },
  subCompositions: [inner],
  controls: [],
  media: [{ mediaId: 'm-logo', fileName: 'logo.png' }],
}

describe('template variants', () => {
  it('reads a format 1 file as a family with one variant (its version and thumbnail kept)', () => {
    const template = parseMotionTemplate(structuredClone(format1))
    expect(template).toMatchObject({ formatVersion: 2, id: 'old-tpl', version: 3 })
    expect(templateAspects(template)).toEqual(['9:16'])
    expect(template.variants['9:16']).toMatchObject({
      aspect: '9:16',
      version: 3,
      width: 1080,
      height: 1920,
      thumbnail: 'thumbnail.jpg',
    })
    expect(template.controls.map((c) => c.name)).toEqual(['Name'])
    expect(template.media).toEqual([{ mediaId: 'm-logo', fileName: 'logo.png' }])
    // Saving it again writes format 2 and keeps the variant (by aspect).
    const again = parseMotionTemplate(JSON.parse(JSON.stringify(template)))
    expect(again).toEqual(template)
  })

  it('saving another aspect adds a variant; saving the same aspect replaces it', () => {
    const first = buildMotionTemplate({
      rootCompositionId: 'root',
      compositions: [root, inner],
      name: 'Lower third',
      now: 1,
      newId: () => 'tpl',
    })
    const portraitRoot = { ...root, width: 1080, height: 1920 } as StoredComposition
    const second = buildMotionTemplate({
      rootCompositionId: 'root',
      compositions: [portraitRoot, inner],
      name: 'Lower third',
      previous: first,
      hold: { start: 20, end: 30 },
      now: 2,
    })
    expect(templateAspects(second)).toEqual(['9:16', '16:9'])
    expect([
      second.version,
      second.variants['9:16']!.version,
      second.variants['16:9']!.version,
    ]).toEqual([2, 2, 1])
    expect(second.variants['9:16']!.hold).toEqual({ start: 20, end: 30 })
    // undefined keeps the variant's hold, null clears it.
    const kept = buildMotionTemplate({
      rootCompositionId: 'root',
      compositions: [portraitRoot, inner],
      name: 'Lower third',
      previous: second,
    })
    expect(kept.variants['9:16']!.hold).toEqual({ start: 20, end: 30 })
    const cleared = buildMotionTemplate({
      rootCompositionId: 'root',
      compositions: [portraitRoot, inner],
      name: 'Lower third',
      previous: kept,
      hold: null,
    })
    expect(cleared.variants['9:16']!.hold).toBeUndefined()
    expect(templateAspects(cleared)).toEqual(['9:16', '16:9'])
  })

  it('controls are shared by name: the same name must be the same kind in every variant', () => {
    const first = buildMotionTemplate({
      rootCompositionId: 'root',
      compositions: [root, inner],
      name: 'T',
    })
    expect(() =>
      buildMotionTemplate({
        rootCompositionId: 'portrait',
        compositions: [portrait],
        name: 'T',
        previous: first,
      }),
    ).toThrow(/control "name" is color in 9:16 but text in 16:9/)
  })

  it('a hold must lie inside the template', () => {
    expect(() =>
      buildMotionTemplate({
        rootCompositionId: 'root',
        compositions: [root, inner],
        name: 'T',
        hold: { start: 10, end: 60 },
      }),
    ).toThrow(/past the template's last frame \(59\)/)
    expect(parseTemplateHold('45')).toEqual({ start: 45, end: 45 })
    expect(parseTemplateHold(' 40 - 80 ')).toEqual({ start: 40, end: 80 })
    expect(parseTemplateHold('none')).toBeNull()
    expect(() => parseTemplateHold('soon')).toThrow(/must be a frame/)
  })

  it('a canvas picks the variant with its aspect ratio, at any resolution; none is an error', () => {
    const template = parseMotionTemplate(structuredClone(format1))
    expect(chooseTemplateVariant(template, { width: 720, height: 1280 })).toMatchObject({
      id: 'old-tpl',
      aspect: '9:16',
      version: 3,
      width: 1080,
    })
    expect(templateVariant(template, '16:9')).toBeNull()
    expect(() => chooseTemplateVariant(template, { width: 1920, height: 1080 })).toThrow(
      '"Old" has no 16:9 version (it has 9:16). Make one with: shred motion clone "Old" --aspect 16:9',
    )
  })
})
