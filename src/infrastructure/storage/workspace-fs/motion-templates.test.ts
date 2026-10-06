// @vitest-environment node
import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { MotionTemplate } from '@/shared/motion-templates/template-core.mjs'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'
import {
  listMotionTemplates,
  readMotionTemplate,
  readMotionTemplateThumbnail,
  saveMotionTemplate,
} from './motion-templates'

const template = (version: number, name = 'Lower third'): MotionTemplate =>
  ({
    formatVersion: 1,
    id: 'tpl-1',
    name,
    category: 'lower-third',
    version,
    createdAt: 1,
    updatedAt: version,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 60,
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
    controls: [],
    media: [],
  }) as MotionTemplate

describe('motion template library storage', () => {
  afterEach(() => setWorkspaceRoot(null))

  it('round-trips a template and its thumbnail under app/templates/<id>/', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await saveMotionTemplate(template(1), 0, new Blob(['jpg']))
    expect(await readFileText(root, 'app', 'templates', 'tpl-1', 'template.json')).toContain(
      '"Lower third"',
    )
    expect(await readMotionTemplate('tpl-1')).toMatchObject({ id: 'tpl-1', version: 1 })
    expect(await (await readMotionTemplateThumbnail('tpl-1'))!.text()).toBe('jpg')
    expect((await listMotionTemplates()).map((t) => t.name)).toEqual(['Lower third'])
  })

  it('refuses to overwrite a version it was not built on (no stale writes)', async () => {
    setWorkspaceRoot(asHandle(createRoot()))
    await saveMotionTemplate(template(1), 0, null)
    await saveMotionTemplate(template(2), 1, null)
    await expect(saveMotionTemplate(template(2, 'Stale'), 1, null)).rejects.toThrow(
      /changed in the library/,
    )
    expect((await readMotionTemplate('tpl-1'))!.name).toBe('Lower third')
  })

  it('lists nothing for a workspace without a library and skips unreadable files', async () => {
    setWorkspaceRoot(asHandle(createRoot()))
    expect(await listMotionTemplates()).toEqual([])
  })
})
