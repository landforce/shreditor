// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  SETTLED_EXACT_DEADLINE_MS,
  SETTLED_EXACT_MAX_RETRY_MS,
  createSettledExactWatchdog,
  resolveSettledExactAction,
} from './settled-exact-watchdog'

describe('resolveSettledExactAction', () => {
  const base = { watchedFrame: 315, attempts: 0, target: 315, moving: false, exactOnScreen: false }

  it('disarms once the target moved on or its exact frame is on screen', () => {
    expect(resolveSettledExactAction({ ...base, target: 316 })).toEqual({ kind: 'disarm' })
    expect(resolveSettledExactAction({ ...base, target: null })).toEqual({ kind: 'disarm' })
    expect(resolveSettledExactAction({ ...base, exactOnScreen: true })).toEqual({ kind: 'disarm' })
  })

  it('waits while the pointer is still moving through the target', () => {
    expect(resolveSettledExactAction({ ...base, moving: true })).toEqual({
      kind: 'wait',
      delayMs: SETTLED_EXACT_DEADLINE_MS,
    })
  })

  it('escalates a settled target and backs off between retries', () => {
    expect(resolveSettledExactAction(base)).toEqual({
      kind: 'escalate',
      nextDelayMs: SETTLED_EXACT_DEADLINE_MS * 2,
    })
    expect(resolveSettledExactAction({ ...base, attempts: 10 })).toEqual({
      kind: 'escalate',
      nextDelayMs: SETTLED_EXACT_MAX_RETRY_MS,
    })
  })
})

describe('createSettledExactWatchdog', () => {
  let target: number | null
  let moving: boolean
  let exactOnScreen: boolean
  const escalate = vi.fn()

  const create = () =>
    createSettledExactWatchdog({
      getTarget: () => target,
      isMoving: () => moving,
      isExactOnScreen: () => exactOnScreen,
      escalate,
    })

  beforeEach(() => {
    vi.useFakeTimers()
    target = 315
    moving = false
    exactOnScreen = false
    escalate.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('replaces a fallback left on a settled frame with an exact render, retrying until it lands', () => {
    const watchdog = create()
    watchdog.arm(315)
    watchdog.notePresented(315, true)

    vi.advanceTimersByTime(SETTLED_EXACT_DEADLINE_MS - 1)
    expect(escalate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(escalate).toHaveBeenCalledWith(315, 0)

    // The first exact render failed too: retry after the backoff.
    vi.advanceTimersByTime(SETTLED_EXACT_DEADLINE_MS * 2)
    expect(escalate).toHaveBeenLastCalledWith(315, 1)

    watchdog.notePresented(315, false)
    vi.advanceTimersByTime(SETTLED_EXACT_MAX_RETRY_MS * 4)
    expect(escalate).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the exact frame arrives before the deadline', () => {
    const watchdog = create()
    watchdog.arm(315)
    vi.advanceTimersByTime(100)
    watchdog.notePresented(315, false)
    vi.advanceTimersByTime(SETTLED_EXACT_MAX_RETRY_MS)
    expect(escalate).not.toHaveBeenCalled()
  })

  it('keeps waiting while the pointer moves, then escalates once it settles', () => {
    const watchdog = create()
    moving = true
    watchdog.arm(315)
    vi.advanceTimersByTime(SETTLED_EXACT_DEADLINE_MS * 3)
    expect(escalate).not.toHaveBeenCalled()
    moving = false
    vi.advanceTimersByTime(SETTLED_EXACT_DEADLINE_MS)
    expect(escalate).toHaveBeenCalledOnce()
  })

  it('stops watching when the target changes or the exact frame is already shown', () => {
    const watchdog = create()
    watchdog.arm(315)
    target = 320
    vi.advanceTimersByTime(SETTLED_EXACT_DEADLINE_MS)
    expect(escalate).not.toHaveBeenCalled()

    target = 315
    exactOnScreen = true
    watchdog.arm(315)
    vi.advanceTimersByTime(SETTLED_EXACT_DEADLINE_MS)
    expect(escalate).not.toHaveBeenCalled()
  })

  it('does not restart the deadline when the same target is re-armed', () => {
    const watchdog = create()
    watchdog.arm(315)
    vi.advanceTimersByTime(SETTLED_EXACT_DEADLINE_MS - 100)
    watchdog.arm(315)
    vi.advanceTimersByTime(100)
    expect(escalate).toHaveBeenCalledOnce()
  })

  it('ignores presentations of other frames and can be disposed', () => {
    const watchdog = create()
    watchdog.arm(315)
    watchdog.notePresented(314, false)
    watchdog.dispose()
    vi.advanceTimersByTime(SETTLED_EXACT_MAX_RETRY_MS)
    expect(escalate).not.toHaveBeenCalled()
  })
})
