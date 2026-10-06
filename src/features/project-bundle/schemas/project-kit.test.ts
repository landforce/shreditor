// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { migrateProject } from '@/shared/projects/migrations'
import { validateProject } from './project-schema'

const kit = {
  path: '/kits/me/kit.json',
  creator: 'Me',
  kitVersion: '0.3.0',
  hash: 'sha256:abc',
  appliedAt: '2026-10-06T00:00:00.000Z',
  brandColors: [{ hex: '#FF0055', job: 'accent' }],
}

const project = {
  id: 'p1',
  name: 'Kit',
  description: '',
  createdAt: 1,
  updatedAt: 1,
  duration: 0,
  metadata: { width: 1080, height: 1920, fps: 30 },
  format: { id: 'graphic-yap' },
  kit,
  timeline: { tracks: [], items: [] },
} as unknown as Project

describe('project.kit', () => {
  it('survives validation, a JSON round trip and migration', () => {
    const roundTrip = JSON.parse(JSON.stringify(project))
    const validated = validateProject(roundTrip)
    expect(validated.success).toBe(true)
    expect((validated.data as Project).kit).toEqual(kit)
    expect(migrateProject(validated.data as Project).project.kit).toEqual(kit)
  })

  it('rejects a kit record without its hash or with a bad colour', () => {
    const { hash: _hash, ...noHash } = kit
    expect(validateProject({ ...project, kit: noHash }).success).toBe(false)
    expect(
      validateProject({ ...project, kit: { ...kit, brandColors: [{ hex: 'red' }] } }).success,
    ).toBe(false)
  })

  it('accepts text items with split padding and per-line backgrounds', () => {
    const withText = {
      ...project,
      timeline: {
        tracks: [
          {
            id: 't',
            name: 'T',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
          },
        ],
        items: [
          {
            id: 'x',
            type: 'text',
            trackId: 't',
            from: 0,
            durationInFrames: 30,
            label: 'x',
            text: 'Hi',
            color: '#000',
            textStyleId: 'kit:title',
            backgroundMode: 'lines',
            textPaddingX: 29,
            textPaddingY: 4,
          },
        ],
      },
    }
    expect(validateProject(withText).success).toBe(true)
    expect(
      validateProject({
        ...withText,
        timeline: {
          ...withText.timeline,
          items: [{ ...withText.timeline.items[0], textPaddingX: -1 }],
        },
      }).success,
    ).toBe(false)
  })
})
