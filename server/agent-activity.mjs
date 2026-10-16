// Agent activity: whether an agent is mid-pass on a project, so the open
// editor can show it and hold the user's edits until the pass lands.
//
// One record per target project at projects/<id>/agent/activity.json:
//   { state, draftId, label, startedAt, heartbeatAt, by: 'agent', ... }
// state:
//   working    the agent is building a pass on a draft of this project
//   cancelled  the user pressed "Stop the agent"; the agent's next shred command fails and clears it
//   released   the user pressed "Edit anyway"; the agent's publish is refused
//   idle       nothing going on; `ended` says how the last pass ended
//              (published, done, refused, cancelled)
//
// A working record whose heartbeat is older than STALE_AFTER_MS (or a stop
// request older than that) reads as idle everywhere, so a crashed agent never
// locks the user out.
//
// Routes (mounted by workspace-bridge.mjs under /__shreditor/):
//   GET  agent-activity?project=<id>    the record as it reads now
//   POST agent-activity?project=<id>    {action, draftId?, label?, ended?}: apply one transition
//                                       (shred uses it while the editor is up; the editor's buttons too)
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const STALE_AFTER_MS = 10 * 60_000
const ENDINGS = new Set(['published', 'done', 'refused', 'cancelled'])
const IDLE = Object.freeze({ state: 'idle' })

function httpError(status, message) {
  return Object.assign(new Error(message), { status, name: 'TypeError' })
}

/** projects/<id>/agent/activity.json, for a plain project id only. */
export function activityFile(root, projectId) {
  const id = String(projectId ?? '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || id.includes('..')) {
    throw httpError(400, `Invalid project id: ${id}`)
  }
  return path.join(root, 'projects', id, 'agent', 'activity.json')
}

export function readActivity(root, projectId) {
  try {
    const record = JSON.parse(fs.readFileSync(activityFile(root, projectId), 'utf8'))
    return record && typeof record.state === 'string' ? record : null
  } catch {
    return null
  }
}

/** Temp file beside the target, then rename: readers never see half a record. */
export function writeActivity(root, projectId, record) {
  const file = activityFile(root, projectId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.activity.json.${crypto.randomUUID()}.tmp`)
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`)
    fs.renameSync(tmp, file)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

// A stop request counts from when the user pressed Stop, work from the last heartbeat.
const lastSign = (record) =>
  record.state === 'cancelled' ? record.cancelledAt : (record.heartbeatAt ?? record.startedAt)
const isLive = (record, now) => now - Date.parse(lastSign(record) ?? '') <= STALE_AFTER_MS

/** The record as everyone should read it: a stale working/cancelled record is idle. */
export function effectiveActivity(record, now = Date.now()) {
  if (!record) return IDLE
  if (record.state === 'working' || record.state === 'cancelled') {
    return isLive(record, now) ? record : { ...record, state: 'idle', ended: 'stale' }
  }
  return record
}

const stamp = (now) => new Date(now).toISOString()
const ownsDraft = (record, draftId) => !draftId || !record.draftId || record.draftId === draftId

/**
 * The next record for one action (pure). Actions:
 *   start {draftId, label?}   agent: a pass begins (any earlier record is replaced)
 *   heartbeat {draftId?}      agent: still working (only a live working record of that draft moves)
 *   release                   editor: "Edit anyway"
 *   cancel                    editor: "Stop the agent"
 *   finish {ended, label?, draftId?}   agent: the pass is over (idle); with draftId, only that draft's
 * Returns the stored record unchanged when the action does not apply.
 */
export function transition(record, action, input = {}, now = Date.now()) {
  const current = effectiveActivity(record, now)
  switch (action) {
    case 'start':
      if (!input.draftId) throw httpError(400, 'draftId is required')
      return {
        state: 'working',
        draftId: String(input.draftId),
        label: input.label ? String(input.label).slice(0, 200) : null,
        startedAt: stamp(now),
        heartbeatAt: stamp(now),
        by: 'agent',
      }
    case 'heartbeat':
      if (current.state !== 'working' || !ownsDraft(current, input.draftId)) return record
      return { ...current, heartbeatAt: stamp(now) }
    case 'release':
      if (current.state !== 'working') return record
      return { ...current, state: 'released', releasedAt: stamp(now), releasedBy: 'user' }
    case 'cancel':
      if (current.state !== 'working') return record
      return { ...current, state: 'cancelled', cancelledAt: stamp(now), cancelledBy: 'user' }
    case 'finish': {
      // Ending an older draft's pass leaves a newer pass alone.
      if (input.draftId && record?.draftId && record.draftId !== input.draftId) return record
      const ended = ENDINGS.has(input.ended) ? input.ended : 'done'
      const label = input.label ?? record?.label ?? null
      return {
        state: 'idle',
        draftId: record?.draftId ?? null,
        label,
        ended,
        endedAt: stamp(now),
        by: 'agent',
      }
    }
    default:
      throw httpError(400, `Unknown action: ${action}`)
  }
}

const publishOf = (root, projectId) => {
  const record = readActivity(root, projectId)
  return record?.ended === 'published' && record.endedAt
    ? { projectId, label: record.label ?? null, endedAt: record.endedAt }
    : null
}

/**
 * The newest pass published into any of `projectIds` (the sibling cuts of
 * the project an editor has open), as {projectId, label, endedAt}, or null.
 * The editor follows the agent to that cut (docs/cuts.md, Seeing cuts).
 */
export function latestPublish(root, projectIds) {
  const publishes = projectIds.map((id) => publishOf(root, String(id))).filter(Boolean)
  return publishes.sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0] ?? null
}

/** Read, apply one action, write if it changed; returns the effective record. */
export function applyActivity(root, projectId, action, input = {}, now = Date.now()) {
  const record = readActivity(root, projectId)
  const next = transition(record, action, input, now)
  if (next !== record) writeActivity(root, projectId, next)
  return effectiveActivity(next, now)
}

export function createAgentActivityRoutes({ sendJson, readBody }) {
  return async function agentActivityRoutes(req, res, { route, root, url }) {
    if (!route.endsWith(' agent-activity')) return false
    const projectId = url.searchParams.get('project') ?? ''
    if (route === 'GET agent-activity') {
      activityFile(root, projectId)
      sendJson(res, 200, effectiveActivity(readActivity(root, projectId)))
      return true
    }
    if (route === 'POST agent-activity') {
      const { action, ...input } = JSON.parse((await readBody(req)).toString() || '{}')
      sendJson(res, 200, applyActivity(root, projectId, action, input))
      return true
    }
    return false
  }
}
