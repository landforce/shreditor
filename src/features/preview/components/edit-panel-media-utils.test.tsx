// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { CompositionItem } from '@/types/timeline'
import {
  canvasAspectRatio,
  computeCornerThumbnailSize,
  getItemAspectRatio,
  renderPanelMedia,
} from './edit-panel-media-utils'

const compositionItem: CompositionItem = {
  id: 'compound-1',
  type: 'composition',
  compositionId: 'sequence-1',
  compositionWidth: 1080,
  compositionHeight: 1920,
  trackId: 'track-1',
  from: 0,
  durationInFrames: 120,
  label: 'Portrait sequence',
}

describe('edit panel composition media', () => {
  it('uses the nested composition aspect ratio instead of the graphic placeholder ratio', () => {
    expect(getItemAspectRatio(compositionItem)).toBe(1080 / 1920)
  })

  it('routes a compound clip to its requested source frame renderer', () => {
    const rendered = renderPanelMedia(
      compositionItem,
      2,
      undefined,
      {
        renderVideo: () => 'video',
        renderImage: () => 'image',
        renderComposition: (item, sourceFrame) => `${item.id}:${sourceFrame}`,
        renderPlaceholder: (type) => `placeholder:${type}`,
      },
      47,
    )

    expect(rendered).toBe('compound-1:47')
  })
})

describe('edit panel aspect fallbacks', () => {
  it("uses the project's canvas aspect for a gap or an item without a source size", () => {
    expect(getItemAspectRatio(null, 9 / 16)).toBe(9 / 16)
    expect(getItemAspectRatio({ ...compositionItem, compositionWidth: 0 }, 9 / 16)).toBe(9 / 16)
    expect(getItemAspectRatio(null)).toBe(16 / 9)
  })

  it('reads a canvas size as an aspect, with 16:9 for an unusable one', () => {
    expect(canvasAspectRatio(1080, 1920)).toBe(1080 / 1920)
    expect(canvasAspectRatio(0, 0)).toBe(16 / 9)
  })
})

describe('4-up corner thumbnail size', () => {
  it('keeps a 16:9 corner at its old size', () => {
    expect(computeCornerThumbnailSize(160, 16 / 9)).toEqual({ width: 160, height: 90 })
  })

  it('gives a 9:16 corner the same long edge, standing up', () => {
    expect(computeCornerThumbnailSize(160, 9 / 16)).toEqual({ width: 90, height: 160 })
  })

  it('stays at least a pixel and treats a bad aspect as 16:9', () => {
    expect(computeCornerThumbnailSize(0, 9 / 16)).toEqual({ width: 1, height: 1 })
    expect(computeCornerThumbnailSize(160, Number.NaN)).toEqual({ width: 160, height: 90 })
  })
})
