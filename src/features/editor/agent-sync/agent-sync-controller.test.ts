import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTOSAVE_DELAY_MS,
  AgentSyncController,
  type AgentSyncDeps,
  type AgentSyncStatus,
  type EditorStateReport,
} from './agent-sync-controller'

function setup(overrides: Partial<AgentSyncDeps> = {}) {
  const state = {
    dirty: false,
    busy: false,
    status: 'synced' as AgentSyncStatus,
    revision: 'sha256:a',
    saveRequest: null as string | null,
  }
  const reports: EditorStateReport[] = []
  const save = vi.fn(async () => {
    state.dirty = false
    state.revision = 'sha256:b'
  })
  const controller = new AgentSyncController({
    projectId: 'p1',
    tabId: 't1',
    save,
    isDirty: () => state.dirty,
    markDirty: () => (state.dirty = true),
    isBusy: () => state.busy,
    status: () => state.status,
    revision: () => state.revision,
    send: async (report) => {
      reports.push(report)
      return { saveRequest: state.saveRequest }
    },
    ...overrides,
  })
  return { state, reports, save, controller }
}

const edit = (s: ReturnType<typeof setup>) => {
  s.state.dirty = true
  s.controller.noteEdit()
}

describe('AgentSyncController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves once, 1.5s after the last edit settles', async () => {
    const s = setup()
    s.controller.start()
    edit(s)
    await vi.advanceTimersByTimeAsync(1000)
    edit(s)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100)
    expect(s.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(s.save).toHaveBeenCalledTimes(1)
    s.controller.stop()
  })

  it('waits for a gesture to finish', async () => {
    const s = setup()
    s.state.busy = true
    edit(s)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3)
    expect(s.save).not.toHaveBeenCalled()
    s.state.busy = false
    await vi.advanceTimersByTimeAsync(400)
    expect(s.save).toHaveBeenCalledTimes(1)
    s.controller.stop()
  })

  it('never autosaves during a conflict', async () => {
    const s = setup()
    s.state.status = 'conflict'
    edit(s)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3)
    expect(s.save).not.toHaveBeenCalled()
    s.controller.stop()
  })

  it('does not autosave when autosave is off, but honours a save request', async () => {
    const s = setup({ autosave: false })
    s.controller.start()
    edit(s)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2)
    expect(s.save).not.toHaveBeenCalled()
    s.state.saveRequest = 'req-1'
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.save).toHaveBeenCalledTimes(1)
    // The same request is not honoured twice.
    s.state.dirty = true
    await vi.advanceTimersByTimeAsync(3000)
    expect(s.save).toHaveBeenCalledTimes(1)
    s.controller.stop()
  })

  it('re-flags an edit that landed during the save', async () => {
    const s = setup()
    let release = () => {}
    s.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            s.state.dirty = false
            resolve()
          }
        }),
    )
    edit(s)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect(s.save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(50)
    s.controller.noteEdit() // edit while writing
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.state.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect(s.save).toHaveBeenCalledTimes(2)
    s.controller.stop()
  })

  it('reports dirty state and revision, and closes on stop', async () => {
    const s = setup()
    s.controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.reports.at(-1)).toMatchObject({ projectId: 'p1', dirty: false, revision: 'sha256:a' })
    edit(s)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.reports.at(-1)).toMatchObject({ dirty: true })
    expect(s.reports.at(-1)?.lastEditAt).toEqual(expect.any(Number))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10)
    expect(s.reports.at(-1)).toMatchObject({ dirty: false, revision: 'sha256:b' })
    s.controller.stop()
    expect(s.reports.at(-1)).toMatchObject({ closed: true })
  })
})
