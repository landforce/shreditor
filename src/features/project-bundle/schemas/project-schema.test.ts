import { describe, expect, it } from 'vite-plus/test'
import { createFormatTracks, projectFormatRecord } from '@formats/registry.mjs'
import { migrateProject } from '@/shared/projects/migrations'
import type { Project } from '@/types/project'
import { validateProject } from './project-schema'

function baseProject(extra: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Demo',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    metadata: { width: 1080, height: 1920, fps: 30 },
    ...extra,
  }
}

const formatTimeline = (): NonNullable<Project['timeline']> => ({
  tracks: createFormatTracks('graphic-yap').map(({ items: _items, ...track }) => track),
  items: [
    {
      id: 'img',
      type: 'image',
      trackId: 'track-images',
      from: 0,
      durationInFrames: 30,
      label: 'Image',
      src: 'blob:x',
      formatRole: 'images',
    },
  ],
})

describe('project schema: formats', () => {
  it('accepts a project without a format (older projects)', () => {
    const result = validateProject(baseProject())
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('format')
  })

  it('round-trips a format, track roles and item roles', () => {
    const project = baseProject({
      format: projectFormatRecord('graphic-yap', 'intense'),
      timeline: formatTimeline(),
    })
    const result = validateProject(JSON.parse(JSON.stringify(project)))
    expect(result.success).toBe(true)
    expect(result.data?.format).toEqual({
      id: 'graphic-yap',
      variant: 'intense',
      reviewedHash: project.format?.reviewedHash,
    })
    expect(result.data?.timeline?.tracks.map((track) => track.formatRole)).toEqual([
      'title',
      'captions',
      'images',
      'speaker',
      'speaker',
      'music',
    ])
    expect(result.data?.timeline?.items[0]?.formatRole).toBe('images')
    // Migrations keep it.
    const migrated = migrateProject(result.data as Project).project
    expect(migrated.format?.variant).toBe('intense')
    expect(migrated.timeline?.tracks[2]?.formatRole).toBe('images')
  })

  it('rejects unknown formats, variants and roles', () => {
    expect(validateProject(baseProject({ format: { id: 'yap' as never } })).success).toBe(false)
    expect(
      validateProject(baseProject({ format: { id: 'vlog', variant: 'medium' } })).success,
    ).toBe(false)
    const timeline = formatTimeline()
    timeline.items[0] = { ...timeline.items[0]!, formatRole: 'hero' as never }
    expect(validateProject(baseProject({ timeline })).success).toBe(false)
  })
})
