import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { useTimelineSettingsStore } from '@/features/editor/deps/timeline-store'
import { isAgentEditLocked, refuseEditWhileAgentWorks } from '@/shared/state/agent-edit-lock'
import { PASS_READY_MS, receiveAgentActivity, useAgentActivityStore } from './agent-activity-store'
import { useProjectSyncStore } from './sync-store'
import { enterAgentWatchMode } from './use-agent-watch-mode'

const working = {
  state: 'working',
  label: 'Tighten the opening',
  startedAt: '2026-10-06T12:00:00Z',
}

describe('agent activity record in the editor', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-10-06T12:01:00Z') }))
  afterEach(() => {
    receiveAgentActivity(null)
    vi.useRealTimers()
  })

  it('takes the record from bridge replies; anything unreadable is idle', () => {
    receiveAgentActivity(working)
    expect(useAgentActivityStore.getState().activity).toMatchObject({ state: 'working' })
    receiveAgentActivity({ state: 'bogus' })
    expect(useAgentActivityStore.getState().activity).toEqual({ state: 'idle' })
    receiveAgentActivity(undefined)
    expect(useAgentActivityStore.getState().activity).toEqual({ state: 'idle' })
  })

  it('flips to "Pass ready" for a few seconds when a pass is published', async () => {
    receiveAgentActivity(working)
    const published = {
      state: 'idle',
      ended: 'published',
      label: 'Pass 2',
      endedAt: new Date(Date.now() - 500).toISOString(),
    }
    receiveAgentActivity(published)
    expect(useAgentActivityStore.getState().passReady).toEqual({ label: 'Pass 2' })
    receiveAgentActivity({ ...published }) // the next heartbeat repeats it: no restart
    await vi.advanceTimersByTimeAsync(PASS_READY_MS + 10)
    expect(useAgentActivityStore.getState().passReady).toBeNull()
  })

  it('does not announce an old publish or a pass that ended another way', () => {
    receiveAgentActivity({ state: 'idle', ended: 'published', endedAt: '2026-10-06T11:00:00Z' })
    expect(useAgentActivityStore.getState().passReady).toBeNull()
    receiveAgentActivity({ state: 'idle', ended: 'done', endedAt: new Date().toISOString() })
    expect(useAgentActivityStore.getState().passReady).toBeNull()
  })
})

describe('watch mode', () => {
  let leave: () => void = () => {}
  beforeEach(() => {
    vi.mocked(toast.info).mockClear()
    useTimelineSettingsStore.setState({ isDirty: false, isTimelineLoading: false })
    useProjectSyncStore.setState({ status: 'synced', lastExternalLoadAt: null })
  })
  afterEach(() => leave())

  it('locks edits, tells the user at most every few seconds, and unlocks on leave', () => {
    leave = enterAgentWatchMode()
    expect(isAgentEditLocked()).toBe(true)
    expect(refuseEditWhileAgentWorks()).toBe(true)
    expect(refuseEditWhileAgentWorks()).toBe(true)
    expect(toast.info).toHaveBeenCalledTimes(1)
    leave()
    expect(isAgentEditLocked()).toBe(false)
  })

  it('lets the editor load the agent pass while locked', () => {
    leave = enterAgentWatchMode()
    useProjectSyncStore.setState({ status: 'reloading' })
    expect(isAgentEditLocked()).toBe(false)
    useProjectSyncStore.setState({ status: 'synced', lastExternalLoadAt: Date.now() })
    expect(isAgentEditLocked()).toBe(false)
    useProjectSyncStore.setState({ lastExternalLoadAt: Date.now() - 5000 })
    expect(isAgentEditLocked()).toBe(true)
  })

  it('keeps a clean editor clean (nothing for autosave to write)', () => {
    leave = enterAgentWatchMode()
    useTimelineSettingsStore.getState().markDirty()
    expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
    leave()
    useTimelineSettingsStore.getState().markDirty()
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
  })

  it('leaves edits made before the pass began unsaved, not discarded', () => {
    useTimelineSettingsStore.setState({ isDirty: true })
    leave = enterAgentWatchMode()
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
  })
})
