import { describe, expect, it, vi } from 'vite-plus/test'
import { VideoFrameExtractor } from './canvas-video-extractor'

describe('VideoFrameExtractor lifecycle', () => {
  it('closes a sample yielded after the extractor was disposed', async () => {
    let resolveNext!: (result: IteratorResult<{ close: () => void }>) => void
    const nextResult = new Promise<IteratorResult<{ close: () => void }>>((resolve) => {
      resolveNext = resolve
    })
    const sample = { close: vi.fn() }
    const iterator = {
      next: vi.fn(() => nextResult),
      return: vi.fn(async () => ({ value: undefined, done: true as const })),
      throw: vi.fn(async (error: unknown) => {
        throw error
      }),
      [Symbol.asyncIterator]() {
        return this
      },
    }

    const extractor = new VideoFrameExtractor('blob:test', 'test-item')
    const internals = extractor as unknown as {
      sampleIterator: typeof iterator | null
      peekNextSample: () => Promise<{ close: () => void } | null>
    }
    internals.sampleIterator = iterator

    const pendingSample = internals.peekNextSample()
    extractor.dispose()
    resolveNext({ value: sample, done: false })

    await expect(pendingSample).resolves.toBeNull()
    expect(sample.close).toHaveBeenCalledTimes(1)
    expect(iterator.return).toHaveBeenCalledTimes(1)
  })
})

describe('VideoFrameExtractor bounded recovery', () => {
  it('tries alternative acceleration modes once and stops after exhaustion', async () => {
    const extractor = new VideoFrameExtractor('blob:test', 'item')
    const modes: string[] = []
    const internals = extractor as unknown as {
      sinkFactory: (mode: string) => unknown
      ensureSampleForTimestamp: () => Promise<void>
      recoverAndPrime: (time: number, error: Error) => Promise<boolean>
    }
    internals.sinkFactory = (mode) => {
      modes.push(mode)
      return {}
    }
    internals.ensureSampleForTimestamp = async () => {
      throw new Error('decoder resource exhausted')
    }
    expect(await internals.recoverAndPrime(0, new Error('decoder resource exhausted'))).toBe(false)
    expect(await internals.recoverAndPrime(0, new Error('decoder resource exhausted'))).toBe(false)
    expect(modes).toEqual(['prefer-software', 'prefer-hardware'])
    extractor.dispose()
  })

  it('closes a late sample after timeout and allows stream disposal', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (value: IteratorResult<{ close: () => void }>) => void
      const pending = new Promise<IteratorResult<{ close: () => void }>>((r) => {
        resolve = r
      })
      const extractor = new VideoFrameExtractor('blob:test', 'item')
      const internals = extractor as unknown as {
        sampleIterator: unknown
        peekNextSample: () => Promise<unknown>
      }
      internals.sampleIterator = { next: () => pending, return: async () => ({ done: true }) }
      const result = internals.peekNextSample()
      const assertion = expect(result).rejects.toThrow('Video decode timeout')
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
      extractor.dispose()
      const sample = { close: vi.fn() }
      resolve({ done: false, value: sample })
      await Promise.resolve()
      expect(sample.close).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
