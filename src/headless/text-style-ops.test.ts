import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import { validateProject } from '@/features/project-bundle/schemas/project-schema'
import { editProject, type EditOp, type HeadlessEditInput } from './edit'

function project(
  timeline: Partial<ProjectTimeline> = {},
  canvas = { width: 1080, height: 1920 },
): Project {
  return {
    id: 'p',
    name: 'styles',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 10,
    schemaVersion: 14,
    metadata: { ...canvas, fps: 30 },
    timeline: {
      tracks: [
        {
          id: 'v1',
          name: 'V1',
          kind: 'video',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
        },
        {
          id: 'txt',
          name: 'Titles',
          kind: 'video',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: -1,
        },
        {
          id: 'cap',
          name: 'Captions',
          kind: 'video',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          formatRole: 'captions',
        },
      ],
      items: [
        {
          id: 'clip',
          type: 'video',
          trackId: 'v1',
          from: 0,
          durationInFrames: 90,
          label: 'talk',
          mediaId: 'm1',
          src: '',
          sourceStart: 30,
          sourceEnd: 120,
          sourceDuration: 200,
          sourceFps: 30,
          speed: 1,
        },
      ],
      ...timeline,
    } as ProjectTimeline,
  } as Project
}

const LANDSCAPE = { width: 1920, height: 1080 }

const kitTitleLook = {
  aspect: '9:16',
  style: {
    fontFamily: 'Anton',
    fontSize: 130,
    color: '#ffffff',
    stroke: { width: 4, color: '#000000' },
  },
  layout: { yRatio: -0.3, widthRatio: 0.9 },
}

const library = [
  {
    id: 'kit-title',
    name: 'Kit Title',
    role: 'title',
    variants: [kitTitleLook],
    defaultDurationFrames: 75,
    version: 1,
    updatedAt: 1,
  },
  // An old single-look style, as libraries saved before variants: a 9:16 look.
  {
    id: 'kit-captions',
    name: 'Kit Captions',
    role: 'caption',
    style: { fontFamily: 'Inter', fontWeight: 'bold', fontSize: 64, color: '#ffd400' },
    layout: { yRatio: 0.25, widthRatio: 0.85, heightRatio: 0.12 },
    caption: {
      maxWordsPerChunk: 3,
      maxCharsPerLine: 18,
      maxLines: 2,
      minChunkFrames: 10,
      case: 'upper',
    },
    version: 1,
    updatedAt: 1,
  },
] as unknown as TextStyleDefinition[]

const words = 'so here is the thing about styles that you reuse'.split(' ')
const transcripts = [
  {
    mediaId: 'm1',
    segments: [
      {
        text: words.join(' '),
        start: 0.5,
        end: 5.5,
        words: words.map((text, index) => ({
          text,
          start: 0.5 + index * 0.5,
          end: 0.9 + index * 0.5,
        })),
      },
    ],
  },
]

const run = (ops: EditOp[], base = project(), extra: Partial<HeadlessEditInput> = {}) =>
  editProject({ project: base, ops, textStyleLibrary: library, transcripts, ...extra })

const items = (p: Project) => p.timeline!.items as TextItem[]
const byId = (p: Project, id: string) => items(p).find((item) => item.id === id)!

describe('headless text style ops', () => {
  it('addText with styleId copies the library style in and applies it; op fields win as overrides', async () => {
    const result = await run([
      { op: 'addText', id: 't1', text: 'One', styleId: 'Kit Title', trackId: 'txt', from: 0 },
      {
        op: 'addText',
        id: 't2',
        text: 'Two',
        styleId: 'kit-title',
        trackId: 'txt',
        from: 75,
        color: '#ff0000',
      },
    ])
    const p = result.project
    expect(p.timeline?.textStyles?.map((s) => s.id)).toEqual(['kit-title'])
    expect(byId(p, 't1')).toMatchObject({
      textStyleId: 'kit-title',
      formatRole: 'title',
      fontFamily: 'Anton',
      fontSize: 130,
      durationInFrames: 75,
    })
    expect(byId(p, 't1').transform).toMatchObject({ y: -576, width: 972 })
    expect(byId(p, 't2')).toMatchObject({ color: '#ff0000', textStyleOverrides: ['color'] })
  })

  it('upsertTextStyle restyles every linked item and keeps overrides', async () => {
    const first = await run([
      { op: 'addText', id: 't1', text: 'One', styleId: 'kit-title', trackId: 'txt', from: 0 },
      {
        op: 'addText',
        id: 't2',
        text: 'Two',
        styleId: 'kit-title',
        trackId: 'txt',
        from: 75,
        color: '#ff0000',
      },
    ])
    const second = await run(
      [
        {
          op: 'upsertTextStyle',
          style: {
            ...library[0],
            variants: [
              {
                ...kitTitleLook,
                style: { ...kitTitleLook.style, color: '#00e5ff', fontSize: 150 },
              },
            ],
          },
        },
      ],
      first.project,
    )
    expect(second.results[0]?.detail).toMatchObject({
      styleId: 'kit-title',
      version: 2,
      updatedItems: ['t1', 't2'],
    })
    expect(byId(second.project, 't1')).toMatchObject({ color: '#00e5ff', fontSize: 150 })
    expect(byId(second.project, 't2')).toMatchObject({ color: '#ff0000', fontSize: 150 })
  })

  it('applyTextStyle links existing text and sets its format role', async () => {
    const first = await run([
      { op: 'addText', id: 'plain', text: 'Plain', trackId: 'txt', from: 0 },
    ])
    const result = await run(
      [{ op: 'applyTextStyle', ids: ['plain'], styleId: 'Kit Title' }],
      first.project,
    )
    expect(byId(result.project, 'plain')).toMatchObject({
      textStyleId: 'kit-title',
      formatRole: 'title',
      fontSize: 130,
    })
  })

  it('upsertTextStyle fromItemId saves an item look as a style and links it', async () => {
    const first = await run([
      {
        op: 'addText',
        id: 'look',
        text: 'Look',
        trackId: 'txt',
        from: 0,
        fontSize: 90,
        color: '#123456',
      },
    ])
    const result = await run(
      [{ op: 'upsertTextStyle', fromItemId: 'look', name: 'My Label', role: 'label' }],
      first.project,
    )
    const style = result.project.timeline?.textStyles?.[0]
    expect(style).toMatchObject({
      id: 'my-label',
      role: 'label',
      variants: [{ aspect: '9:16', style: { fontSize: 90, color: '#123456' } }],
    })
    expect(byId(result.project, 'look')).toMatchObject({
      textStyleId: 'my-label',
      formatRole: 'labels',
    })
  })

  it('addCaptions captions the clip source window on the format captions track', async () => {
    const result = await run([{ op: 'addCaptions', clipId: 'clip', styleId: 'kit-captions' }])
    const detail = result.results[0]?.detail as { created: string[]; trackId: string }
    expect(detail.trackId).toBe('cap')
    const captions = detail.created.map((id) => byId(result.project, id))
    // Source starts at 1.0 s, so "so" (0.5-0.9 s) is outside the window.
    // The window ends at 4.0 s, so "that" (4.0-4.4 s) is outside it too.
    expect(captions.map((c) => c.text)).toEqual(['HERE IS THE', 'THING ABOUT STYLES'])
    expect(captions[0]).toMatchObject({
      textRole: 'caption',
      formatRole: 'captions',
      textStyleId: 'kit-captions',
      color: '#ffd400',
      from: 0,
    })
  })

  it('addCaptions adds a captions track above the clip with whole track orders', async () => {
    const base = project()
    base.timeline!.tracks = base.timeline!.tracks.filter((track) => track.id === 'v1')
    const result = await run([{ op: 'addCaptions', clipId: 'clip', styleId: 'kit-captions' }], base)
    const tracks = result.project.timeline!.tracks
    const { trackId } = result.results[0]!.detail as { trackId: string }
    expect(
      tracks.map((track) => [track.id === trackId ? 'captions' : track.id, track.order]),
    ).toEqual([
      ['captions', 1],
      ['v1', 2],
    ])
    expect(validateProject(JSON.parse(JSON.stringify(result.project))).success).toBe(true)
  })

  it('addCaptions explains a missing transcript and a clip without speech', async () => {
    await expect(
      run([{ op: 'addCaptions', clipId: 'clip', styleId: 'kit-captions' }], project(), {
        transcripts: [],
      }),
    ).rejects.toThrow(/has no transcript yet/)
    const silent = project()
    ;(silent.timeline!.items[0] as { sourceStart: number }).sourceStart = 170
    ;(silent.timeline!.items[0] as { sourceEnd: number }).sourceEnd = 180
    ;(silent.timeline!.items[0] as { durationInFrames: number }).durationInFrames = 10
    await expect(
      run([{ op: 'addCaptions', clipId: 'clip', styleId: 'kit-captions' }], silent),
    ).rejects.toThrow(/no speech/)
  })

  it('rejects unknown styles and invalid style fields', async () => {
    await expect(run([{ op: 'applyTextStyle', ids: ['clip'], styleId: 'nope' }])).rejects.toThrow(
      /no text style "nope"/,
    )
    await expect(
      run([
        {
          op: 'upsertTextStyle',
          style: { name: 'Bad', role: 'title', style: { fontWeight: 'black' } },
        },
      ]),
    ).rejects.toThrow(/fontWeight/)
  })

  it('fails clearly in a project whose aspect a style has no version for', async () => {
    const wide = project({}, LANDSCAPE)
    const missing =
      'no 16:9 version (it has 9:16). Make one from the closest: shred styles clone kit-title --aspect 16:9 --project p'
    await expect(
      run(
        [{ op: 'addText', id: 't', text: 'x', styleId: 'Kit Title', trackId: 'txt', from: 0 }],
        wide,
      ),
    ).rejects.toThrow(missing)
    await expect(
      run([{ op: 'addCaptions', clipId: 'clip', styleId: 'kit-captions' }], wide),
    ).rejects.toThrow(/styleId: text style "Kit Captions" has no 16:9 version/)
  })

  it('a style given a 16:9 version is used in 16:9 and its 9:16 look is kept', async () => {
    const wide = project({}, LANDSCAPE)
    const landscapeLook = { ...kitTitleLook, aspect: '16:9', layout: { yRatio: -0.2 } }
    const result = await run(
      [
        {
          op: 'upsertTextStyle',
          style: { ...library[0], variants: [kitTitleLook, landscapeLook] },
        },
        { op: 'addText', id: 't', text: 'x', styleId: 'kit-title', trackId: 'txt', from: 0 },
        // One look without an aspect is the project's aspect.
        {
          op: 'upsertTextStyle',
          style: {
            name: 'Kit Title',
            role: 'title',
            style: { ...kitTitleLook.style, fontSize: 100 },
          },
        },
      ],
      wide,
    )
    const style = result.project.timeline?.textStyles?.[0]
    expect(style?.variants.map((v) => [v.aspect, v.style.fontSize])).toEqual([
      ['9:16', 130],
      ['16:9', 100],
    ])
    expect(byId(result.project, 't')).toMatchObject({ textStyleId: 'kit-title', fontSize: 100 })
    expect(byId(result.project, 't').transform?.y).toBe(-216)
  })
})
