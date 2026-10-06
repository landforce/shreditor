/**
 * Watch mode while an agent is mid-pass on the open project.
 *
 * The editor (agent-sync) sets it from the project's agent-activity record;
 * the timeline command store and the few project-level writes ask it before
 * changing anything. Playback, scrubbing, selection and panels never ask, so
 * they keep working.
 */

interface AgentEditLock {
  locked: boolean
  /** True while the editor itself is loading the project (e.g. the agent's pass landing). */
  isExempt: () => boolean
  /** Tell the user why their edit did not happen. */
  onRefused: () => void
}

const UNLOCKED: AgentEditLock = { locked: false, isExempt: () => false, onRefused: () => {} }
let lock: AgentEditLock = UNLOCKED

/** Set (or with null, clear) watch mode. */
export function setAgentEditLock(next: AgentEditLock | null): void {
  lock = next ?? UNLOCKED
}

/** Whether an edit made now must wait for the agent. */
export function isAgentEditLocked(): boolean {
  return lock.locked && !lock.isExempt()
}

/** True when the edit must wait for the agent; the user is told. */
export function refuseEditWhileAgentWorks(): boolean {
  if (!isAgentEditLocked()) return false
  lock.onRefused()
  return true
}
