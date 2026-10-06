// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import {
  createItemRenderContext,
  createMockCanvasContext,
  createTextMeasureCache,
} from '../canvas-item-renderer-test-helpers'
import { renderTextItem, TEXT_STROKE_MITER_LIMIT } from './text'

function strokedItem(stroke: TextItem['stroke']): TextItem {
  return {
    id: 't',
    type: 'text',
    trackId: 'tr',
    from: 0,
    durationInFrames: 30,
    label: 'x',
    text: 'TITLE',
    color: '#ffffff',
    stroke,
  } as TextItem
}

/** Render once and capture the join state the context had at each strokeText. */
function joinsAtStroke(stroke: TextItem['stroke']) {
  const ctx = createMockCanvasContext()
  const seen: Array<{ lineJoin: string; miterLimit: number | undefined }> = []
  ctx.strokeText = vi.fn(() => {
    seen.push({ lineJoin: ctx.lineJoin, miterLimit: ctx.miterLimit })
  })
  const rctx = createItemRenderContext({ textMeasureCache: createTextMeasureCache() })
  renderTextItem(ctx, strokedItem(stroke), { x: 0, y: 0, width: 600, height: 200 }, rctx)
  return seen
}

describe('text stroke join', () => {
  it('defaults to round joins (unchanged look)', () => {
    expect(joinsAtStroke({ width: 6, color: '#000000' })).toEqual([
      { lineJoin: 'round', miterLimit: undefined },
    ])
  })

  it('draws square die-cut corners with a capped miter for join: miter', () => {
    expect(joinsAtStroke({ width: 6, color: '#000000', join: 'miter' })).toEqual([
      { lineJoin: 'miter', miterLimit: TEXT_STROKE_MITER_LIMIT },
    ])
  })

  it('supports bevel joins', () => {
    expect(joinsAtStroke({ width: 6, color: '#000000', join: 'bevel' })[0]?.lineJoin).toBe('bevel')
  })
})
