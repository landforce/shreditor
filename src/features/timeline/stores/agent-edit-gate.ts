/**
 * The timeline's side of watch mode (see `@/shared/state/agent-edit-lock`):
 * while an agent is mid-pass, a command that changes the project is undone as
 * soon as it runs and never reaches the undo history. Running it first and
 * restoring the snapshot keeps every caller's flow intact (drags end, return
 * values exist), so nothing is left half-applied.
 */
import { isAgentEditLocked, refuseEditWhileAgentWorks } from '@/shared/state/agent-edit-lock'
import { restoreSnapshot } from './commands/snapshot'
import type { TimelineSnapshot } from './commands/types'

/** View settings and project loading: allowed in watch mode. */
const WATCH_MODE_COMMANDS = new Set(['TOGGLE_SNAP', 'TOGGLE_AUDIO_SKIMMING', 'CLEAR_TIMELINE'])

/** Whether a command of this type has to wait for the agent right now. */
export function mustWaitForAgent(type: string): boolean {
  return !WATCH_MODE_COMMANDS.has(type) && isAgentEditLocked()
}

/** Put back what a refused command changed, and tell the user. */
export function refuseRanEdit(before: TimelineSnapshot): void {
  restoreSnapshot(before)
  refuseEditWhileAgentWorks()
}
