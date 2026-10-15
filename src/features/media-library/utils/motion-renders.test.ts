import { describe, expect, it } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import { motionRenderGraphic, supersededMotionRenders } from './motion-renders'

const media = (id: string, fileName: string, createdAt: number) =>
  ({ id, fileName, createdAt }) as MediaMetadata

describe('motion renders', () => {
  it('names the graphic a render belongs to', () => {
    expect(motionRenderGraphic('hole-title-a915f87f0ee1.webm')).toBe('hole-title')
    expect(motionRenderGraphic('shreditor-1792040238673.webm')).toBe('shreditor')
    expect(motionRenderGraphic('IMG_0042.MOV')).toBeNull()
    expect(motionRenderGraphic('clip-final.webm')).toBeNull()
  })

  it('hides renders a re-render replaced, keeping the ones in use and the newest', () => {
    const items = [
      media('a1', 'title-aaaaaaaaaaaa.webm', 1),
      media('a2', 'title-bbbbbbbbbbbb.webm', 2),
      media('a3', 'title-cccccccccccc.webm', 3),
      media('b1', 'lower-third-dddddddddddd.webm', 1),
      media('v', 'IMG_0042.MOV', 0),
    ]
    // a1 is still on the timeline (another clip, or an undo away); a3 is the newest.
    expect([...supersededMotionRenders(items, new Set(['a1']))]).toEqual(['a2'])
    expect(supersededMotionRenders(items, new Set(['a1', 'a2'])).size).toBe(0)
  })
})
