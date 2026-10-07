import { beforeEach, describe, expect, it, vi } from 'vitest'

const decode = vi.fn()
vi.mock('@/runtime/composition-runtime/utils/audio-decode-cache', () => ({
  getOrDecodeAudio: (...args: unknown[]) => decode(...args),
}))

import { useBeatsStore } from './beats'

function fakeBuffer(seconds: number) {
  const data = new Float32Array(44100 * seconds)
  for (let t = 0.2; t < seconds - 0.1; t += 0.5) {
    const start = Math.round(t * 44100)
    for (let i = 0; i < 400; i++) data[start + i] = 0.8 * Math.exp(-i / 80) * Math.sin(i / 7)
  }
  return { sampleRate: 44100, numberOfChannels: 1, getChannelData: () => data }
}

describe('useBeatsStore', () => {
  beforeEach(() => {
    decode.mockReset()
    useBeatsStore.setState({ byMediaId: {} })
  })

  it('goes pending, then holds the analysis, and decodes once', async () => {
    decode.mockResolvedValue(fakeBuffer(8))
    useBeatsStore.getState().request('m1', 'blob:x')
    useBeatsStore.getState().request('m1', 'blob:x')
    expect(useBeatsStore.getState().byMediaId.m1).toBe('pending')
    await vi.waitFor(() => expect(typeof useBeatsStore.getState().byMediaId.m1).toBe('object'))
    const entry = useBeatsStore.getState().byMediaId.m1
    expect(entry).toMatchObject({ bpm: expect.any(Number) })
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('records a failed decode', async () => {
    decode.mockRejectedValue(new Error('nope'))
    useBeatsStore.getState().request('m2', 'blob:y')
    await vi.waitFor(() => expect(useBeatsStore.getState().byMediaId.m2).toBe('failed'))
  })
})
