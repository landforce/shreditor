// Is it safe to restart the editor and the agent service? Not while an open
// project has unsaved changes or a conflict (the editor's heartbeat, see
// server/editor-state.mjs), nor while the service is in the middle of a request.
import fs from 'node:fs'
import path from 'node:path'
import { editorInfo, getJson, serviceHealth, waitFor } from './processes.mjs'

/** Project ids in a workspace (folders under projects/ with a project.json). */
export function projectIds(root) {
  try {
    return fs
      .readdirSync(path.join(root, 'projects'), { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() && fs.existsSync(path.join(root, 'projects', d.name, 'project.json')),
      )
      .map((d) => d.name)
  } catch {
    return []
  }
}

/**
 * What the editor at `editorUrl` has open and not saved:
 * { running, root, unsaved: [{ projectId, dirty, conflict, lastEditAt }], unknown }.
 * unknown: the editor answers but can't say (it predates the heartbeat).
 */
export async function editorUnsaved(editorUrl, { fetchImpl } = {}) {
  const info = await editorInfo(editorUrl, { fetchImpl })
  if (!info) return { running: false, root: null, unsaved: [], unknown: false }
  const states = await Promise.all(
    projectIds(info.root).map(async (projectId) => ({
      projectId,
      state: await getJson(
        `${editorUrl}/__shreditor/editor-state?project=${encodeURIComponent(projectId)}`,
        { fetchImpl },
      ),
    })),
  )
  return {
    running: true,
    root: info.root,
    unknown: states.some((s) => s.state === null),
    unsaved: states
      .filter((s) => s.state?.dirty || s.state?.conflict)
      .map((s) => ({
        projectId: s.projectId,
        dirty: Boolean(s.state.dirty),
        conflict: Boolean(s.state.conflict),
        lastEditAt: s.state.lastEditAt ?? null,
      })),
  }
}

/**
 * Wait up to `timeoutMs` for the service to finish what it is doing. Returns
 * { running, busy }: busy is the count of requests still open (0 when idle,
 * null when the service doesn't report it).
 */
export async function serviceIdle(
  serviceUrl,
  { timeoutMs = 60_000, intervalMs = 1000, fetchImpl, say = () => {} } = {},
) {
  let last = await serviceHealth(serviceUrl, { fetchImpl })
  if (!last) return { running: false, busy: 0 }
  if (typeof last.inFlight !== 'number') return { running: true, busy: null }
  if (last.inFlight === 0) return { running: true, busy: 0 }
  say(
    `The agent service is busy (${last.inFlight} request(s)); waiting up to ${Math.round(timeoutMs / 1000)}s…`,
  )
  const idle = await waitFor(
    async () => {
      last = await serviceHealth(serviceUrl, { fetchImpl })
      return !last || last.inFlight === 0
    },
    { timeoutMs, intervalMs },
  )
  return { running: Boolean(last), busy: idle ? 0 : last.inFlight }
}

/** Why a restart would lose or interrupt work; empty when it is safe (or forced). */
export function restartBlockers({ editor, service, force = false }) {
  if (force) return []
  const reasons = []
  for (const p of editor?.unsaved ?? []) {
    reasons.push(
      p.conflict
        ? `Project ${p.projectId} shows a conflict in the editor: pick a version there first.`
        : `Project ${p.projectId} has unsaved changes in the editor: save it (Cmd+S) first.`,
    )
  }
  if (editor?.unknown)
    reasons.push(
      `The editor at ${editor.url ?? 'its port'} can't report unsaved changes (an older build): save your work, then use --force.`,
    )
  if (service?.busy > 0)
    reasons.push(
      `The agent service is still working on ${service.busy} request${service.busy === 1 ? '' : 's'} (an edit or a render).`,
    )
  return reasons
}

/** Check both, then the blockers (`urls`: { editor, service }). */
export async function checkRestartSafe(
  urls,
  { force = false, fetchImpl, say, idleTimeoutMs } = {},
) {
  const editor = urls.editor
    ? { url: urls.editor, ...(await editorUnsaved(urls.editor, { fetchImpl })) }
    : null
  const service =
    urls.service && !force
      ? await serviceIdle(urls.service, { fetchImpl, say, timeoutMs: idleTimeoutMs })
      : null
  return { editor, service, blockers: restartBlockers({ editor, service, force }) }
}

/**
 * What `shreditor update` does after pulling: npm ci when package-lock.json
 * changed or node_modules doesn't match it (never through a linked node_modules),
 * then a build and a restart when anything moved or the build is stale.
 */
export function updateSteps({
  from,
  to,
  changed = [],
  depsMismatch = null,
  linkedDeps = null,
  stale = null,
}) {
  const moved = from !== to
  const depsNeeded = changed.includes('package-lock.json') || Boolean(depsMismatch)
  const npmCi = depsNeeded && !linkedDeps
  const build = moved || npmCi || Boolean(stale)
  return {
    moved,
    npmCi,
    depsLinkedWarning: depsNeeded && Boolean(linkedDeps),
    build,
    restart: build,
  }
}
