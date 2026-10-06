// @vitest-environment node
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  parseMotionTemplate,
  type MotionTemplate,
} from '@/shared/motion-templates/template-core.mjs'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'
import {
  listMotionTemplates,
  readMotionTemplate,
  readMotionTemplateThumbnail,
  saveMotionTemplate,
} from './motion-templates'

const template = (version: number, name = 'Lower third'): MotionTemplate =>
  parseMotionTemplate({
    formatVersion: 2,
    id: 'tpl-1',
    name,
    category: 'lower-third',
    version,
    createdAt: 1,
    updatedAt: version,
    variants: {
      '16:9': {
        version,
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 60,
        thumbnail: 'thumbnail-16x9.webp',
        composition: {
          id: 'c',
          name: 'c',
          items: [],
          tracks: [],
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 60,
        },
        subCompositions: [],
        media: [],
      },
    },
  })

describe('motion template library storage', () => {
  afterEach(() => setWorkspaceRoot(null))

  it('round-trips a template and its thumbnail under app/templates/<id>/', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveMotionTemplate(template(1), 0, { '16:9': new Blob(['webp']) })
    expect(await readFileText(root, 'app', 'templates', 'tpl-1', 'template.json')).toContain(
      '"Lower third"',
    )
    expect(await readMotionTemplate('tpl-1')).toMatchObject({ id: 'tpl-1', version: 1 })
    expect(await (await readMotionTemplateThumbnail('tpl-1', 'thumbnail-16x9.webp'))!.text()).toBe(
      'webp',
    )
    expect((await listMotionTemplates()).map((t) => t.name)).toEqual(['Lower third'])
  })

  it('refuses to overwrite a version it was not built on (no stale writes)', async () => {
    setWorkspaceRoot(asHandle(createRoot()))
    await saveMotionTemplate(template(1), 0)
    await saveMotionTemplate(template(2), 1)
    await expect(saveMotionTemplate(template(2, 'Stale'), 1)).rejects.toThrow(
      /changed in the library/,
    )
    expect((await readMotionTemplate('tpl-1'))!.name).toBe('Lower third')
  })

  it('lists nothing for a workspace without a library and skips unreadable files', async () => {
    setWorkspaceRoot(asHandle(createRoot()))
    expect(await listMotionTemplates()).toEqual([])
  })
})
