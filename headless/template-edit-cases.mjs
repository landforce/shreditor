// Browser contract cases for the motion template and composition ops (spread
// into the cases in edit-operations.mjs).
import assert from 'node:assert/strict'
import { buildMotionTemplate } from '../src/shared/motion-templates/template-core.mjs'

/** A 1920x1080 lower third with one text control, as the library stores it. */
function sampleTemplate() {
  return buildMotionTemplate({
    rootCompositionId: 'lt',
    name: 'Lower third',
    category: 'lower-third',
    newId: () => 'tpl-lower-third',
    now: 1,
    compositions: [
      {
        id: 'lt',
        name: 'Lower third',
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 60,
        tracks: [
          {
            id: 'lt-track',
            name: 'T',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
            items: [],
          },
        ],
        items: [
          {
            id: 'lt-title',
            type: 'text',
            trackId: 'lt-track',
            from: 0,
            durationInFrames: 60,
            label: 'Title',
            text: 'Name',
            color: '#fff',
            fontSize: 60,
          },
        ],
        compositionControls: {
          version: 1,
          controls: [
            {
              id: 'ctl-name',
              name: 'Name',
              targetItemId: 'lt-title',
              property: 'text.text',
              kind: 'text',
              defaultValue: 'Name',
            },
          ],
        },
      },
    ],
  })
}

const instances = (project) => project.timeline.items.filter((item) => item.type === 'composition')

export function templateCases({ item, edit, baseProject }) {
  const template = sampleTemplate()
  const placed = async (page, controls) =>
    (
      await edit(
        page,
        baseProject(),
        [{ op: 'addTemplate', template: 'Lower third', from: 100, controls }],
        undefined,
        undefined,
        [template],
      )
    ).project
  return [
    {
      name: 'addTemplate',
      templates: [template],
      op: { op: 'addTemplate', template: 'Lower third', from: 100, controls: { Name: 'Ana' } },
      assert: (project) => {
        const [instance] = instances(project)
        assert.equal(project.timeline.compositions[0].templateId, template.id)
        assert.deepEqual(instance.compositionControlOverrides, { 'ctl-name': 'Ana' })
        assert.deepEqual([instance.transform.width, instance.transform.height], [1280, 720])
      },
      failure: { op: 'addTemplate', template: 'Not in the library' },
    },
    {
      name: 'updateTemplate',
      setup: (page) => placed(page, { Name: 'Ana' }),
      templates: [{ ...template, version: 2 }],
      op: { op: 'updateTemplate', template: 'Lower third' },
      assert: (project) => {
        assert.equal(project.timeline.compositions[0].templateVersion, 2)
        assert.deepEqual(instances(project)[0].compositionControlOverrides, { 'ctl-name': 'Ana' })
      },
      failure: { op: 'updateTemplate', template: 'Not in the library' },
    },
    {
      name: 'setTemplateControls',
      setup: (page) => placed(page),
      opFrom: (project) => ({
        op: 'setTemplateControls',
        id: instances(project)[0].id,
        controls: { Name: 'Bo' },
      }),
      op: { op: 'setTemplateControls', id: 'instance', controls: { Name: 'Bo' } },
      assert: (project) =>
        assert.deepEqual(instances(project)[0].compositionControlOverrides, { 'ctl-name': 'Bo' }),
      failure: { op: 'setTemplateControls', id: 'text-1', controls: { Name: 'Bo' } },
    },
    {
      name: 'createComposition',
      op: { op: 'createComposition', ids: ['text-1'], name: 'Title card' },
      assert: (project) => {
        const [composition] = project.timeline.compositions
        assert.deepEqual([composition.name, composition.items[0].id], ['Title card', 'text-1'])
        assert.equal(item(project, 'text-1'), undefined)
      },
      failure: { op: 'createComposition', ids: ['missing'], name: 'Nope' },
    },
    {
      name: 'setCompositionControls',
      setup: async (page) =>
        (
          await edit(page, baseProject(), [
            { op: 'createComposition', ids: ['text-1'], name: 'Title card' },
          ])
        ).project,
      opFrom: (project) => ({
        op: 'setCompositionControls',
        compositionId: project.timeline.compositions[0].id,
        controls: [{ name: 'Headline', targetItemId: 'text-1', property: 'text.text' }],
      }),
      op: {
        op: 'setCompositionControls',
        compositionId: 'composition',
        controls: [{ name: 'Headline', targetItemId: 'text-1', property: 'text.text' }],
      },
      assert: (project) =>
        assert.deepEqual(
          project.timeline.compositions[0].compositionControls.controls.map((c) => [
            c.name,
            c.defaultValue,
          ]),
          [['Headline', 'hello']],
        ),
      failure: {
        op: 'setCompositionControls',
        compositionId: 'missing',
        controls: [{ name: 'Headline', targetItemId: 'text-1', property: 'text.text' }],
      },
    },
  ]
}
