/**
 * Keeps the agent's view of an open project current while the user edits.
 *
 * - Autosave: about 1.5s after the last timeline edit settles, save through
 *   the editor's normal save path (revision-checked; a refused save raises the
 *   conflict banner). Never during a gesture, a load, or a conflict.
 * - Heartbeat: report `{projectId, dirty, lastEditAt, revision, status}` to the
 *   workspace bridge about once a second and on every change, so `shred
 *   changes` can warn about unsaved edits. The reply may carry a save request
 *   from `shred sync`, which is honoured at once.
 *
 * Only runs when the workspace is served by the bridge (agent-native mode).
 */

export const AUTOSAVE_DELAY_MS = 1500
const HEARTBEAT_MS = 1000
const BUSY_RETRY_MS = 300

export type AgentSyncStatus = 'synced' | 'reloading' | 'conflict'

export interface EditorStateReport {
  projectId: string
  tabId: string
  dirty: boolean
  saving: boolean
  lastEditAt: number | null
  revision: string | null
  status: AgentSyncStatus
  closed?: boolean
}

export interface AgentSyncDeps {
  projectId: string
  tabId: string
  /** The editor's save path. Resolves when done; may reject. */
  save: () => Promise<void>
  isDirty: () => boolean
  /** Re-flag unsaved edits that landed while a save was in flight. */
  markDirty: () => void
  /** A drag, trim or other gesture is in progress, or the timeline is (re)loading. */
  isBusy: () => boolean
  status: () => AgentSyncStatus
  revision: () => string | null
  send: (report: EditorStateReport) => Promise<{ saveRequest?: string | null } | null>
  /** False keeps the heartbeat but leaves saving to the user (and `shred sync`). */
  autosave?: boolean
  now?: () => number
}

export class AgentSyncController {
  private lastEditAt: number | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private saving = false
  private stopped = false
  private sending = false
  private resend = false
  private lastSent = ''
  private readonly handledRequests = new Set<string>()
  private readonly now: () => number

  constructor(private readonly deps: AgentSyncDeps) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    this.heartbeat = setInterval(() => void this.report(true), HEARTBEAT_MS)
    void this.report(true)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    void this.deps.send({ ...this.snapshot(), closed: true }).catch(() => {})
  }

  /** A timeline edit just happened. */
  noteEdit(): void {
    this.lastEditAt = this.now()
    if (this.deps.autosave !== false) this.schedule(AUTOSAVE_DELAY_MS)
    void this.report(false)
  }

  /** Dirty flag, revision or sync status may have changed; report if so. */
  noteStateChange(): void {
    void this.report(false)
  }

  private schedule(delay: number): void {
    if (this.stopped) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.autosave()
    }, delay)
  }

  private async autosave(): Promise<void> {
    if (!this.deps.isDirty() || this.deps.status() === 'conflict') return
    if (this.saving || this.deps.isBusy()) return this.schedule(BUSY_RETRY_MS)
    const quietFor = this.now() - (this.lastEditAt ?? 0)
    if (quietFor < AUTOSAVE_DELAY_MS) return this.schedule(AUTOSAVE_DELAY_MS - quietFor)
    await this.runSave()
  }

  private async runSave(): Promise<void> {
    this.saving = true
    const startedAt = this.now()
    let failed = false
    try {
      await this.deps.save()
    } catch {
      // The save path shows its own failure; the next edit tries again.
      failed = true
    } finally {
      this.saving = false
    }
    if (!failed && this.deps.status() !== 'conflict') {
      // An edit made while the save was writing is not in the file.
      const editedDuringSave = this.lastEditAt !== null && this.lastEditAt > startedAt
      if (editedDuringSave && !this.deps.isDirty()) this.deps.markDirty()
      // Still dirty: edited meanwhile, or another save (Ctrl+S) held the lock.
      if (this.deps.isDirty() && this.deps.autosave !== false) this.schedule(AUTOSAVE_DELAY_MS)
    }
    void this.report(true)
  }

  private snapshot(): EditorStateReport {
    return {
      projectId: this.deps.projectId,
      tabId: this.deps.tabId,
      dirty: this.deps.isDirty(),
      saving: this.saving,
      lastEditAt: this.lastEditAt,
      revision: this.deps.revision(),
      status: this.deps.status(),
    }
  }

  /** `force` sends even when nothing changed (the heartbeat itself). */
  private async report(force: boolean): Promise<void> {
    if (this.stopped) return
    const report = this.snapshot()
    const key = JSON.stringify(report)
    if (!force && key === this.lastSent) return
    if (this.sending) {
      this.resend = true
      return
    }
    this.sending = true
    this.lastSent = key
    try {
      const reply = await this.deps.send(report)
      this.onSaveRequest(reply?.saveRequest ?? null)
    } catch {
      // The bridge restarts with the dev server; the next beat retries.
    } finally {
      this.sending = false
    }
    if (this.resend) {
      this.resend = false
      void this.report(false)
    }
  }

  private onSaveRequest(id: string | null): void {
    if (!id || this.handledRequests.has(id) || this.stopped) return
    if (this.saving || this.deps.isBusy()) return // Retried on the next beat.
    this.handledRequests.add(id)
    if (this.deps.isDirty() && this.deps.status() !== 'conflict') void this.runSave()
    else void this.report(true)
  }
}
