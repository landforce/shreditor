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
import { templateVariant } from '../src/shared/motion-templates/template-core.mjs'
import { cloneTemplateVariant } from '../src/shared/motion-templates/template-variants.mjs'

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
  writeTemplate(root, template, { '16:9': Buffer.from('webp') })
  return { root, template }
}

/** The source project with its composition re-sized (another aspect ratio) and tagged. */
function projectWith(compositionPatch) {
  const project = structuredClone(projectWithComposition)
  Object.assign(project.timeline.compositions[0], compositionPatch)
  return project
}

test('save builds from a composition item and writes template.json + thumbnail atomically', () => {
  const { root, template } = savedWorkspace()
  try {
    assert.equal(template.name, 'Lower third')
    assert.deepEqual(template.media, [{ mediaId: 'm1', fileName: 'logo.png' }])
    const dir = path.join(root, 'app', 'templates', template.id)
    assert.deepEqual(fs.readdirSync(dir).sort(), ['template.json', 'thumbnail-16x9.webp'])
    assert.deepEqual(listTemplates(root).entries[0].thumbnails, {
      '16:9': path.join(dir, 'thumbnail-16x9.webp'),
    })
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

test('saving a copy of a template updates that template: its variant for the copy aspect', () => {
  const { root, template } = savedWorkspace()
  try {
    // A 9:16 copy (renamed in the project) adds the 9:16 variant to the same template.
    const portrait = buildTemplateFromProject(
      root,
      projectWith({ templateId: template.id, name: 'LT tall', width: 1080, height: 1920 }),
      'comp',
      { hold: { start: 30, end: 30 } },
    )
    assert.equal(portrait.id, template.id)
    assert.equal(portrait.name, 'Lower third')
    assert.equal(portrait.category, 'lower-third')
    assert.deepEqual(Object.keys(portrait.variants).sort(), ['16:9', '9:16'])
    assert.deepEqual(portrait.variants['9:16'].hold, { start: 30, end: 30 })
    assert.equal(portrait.variants['16:9'].version, 1)
    writeTemplate(root, portrait, { '9:16': Buffer.from('tall') })
    // Saving the 9:16 copy again replaces that variant and keeps its hold.
    const again = buildTemplateFromProject(
      root,
      projectWith({ templateId: template.id, width: 1080, height: 1920 }),
      'comp',
      {},
    )
    assert.equal(again.version, 3)
    assert.deepEqual(again.variants['9:16'].hold, { start: 30, end: 30 })
    assert.equal(again.variants['16:9'].version, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a format 1 template on disk loads as one variant; rewriting it tidies the old thumbnail', () => {
  const root = workspace()
  try {
    const dir = path.join(root, 'app', 'templates', 'old')
    fs.mkdirSync(dir, { recursive: true })
    const composition = projectWithComposition.timeline.compositions[0]
    fs.writeFileSync(
      path.join(dir, 'template.json'),
      JSON.stringify({
        formatVersion: 1,
        id: 'old',
        name: 'Old lower third',
        category: 'lower-third',
        version: 4,
        createdAt: 1,
        updatedAt: 2,
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 60,
        composition,
        subCompositions: [],
        controls: [],
        media: [],
      }),
    )
    fs.writeFileSync(path.join(dir, 'thumbnail.jpg'), 'jpg')
    const [entry] = listTemplates(root).entries
    assert.deepEqual(Object.keys(entry.template.variants), ['16:9'])
    assert.equal(entry.template.variants['16:9'].version, 4)
    assert.equal(entry.thumbnails['16:9'], path.join(dir, 'thumbnail.jpg'))
    // A clone keeps the old variant's thumbnail; a re-save of 16:9 replaces it.
    const { template: cloned } = cloneTemplateVariant(entry.template, {
      aspect: '9:16',
      canvas: { width: 1080, height: 1920 },
    })
    writeTemplate(root, cloned, { '9:16': Buffer.from('tall') })
    assert.deepEqual(fs.readdirSync(dir).sort(), [
      'template.json',
      'thumbnail-9x16.webp',
      'thumbnail.jpg',
    ])
    const resaved = buildTemplateFromProject(root, projectWith({ templateId: 'old' }), 'comp', {})
    writeTemplate(root, resaved, { '16:9': Buffer.from('wide') })
    assert.deepEqual(fs.readdirSync(dir).sort(), [
      'template.json',
      'thumbnail-16x9.webp',
      'thumbnail-9x16.webp',
    ])
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'template.json'))).formatVersion, 2)
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
    writeTemplate(root, { ...template, version: 2, name: 'Renamed lower third' })
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
    const variant = remapped.variants['16:9']
    assert.equal(variant.composition.items.find((item) => item.id === 'logo').mediaId, 'm2')
    assert.deepEqual(variant.media, [{ mediaId: 'm2', fileName: 'logo.png' }])
    assert.deepEqual(remapped.media, [{ mediaId: 'm2', fileName: 'logo.png' }])
    const preview = templatePreviewProject(templateVariant(template, '16:9'))
    assert.deepEqual(preview.metadata, {
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: 'rgba(0, 0, 0, 0)',
    })
    assert.equal(preview.timeline.items[0].compositionId, template.variants['16:9'].composition.id)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
