import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  version: vi.fn<() => Promise<string | null>>(),
  refresh: vi.fn(async () => {}),
  state: {
    currentProjectId: 'p1' as string | null,
    isLoading: false,
    importingIds: [] as string[],
  },
}))

vi.mock('@/infrastructure/storage/bridge-fs/bridge-media', () => ({
  readProjectMediaVersion: mocks.version,
}))

vi.mock('@/features/editor/deps/media-library', () => ({
  useMediaLibraryStore: {
    getState: () => ({ ...mocks.state, refreshMediaItems: mocks.refresh }),
  },
}))

import { useProjectMediaWatcher } from './use-project-media-watcher'

async function poll(times = 1) {
  for (let i = 0; i < times; i += 1) await vi.advanceTimersByTimeAsync(1000)
}

describe('useProjectMediaWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.version.mockReset()
    mocks.refresh.mockClear()
    mocks.state.currentProjectId = 'p1'
    mocks.state.isLoading = false
    mocks.state.importingIds = []
  })

  afterEach(() => vi.useRealTimers())

  it('refreshes the library only when the media stamp moves', async () => {
    mocks.version.mockResolvedValue('1.1.100')
    const { unmount } = renderHook(() => useProjectMediaWatcher('p1'))
    await poll(2)
    expect(mocks.refresh).not.toHaveBeenCalled()

    mocks.version.mockResolvedValue('2.2.200')
    await poll()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    await poll()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('waits while the library loads, imports, or shows another project', async () => {
    mocks.version.mockResolvedValue('1.1.100')
    renderHook(() => useProjectMediaWatcher('p1'))
    await poll()
    mocks.version.mockResolvedValue('2.2.200')

    mocks.state.isLoading = true
    await poll()
    mocks.state.isLoading = false
    mocks.state.importingIds = ['m1']
    await poll()
    mocks.state.importingIds = []
    mocks.state.currentProjectId = 'other'
    await poll()
    expect(mocks.refresh).not.toHaveBeenCalled()

    mocks.state.currentProjectId = 'p1'
    await poll()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a bridge, and retries after a failed check', async () => {
    mocks.version.mockResolvedValue(null)
    renderHook(() => useProjectMediaWatcher('p1'))
    await poll(2)
    mocks.version.mockResolvedValueOnce('1.1.100').mockRejectedValueOnce(new Error('offline'))
    await poll(2)
    mocks.version.mockResolvedValue('3.3.300')
    await poll()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
