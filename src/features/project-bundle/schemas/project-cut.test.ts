// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { migrateProject } from '@/shared/projects/migrations'
import { validateProject } from './project-schema'

const cut = { group: 'main1', label: 'Hook B', order: 2 }

const project = {
  id: 'c1',
  name: 'Warehouse · Hook B',
  description: '',
  createdAt: 1,
  updatedAt: 1,
  duration: 0,
  metadata: { width: 1920, height: 1080, fps: 30 },
  cut,
  timeline: { tracks: [], items: [] },
} as unknown as Project

describe('project.cut', () => {
  it('survives validation, a JSON round trip and migration', () => {
    const validated = validateProject(JSON.parse(JSON.stringify(project)))
    expect(validated.success).toBe(true)
    expect((validated.data as Project).cut).toEqual(cut)
    expect(migrateProject(validated.data as Project).project.cut).toEqual(cut)
  })

  it('rejects a cut without a label or with unknown fields', () => {
    expect(validateProject({ ...project, cut: { group: 'main1', label: ' ' } }).success).toBe(false)
    expect(validateProject({ ...project, cut: { ...cut, main: true } }).success).toBe(false)
  })
})
