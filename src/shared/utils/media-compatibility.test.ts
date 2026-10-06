import { describe, expect, it } from 'vite-plus/test'
import type { MediaCompatibility } from '@/types/storage'
import {
  describeWorkingCopy,
  isMediaPreparationBlocked,
  mediaPreparationPercent,
} from './media-compatibility'

const media = (compatibility?: Partial<MediaCompatibility>) => ({
  compatibility: compatibility
    ? { version: 2, backend: 'native' as const, ...compatibility }
    : undefined,
})

describe('media working-copy state', () => {
  it('blocks placement while preparing or failed only', () => {
    expect(isMediaPreparationBlocked(media({ status: 'preparing' }))).toBe(true)
    expect(isMediaPreparationBlocked(media({ status: 'failed' }))).toBe(true)
    expect(isMediaPreparationBlocked(media({ status: 'ready' }))).toBe(false)
    expect(isMediaPreparationBlocked(media())).toBe(false)
    expect(isMediaPreparationBlocked(undefined)).toBe(false)
  })

  it('reports whole percent progress', () => {
    expect(mediaPreparationPercent(media({ status: 'preparing', progress: 0.426 }))).toBe(43)
    expect(mediaPreparationPercent(media({ status: 'preparing' }))).toBe(0)
  })

  it('describes the working copy from and to', () => {
    const label = describeWorkingCopy(
      media({
        status: 'ready',
        action: 'hevc',
        settings: 'libx265 preset medium (Main10) CRF 12 yuv422p10le',
        original: {
          video: { codec: 'prores', profile: 'HQ', bitDepth: 10, pixFmt: 'yuv422p10le' },
        },
        derivative: { video: { codec: 'hevc', bitDepth: 10, pixFmt: 'yuv422p10le' } },
        notes: ['12-bit source stored as 10-bit'],
      }),
    )
    expect(label).toContain('ProRes HQ 10-bit (yuv422p10le) → HEVC 10-bit (yuv422p10le)')
    expect(label).toContain('12-bit source stored as 10-bit')
    expect(label).toContain('original is untouched')
    expect(describeWorkingCopy(media({ status: 'preparing' }))).toBeNull()
    expect(
      describeWorkingCopy(
        media({
          status: 'ready',
          action: 'rewrap',
          original: { video: { codec: 'h264' }, audio: { codec: 'ac3' } },
          derivative: { video: { codec: 'h264' }, audio: { codec: 'pcm_f32le' } },
        }),
      ),
    ).toContain('video copied bit for bit')
  })
})
