/**
 * Guarantees that a settled preview target ends up showing its exact frame.
 *
 * The held-scrub lane presents a frame only once its worker decode lands (or,
 * while the pointer still moves, a scrub fallback). If that decode is slow,
 * hung or cancelled, nothing else would ever replace what is on screen: a
 * thumbnail fallback could stay up indefinitely, or the previous target's
 * frame could sit under a new playhead. The watchdog arms when a target is
 * requested, waits while the pointer is still moving, and once the target is
 * settled escalates to the ordinary exact render path, retrying with backoff
 * until an exact presentation of that target is seen or the target changes.
 */

/** How long a settled target may wait for its exact worker frame. */
export const SETTLED_EXACT_DEADLINE_MS = 500
/** Retries back off from the deadline up to this interval. */
export const SETTLED_EXACT_MAX_RETRY_MS = 4000

export type SettledExactAction =
  | { kind: 'disarm' }
  | { kind: 'wait'; delayMs: number }
  | { kind: 'escalate'; nextDelayMs: number }

export interface SettledExactState {
  /** Frame the watchdog was armed for. */
  watchedFrame: number
  /** Escalations already issued for this frame. */
  attempts: number
  /** Current target: preview (hover/drag) frame or paused playhead; null while playing. */
  target: number | null
  /** The pointer is still moving through the target, so a fallback is fine. */
  moving: boolean
  /** The exact frame for `watchedFrame` is what the preview shows. */
  exactOnScreen: boolean
}

export function resolveSettledExactAction(state: SettledExactState): SettledExactAction {
  if (state.target !== state.watchedFrame || state.exactOnScreen) return { kind: 'disarm' }
  if (state.moving) return { kind: 'wait', delayMs: SETTLED_EXACT_DEADLINE_MS }
  return {
    kind: 'escalate',
    nextDelayMs: Math.min(
      SETTLED_EXACT_MAX_RETRY_MS,
      SETTLED_EXACT_DEADLINE_MS * 2 ** (state.attempts + 1),
    ),
  }
}

export interface SettledExactWatchdogDeps {
  getTarget: () => number | null
  isMoving: (frame: number) => boolean
  isExactOnScreen: (frame: number) => boolean
  /** Render `frame` through the exact path (no fallback, no worker-only gate). */
  escalate: (frame: number, attempt: number) => void
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

export interface SettledExactWatchdog {
  /** A target was requested: watch it (no-op when already watching that frame). */
  arm: (frame: number) => void
  /** A frame reached the screen; an exact presentation of the watched frame disarms. */
  notePresented: (frame: number, usedFallback: boolean) => void
  dispose: () => void
}

export function createSettledExactWatchdog(deps: SettledExactWatchdogDeps): SettledExactWatchdog {
  const setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle))
  let watched: { frame: number; attempts: number } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }
  const disarm = () => {
    cancelTimer()
    watched = null
  }
  const schedule = (delayMs: number) => {
    cancelTimer()
    timer = setTimer(tick, delayMs)
  }
  function tick() {
    timer = null
    if (!watched) return
    const action = resolveSettledExactAction({
      watchedFrame: watched.frame,
      attempts: watched.attempts,
      target: deps.getTarget(),
      moving: deps.isMoving(watched.frame),
      exactOnScreen: deps.isExactOnScreen(watched.frame),
    })
    if (action.kind === 'disarm') {
      disarm()
      return
    }
    if (action.kind === 'wait') {
      schedule(action.delayMs)
      return
    }
    const attempt = watched.attempts
    watched.attempts += 1
    schedule(action.nextDelayMs)
    deps.escalate(watched.frame, attempt)
  }

  const arm = (frame: number) => {
    if (watched?.frame === frame && timer !== null) return
    watched = { frame, attempts: watched?.frame === frame ? watched.attempts : 0 }
    schedule(SETTLED_EXACT_DEADLINE_MS)
  }

  return {
    arm,
    notePresented(frame, usedFallback) {
      if (usedFallback) arm(frame)
      else if (watched?.frame === frame) disarm()
    },
    dispose: disarm,
  }
}
