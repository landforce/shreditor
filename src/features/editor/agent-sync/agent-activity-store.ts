import { create } from 'zustand'

/**
 * Whether an agent is mid-pass on the open project, from the record the
 * workspace bridge keeps at projects/<id>/agent/activity.json (see
 * server/agent-activity.mjs). It arrives with every editor-state heartbeat
 * (about once a second) and with the reply to the banner's buttons. The
 * bridge already reads a pass with no heartbeat for 10 minutes as idle.
 */
type AgentActivityState = 'working' | 'cancelled' | 'released' | 'idle'

interface AgentActivity {
  state: AgentActivityState
  label?: string | null
  startedAt?: string
  /** How the last pass ended: published, done, refused, cancelled, stale. */
  ended?: string
  endedAt?: string
}

interface AgentActivityStore {
  activity: AgentActivity
  /** Set for a few seconds after a pass is published: the banner says it is ready. */
  passReady: { label: string | null } | null
}

const IDLE: AgentActivity = { state: 'idle' }
const STATES = new Set<string>(['working', 'cancelled', 'released', 'idle'])
export const PASS_READY_MS = 4000
/** A publish older than this when the editor first hears of it is not news. */
const PASS_READY_FRESH_MS = 15_000

export const useAgentActivityStore = create<AgentActivityStore>()(() => ({
  activity: IDLE,
  passReady: null,
}))

function isActivity(value: unknown): value is AgentActivity {
  return (
    typeof value === 'object' &&
    value !== null &&
    STATES.has(String((value as { state?: unknown }).state))
  )
}

const sameActivity = (a: AgentActivity, b: AgentActivity) =>
  a.state === b.state &&
  a.label === b.label &&
  a.startedAt === b.startedAt &&
  a.endedAt === b.endedAt

let passReadyTimer: ReturnType<typeof setTimeout> | null = null

function isNewPublish(next: AgentActivity, previous: AgentActivity): boolean {
  if (next.state !== 'idle' || next.ended !== 'published' || !next.endedAt) return false
  if (next.endedAt === previous.endedAt) return false
  return Date.now() - Date.parse(next.endedAt) < PASS_READY_FRESH_MS
}

/** Take the record from a bridge reply; anything unreadable counts as idle. */
export function receiveAgentActivity(value: unknown): void {
  const next = isActivity(value) ? value : IDLE
  const { activity: previous } = useAgentActivityStore.getState()
  if (sameActivity(next, previous)) return
  if (isNewPublish(next, previous)) {
    if (passReadyTimer) clearTimeout(passReadyTimer)
    passReadyTimer = setTimeout(
      () => useAgentActivityStore.setState({ passReady: null }),
      PASS_READY_MS,
    )
    useAgentActivityStore.setState({ activity: next, passReady: { label: next.label ?? null } })
    return
  }
  const passReady = next.state === 'idle' ? useAgentActivityStore.getState().passReady : null
  useAgentActivityStore.setState({ activity: next, passReady })
}

/** The banner's buttons: "Edit anyway" (release) and "Stop the agent" (cancel). */
export async function sendAgentActivityAction(
  projectId: string,
  action: 'release' | 'cancel',
): Promise<void> {
  const res = await fetch(`/__shreditor/agent-activity?project=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Agent activity ${action}: HTTP ${res.status}`)
  receiveAgentActivity(await res.json())
}
