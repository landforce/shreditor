import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildTemplateFromProject,
  collectTemplateInputs,
  listTemplates,
  missingTemplateMedia,
  remapTemplateMedia,
  resolveTemplate,
  templateLibraryStamp,
  templatePreviewProject,
  writeTemplate,
} from './lib/templates.mjs'
import { collectEditResources } from './lib/workspace.mjs'
import { createTemplateRoutes } from '../server/template-bridge.mjs'

const fails = (code) => (error) => error.code === code

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shred-templates-'))
}

function addMedia(root, id, fileName = 'logo.png') {
  fs.mkdirSync(path.join(root, 'media', id), { recursive: true })
  fs.writeFileSync(path.join(root, 'media', id, fileName), 'png')
  fs.writeFileSync(path.join(root, 'media', id, 'metadata.json'), JSON.stringify({ id, fileName }))
}

const projectWithComposition = {
  id: 'p',
  name: 'Source',
  timeline: {
    tracks: [],
    items: [
      {
        id: 'inst',
        type: 'composition',
        compositionId: 'comp',
        trackId: 't',
        from: 0,
        durationInFrames: 60,
        label: 'LT',
      },
    ],
    compositions: [
      {
        id: 'comp',
        name: 'Lower third',
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 60,
        tracks: [],
        items: [
          {
            id: 'title',
            type: 'text',
            text: 'Jane',
            color: '#fff',
            label: 'Title',
            trackId: 't',
            from: 0,
            durationInFrames: 60,
          },
          {
            id: 'logo',
            type: 'image',
            mediaId: 'm1',
            label: 'Logo',
            trackId: 't',
            from: 0,
            durationInFrames: 60,
          },
        ],
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
      },
    ],
  },
}

function savedWorkspace() {
  const root = workspace()
  addMedia(root, 'm1')
  const template = buildTemplateFromProject(
    root,
    projectWithComposition,
    'inst',
    { category: 'lower-third' },
    (id) => (id === 'm1' ? 'logo.png' : id),
  )
  writeTemplate(root, template, Buffer.from('jpg'))
  return { root, template }
}

test('save builds from a composition item and writes template.json + thumbnail atomically', () => {
  const { root, template } = savedWorkspace()
  try {
    assert.equal(template.name, 'Lower third')
    assert.deepEqual(template.media, [{ mediaId: 'm1', fileName: 'logo.png' }])
    const dir = path.join(root, 'app', 'templates', template.id)
    assert.deepEqual(fs.readdirSync(dir).sort(), ['template.json', 'thumbnail.jpg'])
    const { entries } = listTemplates(root)
    assert.deepEqual(entries[0].template, JSON.parse(JSON.stringify({ ...template })))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('saving the same name again is a new version of the same template', () => {
  const { root, template } = savedWorkspace()
  try {
    const next = buildTemplateFromProject(root, projectWithComposition, 'comp', {
      name: 'LOWER THIRD',
      category: 'title',
    })
    assert.equal(next.id, template.id)
    assert.equal(next.version, 2)
    assert.equal(next.createdAt, template.createdAt)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveTemplate finds by id or name and names the library on a miss', () => {
  const { root, template } = savedWorkspace()
  try {
    assert.equal(resolveTemplate(root, template.id).template.id, template.id)
    assert.equal(resolveTemplate(root, 'lower third').template.id, template.id)
    assert.throws(
      () => resolveTemplate(root, 'Nope'),
      (error) => error.code === 'TEMPLATE_NOT_FOUND' && /"Lower third"/.test(error.message),
    )
    assert.throws(
      () => buildTemplateFromProject(root, projectWithComposition, 'nope', {}),
      fails('COMPOSITION_NOT_FOUND'),
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('template ids must stay inside app/templates', () => {
  const root = workspace()
  try {
    assert.throws(
      () => writeTemplate(root, { id: '../escape', name: 'x' }, null),
      fails('INVALID_ID'),
    )
    assert.equal(fs.existsSync(path.join(root, 'escape')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('edit inputs carry the templates ops name, and refuse missing media by file name', () => {
  const { root, template } = savedWorkspace()
  try {
    const ops = [
      { op: 'addTemplate', template: 'Lower third' },
      { op: 'updateTemplate', template: template.id },
      { op: 'addText', text: 'x' },
    ]
    const has = (id) => fs.existsSync(path.join(root, 'media', id))
    assert.deepEqual(
      collectTemplateInputs(root, ops, has).map((t) => t.id),
      [template.id],
    )
    assert.deepEqual(
      collectEditResources(root, ops).templates.map((t) => t.id),
      [template.id],
    )
    assert.equal('templates' in collectEditResources(root, [{ op: 'addText' }]), false)
    fs.rmSync(path.join(root, 'media', 'm1'), { recursive: true })
    assert.deepEqual(missingTemplateMedia(template, has), template.media)
    assert.throws(
      () => collectEditResources(root, ops),
      (error) => error.code === 'TEMPLATE_MEDIA_MISSING' && /logo\.png \(m1\)/.test(error.message),
    )
    assert.throws(
      () => collectTemplateInputs(root, [{ op: 'addTemplate', template: 'x' }], has),
      fails('TEMPLATE_NOT_FOUND'),
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the library stamp changes when a template is rewritten; the bridge serves it', async () => {
  const { root, template } = savedWorkspace()
  try {
    const before = templateLibraryStamp(root)
    writeTemplate(root, { ...template, version: 2, name: 'Renamed lower third' }, null)
    const after = templateLibraryStamp(root)
    assert.notEqual(before, after)
    let sent
    const route = createTemplateRoutes({
      sendJson: (_res, status, body) => (sent = { status, body }),
    })
    assert.equal(await route({}, {}, { route: 'GET templates/version', root }), true)
    assert.deepEqual(sent, { status: 200, body: { version: after } })
    assert.equal(await route({}, {}, { route: 'GET other', root }), false)
    const empty = workspace()
    assert.equal(templateLibraryStamp(empty), 'empty')
    fs.rmSync(empty, { recursive: true, force: true })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('imported packs remap media ids; the preview project shows the template alone', () => {
  const { root, template } = savedWorkspace()
  try {
    const remapped = remapTemplateMedia(template, new Map([['m1', 'm2']]))
    assert.equal(remapped.composition.items.find((item) => item.id === 'logo').mediaId, 'm2')
    assert.deepEqual(remapped.media, [{ mediaId: 'm2', fileName: 'logo.png' }])
    const preview = templatePreviewProject(template)
    assert.deepEqual(preview.metadata, { width: 1920, height: 1080, fps: 30 })
    assert.equal(preview.timeline.items[0].compositionId, template.composition.id)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
