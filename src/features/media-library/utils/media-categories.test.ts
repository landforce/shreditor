// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MediaCategory, MediaCategorySource, MediaMetadata } from '@/types/storage'
import {
  autoCategoryUpdate,
  groupMediaSections,
  hasExplicitCategory,
  isAutoCategory,
  isMediaCategory,
} from './media-categories'

function makeMedia(
  id: string,
  category?: string,
  mimeType = 'video/mp4',
  categorySource?: MediaCategorySource,
): MediaMetadata {
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
    ...(categorySource ? { categorySource } : {}),
  }
}

const auto = (id: string, category: string) => makeMedia(id, category, 'video/mp4', 'auto')

describe('media categories', () => {
  it('recognises only the allowed values', () => {
    expect(isMediaCategory('b-roll')).toBe(true)
    expect(isMediaCategory('sfx')).toBe(true)
    expect(isMediaCategory('broll')).toBe(false)
    expect(isMediaCategory(undefined)).toBe(false)
  })

  it('orders categories, then Analyzing, then the remaining type groups', () => {
    const items = [
      makeMedia('m1', 'music', 'audio/mpeg'),
      makeMedia('a1', undefined, 'audio/wav'),
      makeMedia('i1', undefined, 'image/png'),
      makeMedia('gif', undefined, 'image/gif'),
      makeMedia('b1', 'b-roll'),
      makeMedia('s1', 'speaker'),
      makeMedia('u1'),
      makeMedia('p1'),
      makeMedia('b2', 'b-roll'),
      makeMedia('x1', 'not-a-category'),
      makeMedia('o1', 'other'),
      makeMedia('v1', 'voiceover', 'audio/wav'),
      makeMedia('ov', 'overlay'),
      makeMedia('fx', 'sfx', 'audio/wav'),
      makeMedia('g1', 'graphics', 'image/png'),
    ]
    const sections = groupMediaSections(items, (item) => (item.id === 'p1' ? 'pending' : undefined))
    expect(sections.map((s) => `${s.kind}:${s.key}`)).toEqual([
      'category:speaker',
      'category:b-roll',
      'category:graphics',
      'category:overlay',
      'category:voiceover',
      'category:music',
      'category:sfx',
      'category:other',
      'analyzing:analyzing',
      'type:video',
      'type:image',
      'type:gif',
      'type:audio',
    ])
    expect(sections.find((s) => s.key === 'b-roll')?.items.map((m) => m.id)).toEqual(['b1', 'b2'])
    expect(sections.find((s) => s.key === 'video')?.items.map((m) => m.id)).toEqual(['u1', 'x1'])
  })

  it('groups by an explicit category whatever the analysis says', () => {
    const items = [
      makeMedia('legacy', 'b-roll'),
      makeMedia('user', 'b-roll', 'video/mp4', 'user'),
      makeMedia('agent', 'graphics', 'video/mp4', 'agent'),
      makeMedia('cleared', undefined, 'video/mp4', 'user'),
    ]
    const sections = groupMediaSections(items, () => 'speaker')
    expect(sections.map((s) => [s.key, s.items.map((m) => m.id)])).toEqual([
      ['b-roll', ['legacy', 'user']],
      ['graphics', ['agent']],
      ['video', ['cleared']],
    ])
    // Explicitly uncategorized media never shows as Analyzing either.
    expect(groupMediaSections([items[3]!], () => 'pending')[0]?.key).toBe('video')
  })

  it('shows a fresh verdict, else the standing suggestion, else Analyzing', () => {
    const items = [auto('was-broll', 'b-roll'), auto('steady', 'speaker'), makeMedia('new')]
    const verdicts: Record<string, 'speaker' | 'pending' | undefined> = {
      'was-broll': 'speaker',
      steady: 'pending',
      new: 'pending',
    }
    const sections = groupMediaSections(items, (item) => verdicts[item.id])
    expect(sections.map((s) => [s.key, s.items.map((m) => m.id)])).toEqual([
      ['speaker', ['was-broll', 'steady']],
      ['analyzing', ['new']],
    ])
  })

  it('returns no sections for no items', () => {
    expect(groupMediaSections([])).toEqual([])
  })
})

describe('category precedence', () => {
  it('treats user, agent and source-less categories as explicit', () => {
    expect(hasExplicitCategory(makeMedia('a', 'speaker', 'video/mp4', 'user'))).toBe(true)
    expect(hasExplicitCategory(makeMedia('a', 'speaker', 'video/mp4', 'agent'))).toBe(true)
    expect(hasExplicitCategory(makeMedia('a', 'speaker'))).toBe(true)
    expect(hasExplicitCategory(makeMedia('a', undefined, 'video/mp4', 'agent'))).toBe(true)
    expect(hasExplicitCategory(auto('a', 'speaker'))).toBe(false)
    expect(hasExplicitCategory(makeMedia('a'))).toBe(false)
    expect(isAutoCategory(auto('a', 'speaker'))).toBe(true)
    expect(isAutoCategory(makeMedia('a', 'speaker'))).toBe(false)
  })

  it('never lets a suggestion overwrite an explicit category', () => {
    for (const media of [
      makeMedia('a', 'b-roll', 'video/mp4', 'user'),
      makeMedia('a', 'b-roll', 'video/mp4', 'agent'),
      makeMedia('a', 'b-roll'),
      makeMedia('a', undefined, 'video/mp4', 'user'),
    ]) {
      expect(autoCategoryUpdate(media, 'speaker')).toBeNull()
    }
  })

  it('suggests into empty slots and refines its own suggestions', () => {
    expect(autoCategoryUpdate(makeMedia('a'), 'speaker')).toEqual({
      category: 'speaker',
      categorySource: 'auto',
    })
    expect(autoCategoryUpdate(auto('a', 'speaker'), 'b-roll')).toEqual({
      category: 'b-roll',
      categorySource: 'auto',
    })
    expect(autoCategoryUpdate(auto('a', 'speaker'), 'speaker')).toBeNull()
    // No verdict never clears a standing suggestion.
    expect(autoCategoryUpdate(auto('a', 'speaker'), undefined)).toBeNull()
  })
})
