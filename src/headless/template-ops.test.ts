import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import type { CompositionItem } from '@/types/timeline'
import {
  buildMotionTemplate,
  parseMotionTemplate,
  type MotionTemplate,
} from '@/shared/motion-templates/template-core.mjs'
import { editProject, type EditOp } from './edit'

const track = (id: string, order: number, kind: 'video' | 'audio' = 'video') => ({
  id,
  name: id,
  kind,
  height: 60,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order,
  items: [],
})

function project(
  width: number,
  height: number,
  timeline: Partial<ProjectTimeline> = {},
  id = 'p',
): Project {
  return {
    id,
    name: id,
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 10,
    schemaVersion: 14,
    metadata: { width, height, fps: 30 },
    timeline: {
      tracks: [track('v1', 0), track('v2', 1)],
      items: [],
      transitions: [],
      keyframes: [],
      ...timeline,
    } as ProjectTimeline,
  } as Project
}

/** A lower third: a bar and two text lines, built and grouped through ops. */
const LOWER_THIRD_OPS = [
  {
    op: 'addItem',
    callerId: 'bar',
    item: {
      id: 'bar',
      type: 'shape',
      shapeType: 'rectangle',
      trackId: 'v2',
      from: 0,
      durationInFrames: 60,
      label: 'Bar',
      fillColor: '#ff0000',
    },
  },
  {
    op: 'addText',
    callerId: 't1',
    id: 'title',
    text: 'Jane Doe',
    trackId: 'v1',
    from: 0,
    durationInFrames: 60,
    label: 'Title',
  },
  { op: 'addKeyframe', callerId: 'k1', itemId: 'title', property: 'opacity', frame: 0, value: 0 },
  { op: 'addKeyframe', callerId: 'k2', itemId: 'title', property: 'opacity', frame: 10, value: 1 },
  { op: 'createComposition', callerId: 'group', ids: ['bar', 'title'], name: 'Lower third' },
  {
    op: 'setCompositionControls',
    callerId: 'controls',
    compositionId: { $ref: 'group#/detail/compositionId' },
    controls: [
      { name: 'Name', targetItemId: 'title', property: 'text.text' },
      { name: 'Bar colour', targetItemId: 'bar', property: 'shape.fillColor' },
    ],
  },
] as unknown as EditOp[]

async function buildTemplate(version?: Pick<MotionTemplate, 'id' | 'version' | 'createdAt'>) {
  const built = await editProject({ project: project(1920, 1080), ops: LOWER_THIRD_OPS })
  const detail = built.results.find((r) => r.callerId === 'group')!.detail as {
    compositionId: string
    items: string[]
  }
  const template = parseMotionTemplate(
    buildMotionTemplate({
      rootCompositionId: detail.compositionId,
      compositions: built.project.timeline!.compositions!,
      name: 'Lower third',
      category: 'lower-third',
      role: 'labels',
      previous: version,
    }),
  )
  return { built, detail, template }
}

const instances = (p: Project) =>
  p.timeline!.items.filter((item) => item.type === 'composition') as CompositionItem[]

describe('motion template ops', () => {
  it('createComposition keeps item ids inside and setCompositionControls publishes by name', async () => {
    const { built, detail } = await buildTemplate()
    expect(detail.items.sort()).toEqual(['bar', 'title'])
    const composition = built.project.timeline!.compositions![0]!
    expect(composition.editorKind).toBe('composite-2d')
    expect([composition.width, composition.height]).toEqual([1920, 1080])
    expect(composition.keyframes?.[0]?.itemId).toBe('title')
    expect(composition.compositionControls?.controls.map((c) => [c.name, c.kind])).toEqual([
      ['Name', 'text'],
      ['Bar colour', 'color'],
    ])
  })

  it('addTemplate copies the template once and gives each instance its own values', async () => {
    const { template } = await buildTemplate()
    const target = project(1080, 1920, {}, 'target')
    const result = await editProject({
      project: target,
      templates: [template],
      ops: [
        {
          op: 'addTemplate',
          callerId: 'a',
          template: 'lower third',
          from: 0,
          controls: { Name: 'Ana' },
        },
        {
          op: 'addTemplate',
          callerId: 'b',
          template: template.id,
          from: 90,
          controls: { name: 'Bo', 'Bar colour': '#00ff00' },
        },
      ] as unknown as EditOp[],
    })
    const compositions = result.project.timeline!.compositions!
    expect(compositions).toHaveLength(1)
    expect(compositions[0]).toMatchObject({ templateId: template.id, templateVersion: 1 })
    const [a, b] = instances(result.project)
    expect(a!.compositionId).toBe(b!.compositionId)
    const nameId = template.controls.find((c) => c.name === 'Name')!.id
    const barId = template.controls.find((c) => c.name === 'Bar colour')!.id
    expect(a!.compositionControlOverrides).toEqual({ [nameId]: 'Ana' })
    expect(b!.compositionControlOverrides).toEqual({ [nameId]: 'Bo', [barId]: '#00ff00' })
    expect(result.results[1]!.detail).toMatchObject({ reused: true, templateVersion: 1 })
    // A 1920x1080 template in a 1080x1920 project fills the width, aspect kept.
    expect(a!.transform).toMatchObject({ width: 1080, height: 608 })
    // Both instances share a template track created on top.
    expect(a!.trackId).toBe(b!.trackId)
  })

  it('unknown control names fail with the valid names', async () => {
    const { template } = await buildTemplate()
    await expect(
      editProject({
        project: project(1920, 1080),
        templates: [template],
        ops: [
          { op: 'addTemplate', template: 'Lower third', controls: { Nmae: 'x' } },
        ] as unknown as EditOp[],
      }),
    ).rejects.toThrow(/Unknown control "Nmae". Controls: "Name", "Bar colour"/)
  })

  it('an instance cannot be longer than the template', async () => {
    const { template } = await buildTemplate()
    await expect(
      editProject({
        project: project(1920, 1080),
        templates: [template],
        ops: [
          { op: 'addTemplate', template: 'Lower third', durationInFrames: 61 },
        ] as unknown as EditOp[],
      }),
    ).rejects.toThrow(/longer than/)
  })

  it('setTemplateControls changes and resets one instance', async () => {
    const { template } = await buildTemplate()
    const placed = await editProject({
      project: project(1920, 1080),
      templates: [template],
      ops: [
        { op: 'addTemplate', callerId: 'a', template: 'Lower third', controls: { Name: 'Ana' } },
      ] as unknown as EditOp[],
    })
    const id = instances(placed.project)[0]!.id
    const changed = await editProject({
      project: placed.project,
      ops: [
        { op: 'setTemplateControls', id, controls: { Name: null, 'Bar colour': 'blue' } },
      ] as unknown as EditOp[],
    })
    const barId = template.controls.find((c) => c.name === 'Bar colour')!.id
    expect(instances(changed.project)[0]!.compositionControlOverrides).toEqual({ [barId]: 'blue' })
  })

  it('updateTemplate moves every instance to the new version and keeps values by name', async () => {
    const { template } = await buildTemplate()
    const placed = await editProject({
      project: project(1920, 1080),
      templates: [template],
      ops: [
        {
          op: 'addTemplate',
          template: 'Lower third',
          from: 0,
          controls: { Name: 'Ana', 'Bar colour': 'red' },
        },
        { op: 'addTemplate', template: 'Lower third', from: 100, controls: { Name: 'Bo' } },
      ] as unknown as EditOp[],
    })
    // Version 2 renames the colour control and re-authors the name control.
    const v2 = parseMotionTemplate({
      ...template,
      version: 2,
      composition: {
        ...template.composition,
        compositionControls: {
          version: 1,
          controls: template.controls.map((c) =>
            c.name === 'Name' ? { ...c, id: 'new-name-id' } : { ...c, name: 'Accent' },
          ),
        },
      },
    })
    const stale = await editProject({
      project: placed.project,
      templates: [v2],
      ops: [{ op: 'addTemplate', template: 'Lower third', from: 200 }] as unknown as EditOp[],
    })
    expect(stale.results[0]!.detail).toMatchObject({
      reused: true,
      templateVersion: 1,
      libraryVersion: 2,
    })
    expect((stale.results[0]!.detail as { warning: string }).warning).toMatch(/updateTemplate/)
    const updated = await editProject({
      project: stale.project,
      templates: [v2],
      ops: [{ op: 'updateTemplate', template: 'Lower third' }] as unknown as EditOp[],
    })
    expect(updated.results[0]!.detail).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      instances: 3,
      droppedControls: ['Bar colour'],
    })
    const compositions = updated.project.timeline!.compositions!
    expect(compositions).toHaveLength(1)
    expect(compositions[0]!.templateVersion).toBe(2)
    const values = instances(updated.project).map((item) => item.compositionControlOverrides)
    expect(values).toEqual([{ 'new-name-id': 'Ana' }, { 'new-name-id': 'Bo' }, undefined])
    expect(new Set(instances(updated.project).map((i) => i.compositionId))).toEqual(
      new Set([compositions[0]!.id]),
    )
  })

  it('addTemplate on an occupied track fails instead of shifting', async () => {
    const { template } = await buildTemplate()
    await expect(
      editProject({
        project: project(1920, 1080),
        templates: [template],
        ops: [
          { op: 'addText', text: 'x', trackId: 'v1', from: 0, durationInFrames: 30 },
          { op: 'addTemplate', template: 'Lower third', trackId: 'v1', from: 10 },
        ] as unknown as EditOp[],
      }),
    ).rejects.toThrow(/overlap/)
  })

  it('a template the service did not pass in is an error', async () => {
    await expect(
      editProject({
        project: project(1920, 1080),
        ops: [{ op: 'addTemplate', template: 'Nope' }] as unknown as EditOp[],
      }),
    ).rejects.toThrow(/was not passed in/)
  })
})
