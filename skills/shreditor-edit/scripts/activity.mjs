// The agent side of the editor's "agent is working" banner (see
// server/agent-activity.mjs for the record). `shred draft --label` starts a
// pass, every shred command on the draft or its project keeps it alive, and
// `shred publish` / `shred done` end it. The user can stop the pass or take
// over from the editor; shred tells the agent here.
//
// Writes go through the editor's bridge when it is up (so the editor's
// buttons and shred never race on the file), else straight to the file.
import fs from 'node:fs'
import path from 'node:path'
import {
  activityFile,
  applyActivity,
  effectiveActivity,
  readActivity,
} from '../../../server/agent-activity.mjs'

export const STOPPED_MESSAGE =
  'The user stopped this pass in the editor. Ask them what they want next.'
export const USER_EDITED_MESSAGE =
  'The user chose to edit the project themselves while you were working ("Edit anyway" in the editor), so publishing would overwrite their edits.\nRe-read it (shred project), take a new draft from their state, re-apply your ops on top, verify, then publish.'
const RELEASED_NOTE =
  'Note: the user chose to edit the project themselves ("Edit anyway" in the editor); shred publish will refuse this draft. Take a new draft from their state when you are ready.'

// Commands that manage the pass themselves, or never touch a project.
const SELF_MANAGED = new Set([
  'draft',
  'done',
  'publish',
  'status',
  'up',
  'start',
  'setup',
  'notes',
])

const ownsDraft = (record, draftId) => !draftId || !record.draftId || record.draftId === draftId
const ago = (iso, now) => `${Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))}m ago`

/**
 * @param {object} deps
 * @param {() => string} deps.workspace
 * @param {string} deps.editor              editor origin, e.g. http://localhost:5273
 * @param {() => Promise<boolean>} deps.editorUp
 * @param {() => object} deps.readDrafts    ~/.shreditor/drafts.json
 * @param {(drafts: object) => void} deps.writeDrafts
 * @param {(line: string) => void} deps.warn
 * @param {typeof fetch} [deps.fetchImpl]
 */
export function createActivity({
  workspace,
  editor,
  editorUp,
  readDrafts,
  writeDrafts,
  warn,
  fetchImpl = fetch,
}) {
  let viaBridge = null

  async function call(targetId, action, input = {}) {
    viaBridge ??= await editorUp()
    if (viaBridge) {
      const res = await fetchImpl(
        `${editor}/__shreditor/agent-activity?project=${encodeURIComponent(targetId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, ...input }),
        },
      )
      if (res.ok) return res.json()
      // An editor from before this route: write the file ourselves.
      if (res.status !== 404)
        throw new Error(`Agent activity ${action}: ${(await res.json()).message ?? res.status}`)
    }
    return applyActivity(workspace(), targetId, action, input)
  }

  /** The user pressed Stop: end the pass and remember the draft is dead. */
  async function stopped(targetId, record) {
    if (record.draftId) {
      const drafts = readDrafts()
      if (drafts[record.draftId]) {
        drafts[record.draftId] = {
          ...drafts[record.draftId],
          cancelledAt: new Date().toISOString(),
        }
        writeDrafts(drafts)
      }
    }
    await call(targetId, 'finish', { ended: 'cancelled', draftId: record.draftId ?? undefined })
    return new Error(STOPPED_MESSAGE)
  }

  /** Keep a working pass alive; fail when the user stopped it, note when they took over. */
  async function guard({ targetId, draftId }) {
    if (draftId && readDrafts()[draftId]?.cancelledAt) throw new Error(STOPPED_MESSAGE)
    const record = await call(targetId, 'heartbeat', draftId ? { draftId } : {})
    if (!ownsDraft(record, draftId)) return record
    if (record.state === 'cancelled') throw await stopped(targetId, record)
    if (record.state === 'released') warn(RELEASED_NOTE)
    return record
  }

  /** Project ids among a command's arguments: drafts (with their target) and targets with a record. */
  function passesOf(ids) {
    const drafts = readDrafts()
    const seen = new Map()
    for (const id of ids) {
      if (typeof id !== 'string' || !id) continue
      const pass = drafts[id]?.targetId
        ? { targetId: drafts[id].targetId, draftId: id }
        : hasRecord(id)
          ? { targetId: id, draftId: null }
          : null
      if (pass) seen.set(`${pass.targetId}/${pass.draftId}`, pass)
    }
    return [...seen.values()]
  }

  function hasRecord(id) {
    try {
      return fs.existsSync(activityFile(workspace(), id))
    } catch {
      return false // not a project id (a file path, a media id with odd characters...)
    }
  }

  return {
    /** Before any command: heartbeat (or stop) the passes its arguments touch. */
    async preflight(command, ids) {
      if (!command || SELF_MANAGED.has(command)) return
      for (const pass of passesOf(ids)) await guard(pass)
    },

    start: (targetId, draftId, label) => call(targetId, 'start', { draftId, label }),

    /** `shred done <id>`: id is a draft (ends its pass) or a project (ends whatever pass it has). */
    async done(id) {
      const draft = readDrafts()[id]
      const targetId = draft?.targetId ?? id
      const record = await call(targetId, 'finish', {
        ended: 'done',
        draftId: draft ? id : undefined,
      })
      return { targetId, record }
    },

    /**
     * Before publishing: refuse when the user stopped the pass, or chose to edit
     * and did (`userChanged()` resolves true: the project's revision moved or the
     * editor holds unsaved edits). "Edit anyway" with nothing changed publishes.
     */
    async beforePublish(draftId, targetId, userChanged = async () => true) {
      const record = await guard({ targetId, draftId })
      if (ownsDraft(record, draftId) && record.state === 'released' && (await userChanged())) {
        await call(targetId, 'finish', { ended: 'refused', draftId })
        throw new Error(USER_EDITED_MESSAGE)
      }
    },

    refused: (draftId, targetId) => call(targetId, 'finish', { ended: 'refused', draftId }),
    published: (draftId, targetId, label) =>
      call(targetId, 'finish', { ended: 'published', draftId, label }),

    /** Lines for `shred status`: every pass that is not idle (live ones get a heartbeat). */
    async statusLines(now = Date.now()) {
      const dir = path.join(workspace(), 'projects')
      const ids = fs.existsSync(dir) ? fs.readdirSync(dir) : []
      const lines = []
      for (const id of ids) {
        let record = effectiveActivity(readActivity(workspace(), id), now)
        if (record.state === 'idle') continue
        if (record.state === 'working') record = await call(id, 'heartbeat')
        const what = record.label ? ` "${record.label}"` : ''
        lines.push(
          `${id}  ${record.state}${what} (draft ${record.draftId}, started ${ago(record.startedAt, now)})`,
        )
      }
      return lines
    },
  }
}
