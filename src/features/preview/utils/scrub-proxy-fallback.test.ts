// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  cacheFallback: vi.fn(() => true),
  getFallback: vi.fn(() => null),
  getExact: vi.fn((): unknown => null),
  isSuperseded: vi.fn(() => false),
  isActiveTarget: vi.fn(() => true),
  getMediaIdByUrl: vi.fn(() => 'media-1'),
  loadFromDisk: vi.fn(),
  frameSize: { width: 480, height: 270 },
  createImageBitmap: vi.fn(),
  filmstrip: {
    frames: [
      { timestamp: 1, url: 'blob:one', bitmap: { width: 480, height: 270 } },
      { timestamp: 2, url: 'blob:two', bitmap: { width: 480, height: 270 } },
    ],
    isComplete: true,
    isExtracting: false,
    progress: 1,
  } as { frames: Array<{ timestamp: number; url: string; bitmap?: object }> } | null,
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: { getMediaIdByUrl: mocks.getMediaIdByUrl },
}))
vi.mock('../deps/media-library-contract', () => ({
  proxyService: {
    getMediaIdByProxyUrl: vi.fn(() => null),
  },
  useMediaLibraryStore: {
    getState: () => ({
      mediaById: {
        'media-1': {
          id: 'media-1',
          mimeType: 'video/mp4',
          duration: 10,
          width: 1920,
          height: 1080,
          storageType: 'opfs',
          opfsPath: 'media/1/data',
        },
      },
    }),
  },
}))
vi.mock('../deps/timeline-filmstrip', () => ({
  importFilmstripCache: async () => ({
    filmstripCache: {
      prewarm: vi.fn(),
      getFromCacheSync: () => mocks.filmstrip,
      loadFromDisk: mocks.loadFromDisk,
    },
  }),
}))
vi.mock('./decoder-prewarm', () => ({
  cacheActivePreviewFallbackBitmap: mocks.cacheFallback,
  getCachedActivePreviewFallbackBitmap: mocks.getFallback,
  getCachedPredecodedBitmap: mocks.getExact,
  isActivePreviewSourceTarget: mocks.isActiveTarget,
  isActivePreviewTargetSuperseded: mocks.isSuperseded,
}))

import {
  disposeScrubProxyFallback,
  isScrubProxyFallbackLegible,
  measureScrubProxyFallbackDisplay,
  scheduleScrubProxyFallback,
  shouldPublishScrubProxyFallback,
} from './scrub-proxy-fallback'

const PLAYER = { width: 1080, height: 1920 }
const held = { display: PLAYER, requireActiveTarget: true }
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
let decodedBitmaps: Array<{ close: ReturnType<typeof vi.fn>; width: number; height: number }> = []

beforeEach(() => {
  vi.clearAllMocks()
  disposeScrubProxyFallback()
  decodedBitmaps = []
  mocks.frameSize = { width: 480, height: 270 }
  mocks.getExact.mockReturnValue(null)
  mocks.isActiveTarget.mockReturnValue(true)
  mocks.isSuperseded.mockReturnValue(false)
  mocks.createImageBitmap.mockImplementation(async () => {
    const bitmap = { close: vi.fn(), ...mocks.frameSize }
    decodedBitmaps.push(bitmap)
    return bitmap
  })
  vi.stubGlobal('createImageBitmap', mocks.createImageBitmap)
})

describe('scrub proxy fallback', () => {
  it('publishes the nearest cached filmstrip frame without generating a proxy', async () => {
    scheduleScrubProxyFallback('blob:source', 2.1, held)

    await vi.waitFor(() => expect(mocks.cacheFallback).toHaveBeenCalledOnce())
    expect(mocks.cacheFallback).toHaveBeenCalledWith(
      'blob:source',
      2.1,
      2,
      expect.objectContaining({ width: 480, height: 270 }),
    )
  })

  it('does not publish a filmstrip frame that is too far from the requested timestamp', async () => {
    scheduleScrubProxyFallback('blob:source', 8, held)
    await flush()
    expect(mocks.cacheFallback).not.toHaveBeenCalled()
  })

  it('never publishes a thumbnail magnified past the legibility limit', async () => {
    // The 9:16 timeline tile (65x116) on a 1080x1920 preview is ~9x magnified.
    mocks.frameSize = { width: 65, height: 116 }
    scheduleScrubProxyFallback('blob:source', 2, held)
    await vi.waitFor(() => expect(decodedBitmaps[0]?.close).toHaveBeenCalledOnce())
    expect(mocks.cacheFallback).not.toHaveBeenCalled()

    // The size is remembered per media: later targets skip the filmstrip read.
    scheduleScrubProxyFallback('blob:source', 1, held)
    await flush()
    expect(mocks.createImageBitmap).toHaveBeenCalledOnce()
  })

  it('drops a fallback that arrives after the exact frame for the same target', async () => {
    mocks.getExact.mockReturnValue({ width: 1080, height: 1920 })
    scheduleScrubProxyFallback('blob:source', 2, held)
    await vi.waitFor(() => expect(decodedBitmaps[0]?.close).toHaveBeenCalledOnce())
    expect(mocks.cacheFallback).not.toHaveBeenCalled()
  })

  it('drops a held-scrub fallback once its target is no longer active', async () => {
    mocks.isActiveTarget.mockReturnValue(false)
    scheduleScrubProxyFallback('blob:source', 2, held)
    await vi.waitFor(() => expect(decodedBitmaps[0]?.close).toHaveBeenCalledOnce())
    expect(mocks.cacheFallback).not.toHaveBeenCalled()
  })

  it('lets reverse playback publish without an active held target', async () => {
    mocks.isActiveTarget.mockReturnValue(false)
    scheduleScrubProxyFallback('blob:source', 2, { display: PLAYER, requireActiveTarget: false })
    await vi.waitFor(() => expect(mocks.cacheFallback).toHaveBeenCalledOnce())
  })

  it('does not publish when the preview size is unknown', async () => {
    scheduleScrubProxyFallback('blob:source', 2, { display: null, requireActiveTarget: true })
    await vi.waitFor(() => expect(decodedBitmaps[0]?.close).toHaveBeenCalledOnce())
    expect(mocks.cacheFallback).not.toHaveBeenCalled()
  })
})

describe('isScrubProxyFallbackLegible', () => {
  it('allows up to 4x magnification of the contained thumbnail and nothing beyond', () => {
    expect(isScrubProxyFallbackLegible({ width: 270, height: 480 }, PLAYER)).toBe(true)
    expect(isScrubProxyFallbackLegible({ width: 269, height: 479 }, PLAYER)).toBe(false)
    expect(isScrubProxyFallbackLegible({ width: 65, height: 116 }, PLAYER)).toBe(false)
    // The same tile on a small (464 px tall) player is legible.
    expect(
      isScrubProxyFallbackLegible({ width: 65, height: 116 }, { width: 261, height: 464 }),
    ).toBe(true)
  })

  it('measures letterboxed media by the size it is actually drawn at', () => {
    // A 16:9 tile in a 9:16 preview is drawn 1080 px wide: 206 px wide is 5.2x.
    expect(isScrubProxyFallbackLegible({ width: 206, height: 116 }, PLAYER)).toBe(false)
    expect(isScrubProxyFallbackLegible({ width: 270, height: 152 }, PLAYER)).toBe(true)
  })

  it('rejects empty frames and unknown displays', () => {
    expect(isScrubProxyFallbackLegible({ width: 0, height: 0 }, PLAYER)).toBe(false)
    expect(isScrubProxyFallbackLegible({ width: 480, height: 270 }, null)).toBe(false)
    expect(isScrubProxyFallbackLegible({ width: 480, height: 270 }, { width: 0, height: 10 })).toBe(
      false,
    )
  })
})

describe('shouldPublishScrubProxyFallback', () => {
  it('requires a missing exact frame, a live target and, for held scrubs, an active one', () => {
    expect(shouldPublishScrubProxyFallback('blob:a', 1, true)).toBe(true)
    mocks.isSuperseded.mockReturnValue(true)
    expect(shouldPublishScrubProxyFallback('blob:a', 1, false)).toBe(false)
    mocks.isSuperseded.mockReturnValue(false)
    mocks.isActiveTarget.mockReturnValue(false)
    expect(shouldPublishScrubProxyFallback('blob:a', 1, true)).toBe(false)
    expect(shouldPublishScrubProxyFallback('blob:a', 1, false)).toBe(true)
    mocks.getExact.mockReturnValue({})
    expect(shouldPublishScrubProxyFallback('blob:a', 1, false)).toBe(false)
  })
})

describe('measureScrubProxyFallbackDisplay', () => {
  it('returns the laid-out size in device pixels', () => {
    expect(measureScrubProxyFallbackDisplay({ clientWidth: 300, clientHeight: 533 }, 2)).toEqual({
      width: 600,
      height: 1066,
    })
    expect(measureScrubProxyFallbackDisplay({ clientWidth: 300, clientHeight: 533 }, 0)).toEqual({
      width: 300,
      height: 533,
    })
    expect(measureScrubProxyFallbackDisplay({ clientWidth: 0, clientHeight: 0 }, 2)).toBeNull()
    expect(measureScrubProxyFallbackDisplay(null, 2)).toBeNull()
  })
})
