// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MediaCategory, MediaMetadata } from '@/types/storage'
import {
  groupMediaByCategory,
  hasMediaCategories,
  isMediaCategory,
  UNCATEGORIZED,
} from './media-categories'

function makeMedia(id: string, category?: string): MediaMetadata {
  return {
    id,
    storageType: 'workspace',
    fileName: `${id}.mp4`,
    fileSize: 1024,
    mimeType: 'video/mp4',
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

  it('groups only when some item has a valid category', () => {
    expect(hasMediaCategories([makeMedia('a'), makeMedia('b')])).toBe(false)
    expect(hasMediaCategories([makeMedia('a'), makeMedia('b', 'bogus')])).toBe(false)
    expect(hasMediaCategories([makeMedia('a'), makeMedia('b', 'music')])).toBe(true)
  })

  it('orders groups by category, then uncategorized, keeping item order', () => {
    const items = [
      makeMedia('m1', 'music'),
      makeMedia('u1'),
      makeMedia('b1', 'b-roll'),
      makeMedia('s1', 'speaker'),
      makeMedia('b2', 'b-roll'),
      makeMedia('x1', 'not-a-category'),
      makeMedia('o1', 'other'),
      makeMedia('v1', 'overlay'),
    ]
    const groups = groupMediaByCategory(items)
    expect(groups.map((g) => g.key)).toEqual([
      'speaker',
      'b-roll',
      'overlay',
      'music',
      'other',
      UNCATEGORIZED,
    ])
    expect(groups.find((g) => g.key === 'b-roll')?.items.map((m) => m.id)).toEqual(['b1', 'b2'])
    expect(groups.at(-1)?.items.map((m) => m.id)).toEqual(['u1', 'x1'])
  })

  it('returns no groups for no items', () => {
    expect(groupMediaByCategory([])).toEqual([])
  })
})
