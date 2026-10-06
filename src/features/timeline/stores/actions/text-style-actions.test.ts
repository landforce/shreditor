import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import type { Project } from '@/types/project'
import { useProjectTextStylesStore } from '@/shared/state/text-styles'
import { makeTimelineTrack, resetTimelineCompositionTestState } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useCompositionsStore } from '../compositions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { buildTimelineFromStores, hydrateTimelineStoresFromProject } from '../timeline-persistence'
import { updateItem } from './item-actions'
import { updateItemTransform } from './transform-actions'
import {
  applyTextStyleToItems,
  removeProjectTextStyle,
  resetItemsToTextStyle,
  upsertProjectTextStyle,
} from './text-style-actions'

const CANVAS = { width: 1080, height: 1920 }
const track = makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 })

const vertical = {
  aspect: '9:16',
  style: { fontFamily: 'Inter', fontSize: 100, color: '#ffffff' },
  layout: { yRatio: -0.25 },
}
const landscape = { ...vertical, aspect: '16:9', style: { ...vertical.style, fontSize: 90 } }

const titleStyle: TextStyleDefinition = {
  id: 'title',
  name: 'Title',
  role: 'title',
  variants: [vertical, landscape],
  version: 1,
  updatedAt: 1,
}

/** The style with its 9:16 look changed (the 16:9 one as it is). */
const withVertical = (
  changes: Partial<typeof vertical>,
  version = 2,
  style: TextStyleDefinition = titleStyle,
): TextStyleDefinition => ({
  ...style,
  variants: style.variants.map((variant) =>
    variant.aspect === '9:16' ? { ...variant, ...changes } : variant,
  ),
  version,
})

function addLandscapeComposition(items: TextItem[]): void {
  useCompositionsStore.getState().addComposition({
    id: 'comp',
    name: 'Comp',
    tracks: [track],
    items,
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 30,
  })
}

const inner = () => useCompositionsStore.getState().getComposition('comp')?.items[0] as TextItem

function text(id: string, from: number): TextItem {
  return {
    id,
    type: 'text',
    trackId: 'v1',
    from,
    durationInFrames: 30,
    label: id,
    text: id,
    color: '#ff0000',
    transform: { x: 0, y: 0, width: 800, height: 200, rotation: 0, opacity: 1 },
  }
}

const item = (id: string) => useItemsStore.getState().itemById[id] as TextItem

function seedThreeStyledTitles(): void {
  useItemsStore.getState().setTracks([track])
  useItemsStore.getState().setItems([text('a', 0), text('b', 30), text('c', 60)])
  applyTextStyleToItems(['a', 'b', 'c'], titleStyle, CANVAS)
}

describe('text style actions', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectTextStylesStore.getState().setStyles([])
  })
  afterEach(() => resetTimelineCompositionTestState())

  it('applies a style: copies it into the project and links the items', () => {
    seedThreeStyledTitles()
    expect(useProjectTextStylesStore.getState().styles.map((s) => s.id)).toEqual(['title'])
    expect(item('a')).toMatchObject({
      textStyleId: 'title',
      color: '#ffffff',
      fontSize: 100,
      formatRole: 'title',
    })
    expect(item('a').transform?.y).toBe(-480)
  })

  it('records direct edits as overrides and propagation skips them', () => {
    seedThreeStyledTitles()
    updateItem('b', { color: '#00ff00' })
    updateItemTransform('c', { y: 300 })
    updateItem('a', { text: 'Only the words changed' })
    expect(item('b').textStyleOverrides).toEqual(['color'])
    expect(item('c').textStyleOverrides).toEqual(['transform.y'])
    expect(item('a').textStyleOverrides).toBeUndefined()

    const updated = upsertProjectTextStyle(
      withVertical({
        style: { ...vertical.style, color: '#ffd400', fontSize: 140 },
        layout: { yRatio: 0.1 },
      }),
      CANVAS,
    )
    expect(updated.sort()).toEqual(['a', 'b', 'c'])
    expect(item('a')).toMatchObject({
      color: '#ffd400',
      fontSize: 140,
      text: 'Only the words changed',
    })
    expect(item('a').transform?.y).toBe(192)
    expect(item('b')).toMatchObject({ color: '#00ff00', fontSize: 140 })
    expect(item('c').transform?.y).toBe(300)
    expect(item('c').color).toBe('#ffd400')
  })

  it('undoes a style edit and its propagation as one step', () => {
    seedThreeStyledTitles()
    upsertProjectTextStyle(withVertical({ style: { ...vertical.style, fontSize: 150 } }), CANVAS)
    expect(item('a').fontSize).toBe(150)
    useTimelineCommandStore.getState().undo()
    expect(item('a').fontSize).toBe(100)
    expect(item('c').fontSize).toBe(100)
    expect(useProjectTextStylesStore.getState().styles[0]?.version).toBe(1)
    useTimelineCommandStore.getState().redo()
    expect(item('b').fontSize).toBe(150)
  })

  it('resets an item to its style', () => {
    seedThreeStyledTitles()
    updateItem('b', { color: '#00ff00' })
    resetItemsToTextStyle(['b'], CANVAS)
    expect(item('b')).toMatchObject({ color: '#ffffff' })
    expect(item('b').textStyleOverrides).toBeUndefined()
  })

  it('deleting a used style detaches its items and keeps their look', () => {
    seedThreeStyledTitles()
    const detached = removeProjectTextStyle('title', CANVAS)
    expect(detached.sort()).toEqual(['a', 'b', 'c'])
    expect(useProjectTextStylesStore.getState().styles).toEqual([])
    expect(item('a').textStyleId).toBeUndefined()
    expect(item('a')).toMatchObject({ color: '#ffffff', fontSize: 100 })
  })

  it("restyles items inside compositions with the composition canvas's variant", () => {
    seedThreeStyledTitles()
    addLandscapeComposition([{ ...text('inner', 0), textStyleId: 'title' }])
    upsertProjectTextStyle({ ...titleStyle, version: 2 }, CANVAS)
    expect(inner()).toMatchObject({ color: '#ffffff', fontSize: 90 })
    expect(inner().transform?.y).toBe(-270)
  })

  it('an edit to one variant restyles only the items on canvases of its aspect', () => {
    seedThreeStyledTitles()
    addLandscapeComposition([{ ...text('inner', 0), textStyleId: 'title' }])
    upsertProjectTextStyle({ ...titleStyle, version: 2 }, CANVAS)
    const before = inner()
    const changed = upsertProjectTextStyle(
      withVertical({ style: { ...vertical.style, fontSize: 160 } }, 3),
      CANVAS,
    )
    expect(item('a').fontSize).toBe(160)
    expect(inner()).toEqual(before)
    // Its fields came out the same, so it was not rewritten.
    expect(changed).not.toContain('inner')
  })

  it('leaves items on a canvas the style has no variant for as they are', () => {
    seedThreeStyledTitles()
    const original = { ...text('inner', 0), textStyleId: 'title' }
    addLandscapeComposition([original])
    const verticalOnly = { ...titleStyle, variants: [vertical], version: 2 }
    expect(upsertProjectTextStyle(verticalOnly, CANVAS)).not.toContain('inner')
    expect(inner()).toEqual(original)
    applyTextStyleToItems(['inner'], verticalOnly, CANVAS)
    expect(inner()).toEqual(original)
  })

  it('round-trips styles and links through save and load', async () => {
    seedThreeStyledTitles()
    updateItem('b', { color: '#00ff00' })
    const timeline = buildTimelineFromStores()
    expect(timeline.textStyles?.map((s) => s.id)).toEqual(['title'])
    useProjectTextStylesStore.getState().setStyles([])
    const project: Project = {
      id: 'p',
      name: 'p',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 3,
      metadata: { ...CANVAS, fps: 30 },
      timeline: JSON.parse(JSON.stringify(timeline)),
    }
    await hydrateTimelineStoresFromProject(project)
    expect(useProjectTextStylesStore.getState().styles).toEqual(timeline.textStyles)
    expect(item('b')).toMatchObject({ textStyleId: 'title', textStyleOverrides: ['color'] })
  })

  it("loads an old single-look style as a variant for the project's aspect", async () => {
    const { variants: _variants, ...identity } = titleStyle
    await hydrateTimelineStoresFromProject({
      id: 'old',
      name: 'old',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 1,
      metadata: { width: 1280, height: 720, fps: 30 },
      timeline: {
        tracks: [track],
        items: [{ ...text('x', 0), textStyleId: 'title' }],
        textStyles: [{ ...identity, style: { fontSize: 70 } } as never],
      },
    })
    expect(useProjectTextStylesStore.getState().styles[0]?.variants).toEqual([
      { aspect: '16:9', style: { fontSize: 70 } },
    ])
    expect(buildTimelineFromStores().textStyles?.[0]).toHaveProperty('variants')
  })

  it('loads projects made before styles with none', async () => {
    useProjectTextStylesStore.getState().setStyles([titleStyle])
    await hydrateTimelineStoresFromProject({
      id: 'old',
      name: 'old',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 1,
      metadata: { ...CANVAS, fps: 30 },
      timeline: { tracks: [track], items: [text('x', 0)] },
    })
    expect(useProjectTextStylesStore.getState().styles).toEqual([])
    expect(buildTimelineFromStores().textStyles).toBeUndefined()
  })
})
