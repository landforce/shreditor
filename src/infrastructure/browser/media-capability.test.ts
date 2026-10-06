import { describe, expect, it, vi, afterEach } from 'vite-plus/test'
import { probeFrameDecoding, probeDomPlayback } from './media-capability'

afterEach(() => vi.unstubAllGlobals())
describe('media capability routing', () => {
  it('does not promote a missing or failed probe to supported', async () => {
    expect(await probeFrameDecoding({})).toBe('unknown')
    expect(
      await probeFrameDecoding({
        canDecode: async () => {
          throw new Error('quota')
        },
      }),
    ).toBe('unknown')
    expect(await probeFrameDecoding({ canDecode: async () => false })).toBe('unsupported')
  })
  it('keeps custom frame decode support independent of DOM playback', async () => {
    vi.stubGlobal('navigator', {
      mediaCapabilities: { decodingInfo: async () => ({ supported: false }) },
    })
    expect(await probeFrameDecoding({ canDecode: async () => true })).toBe('supported')
    expect(
      await probeDomPlayback({
        contentType: 'video/quicktime; codecs="ap4h"',
        width: 64,
        height: 48,
        bitrate: 1000,
        framerate: 30,
      }),
    ).toBe('unsupported')
  })
})
