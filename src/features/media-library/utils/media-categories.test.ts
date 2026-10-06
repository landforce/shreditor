// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MediaCategory, MediaMetadata } from '@/types/storage'
import { groupMediaSections, isMediaCategory } from './media-categories'

function makeMedia(id: string, category?: string, mimeType = 'video/mp4'): MediaMetadata {
  return {
    id,
    storageType: 'workspace',
    fileName: `${id}.mp4`,
    fileSize: 1024,
    mimeType,
    duration: 5,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'avc',
    bitrate: 1,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...(category ? { category: category as MediaCategory } : {}),
  }
}

describe('media categories', () => {
  it('recognises only the allowed values', () => {
    expect(isMediaCategory('b-roll')).toBe(true)
    expect(isMediaCategory('sfx')).toBe(true)
    expect(isMediaCategory('broll')).toBe(false)
    expect(isMediaCategory(undefined)).toBe(false)
  })

  it('orders sections picture-first, saved categories interleaved with type groups', () => {
    const items = [
      makeMedia('m1', 'music', 'audio/mpeg'),
      makeMedia('a1', undefined, 'audio/wav'),
      makeMedia('i1', undefined, 'image/png'),
      makeMedia('b1', 'b-roll'),
      makeMedia('s1', 'speaker'),
      makeMedia('u1'),
      makeMedia('b2', 'b-roll'),
      makeMedia('x1', 'not-a-category'),
      makeMedia('o1', 'other'),
      makeMedia('g1', 'graphics', 'image/png'),
    ]
    const sections = groupMediaSections(items)
    expect(sections.map((s) => `${s.kind}:${s.key}`)).toEqual([
      'category:speaker',
      'category:b-roll',
      'type:video',
      'category:graphics',
      'type:image',
      'category:music',
      'type:audio',
      'category:other',
    ])
    expect(sections.find((s) => s.key === 'b-roll')?.items.map((m) => m.id)).toEqual(['b1', 'b2'])
    expect(sections.find((s) => s.key === 'video')?.items.map((m) => m.id)).toEqual(['u1', 'x1'])
  })

  it('uses the inferred category only when none is saved', () => {
    const items = [makeMedia('auto'), makeMedia('saved', 'b-roll'), makeMedia('pending')]
    const sections = groupMediaSections(items, (item) =>
      item.id === 'pending' ? undefined : 'speaker',
    )
    expect(sections.map((s) => [s.key, s.items.map((m) => m.id)])).toEqual([
      ['speaker', ['auto']],
      ['b-roll', ['saved']],
      ['video', ['pending']],
    ])
  })

  it('returns no sections for no items', () => {
    expect(groupMediaSections([])).toEqual([])
  })
})
