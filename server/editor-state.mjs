// Editor state heartbeat: lets the agent see what an open editor has not saved
// yet, and ask it to save now (`shred sync`).
//
// Routes (mounted by workspace-bridge.mjs under /__shreditor/):
//   POST editor-state                      the editor reports {projectId, tabId, dirty, lastEditAt,
//                                          revision, status, saving?, closed?} about once a second;
//                                          the reply carries a pending save request, if any
//   GET  editor-state?project=<id>         live tabs for a project plus the revision on disk
//   POST editor-state/save?project=<id>    ask every open tab of that project to save now
//
// Both editor-state replies carry `agentActivity`, the project's agent-activity
// record (see agent-activity.mjs), so an open editor learns about a pass on its
// next heartbeat. A heartbeat that lists the open cut's siblings (`cuts`, ids)
// gets `cutPublish` back: the newest pass the agent published into one of
// them, which the editor switches to (docs/cuts.md).
//
// State is in memory only. A tab that has not reported for STALE_MS is gone.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { effectiveActivity, latestPublish, readActivity } from './agent-activity.mjs'

export const STALE_MS = 5000
const SAVE_REQUEST_TTL_MS = 60_000

export function createEditorStateStore({ now = Date.now } = {}) {
  /** projectId -> Map(tabId -> report & { seenAt }) */
  const tabs = new Map()
  /** projectId -> { id, at } */
  const saveRequests = new Map()

  const live = (projectId) => {
    const byTab = tabs.get(projectId)
    if (!byTab) return []
    for (const [tabId, tab] of byTab) if (now() - tab.seenAt > STALE_MS) byTab.delete(tabId)
    if (!byTab.size) tabs.delete(projectId)
    return [...byTab.values()]
  }

  const pendingSave = (projectId) => {
    const request = saveRequests.get(projectId)
    if (request && now() - request.at > SAVE_REQUEST_TTL_MS) saveRequests.delete(projectId)
    return saveRequests.get(projectId) ?? null
  }

  return {
    report(input) {
      const projectId = String(input.projectId ?? '')
      const tabId = String(input.tabId ?? '')
      if (!projectId || !tabId) throw Object.assign(new Error('projectId and tabId are required'), { status: 400, name: 'TypeError' })
      if (input.closed) {
        tabs.get(projectId)?.delete(tabId)
        return { saveRequest: null }
      }
      const byTab = tabs.get(projectId) ?? new Map()
      tabs.set(projectId, byTab)
      byTab.set(tabId, {
        tabId,
        dirty: Boolean(input.dirty),
        saving: Boolean(input.saving),
        lastEditAt: typeof input.lastEditAt === 'number' ? input.lastEditAt : null,
        revision: typeof input.revision === 'string' ? input.revision : null,
        status: typeof input.status === 'string' ? input.status : 'synced',
        seenAt: now(),
      })
      // Every live tab is clean and was seen after the request: it is done.
      const request = pendingSave(projectId)
      if (request && live(projectId).every((t) => !t.dirty && !t.saving && t.seenAt > request.at)) {
        saveRequests.delete(projectId)
      }
      return { saveRequest: pendingSave(projectId)?.id ?? null }
    },

    query(projectId) {
      const list = live(projectId)
      const dirty = list.filter((t) => t.dirty)
      return {
        projectId,
        editors: list,
        open: list.length > 0,
        dirty: dirty.length > 0,
        lastEditAt: dirty.reduce((max, t) => Math.max(max, t.lastEditAt ?? 0), 0) || null,
        conflict: list.some((t) => t.status === 'conflict'),
        saveRequest: pendingSave(projectId)?.id ?? null,
      }
    },

    requestSave(projectId) {
      const request = { id: crypto.randomUUID(), at: now() }
      saveRequests.set(projectId, request)
      return { saveRequest: request.id, editors: live(projectId).length }
    },
  }
}

/** sha256 of project.json's bytes, the same revision the editor and the service use. */
function diskRevision(root, resolveInside, projectId) {
  try {
    const bytes = fs.readFileSync(resolveInside(root, path.posix.join('projects', projectId, 'project.json')))
    return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`
  } catch {
    return null
  }
}

/** The project's agent-activity record as it reads now (idle when missing or unreadable). */
const activityOf = (root, projectId) => effectiveActivity(readActivity(root, projectId))

const MAX_CUTS = 50
/** The newest publish into the sibling cuts a heartbeat lists, or null. */
const cutPublishOf = (root, cuts) =>
  Array.isArray(cuts) ? latestPublish(root, cuts.slice(0, MAX_CUTS)) : null

export function createEditorStateRoutes({ resolveInside, sendJson, readBody }) {
  const store = createEditorStateStore()
  return async function editorStateRoutes(req, res, { route, root, url }) {
    if (!route.endsWith(' editor-state') && !route.endsWith(' editor-state/save')) return false
    const projectId = url.searchParams.get('project') ?? ''
    switch (route) {
      case 'POST editor-state': {
        const input = JSON.parse((await readBody(req)).toString() || '{}')
        sendJson(res, 200, {
          ...store.report(input),
          agentActivity: activityOf(root, input.projectId),
          cutPublish: cutPublishOf(root, input.cuts),
        })
        return true
      }
      case 'GET editor-state':
        if (!projectId) throw Object.assign(new Error('project is required'), { status: 400, name: 'TypeError' })
        sendJson(res, 200, {
          ...store.query(projectId),
          diskRevision: diskRevision(root, resolveInside, projectId),
          agentActivity: activityOf(root, projectId),
        })
        return true
      case 'POST editor-state/save':
        if (!projectId) throw Object.assign(new Error('project is required'), { status: 400, name: 'TypeError' })
        sendJson(res, 200, store.requestSave(projectId))
        return true
      default:
        return false
    }
  }
}
