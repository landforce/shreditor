/**
 * Editor actions that run the agent's own commands on the workspace bridge
 * (server/motion-bridge.mjs, server/kit-bridge.mjs): re-render a motion
 * graphic with new control values, read and set the project's Video Style
 * Kit. Each one edits project.json the way `shred` does, so the open editor
 * saves first ({@link saveOpenEditorNow}) and reloads from disk after.
 */

const BASE = '/__shreditor'

async function failure(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { message?: unknown }
    if (typeof body.message === 'string' && body.message) return new Error(body.message)
  } catch {
    // Not JSON: fall through.
  }
  return new Error(fallback)
}

async function postJson(path: string, body: unknown, fallback: string): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await failure(res, fallback)
  return res.json()
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Asks every open editor of the project to save now and waits until none has
 * unsaved edits (true), or gives up after `timeoutMs` (false).
 */
export async function saveOpenEditorNow(projectId: string, timeoutMs = 8000): Promise<boolean> {
  const query = `project=${encodeURIComponent(projectId)}`
  await fetch(`${BASE}/editor-state/save?${query}`, { method: 'POST' })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await wait(250)
    const res = await fetch(`${BASE}/editor-state?${query}`, { cache: 'no-store' })
    if (!res.ok) return false
    const state = (await res.json()) as {
      dirty?: boolean
      saveRequest?: string | null
      editors?: { saving?: boolean }[]
    }
    const saving = state.editors?.some((editor) => editor.saving) ?? false
    if (!state.dirty && !saving && !state.saveRequest) return true
  }
  return false
}

export interface MotionVariable {
  id: string
  type?: string
  label?: string
  default?: unknown
  min?: number
  max?: number
  step?: number
  options?: unknown[]
}

export interface MotionClipInfo {
  clipId: string
  folder: string
  source: string
  variables: MotionVariable[]
  values: Record<string, unknown>
}

/** A motion clip's controls and current values; null when it has none logged or no bridge. */
export async function readMotionClip(
  projectId: string,
  itemId: string,
): Promise<MotionClipInfo | null> {
  try {
    const query = new URLSearchParams({ project: projectId, item: itemId })
    const res = await fetch(`${BASE}/motion/clip?${query}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as MotionClipInfo
  } catch {
    return null
  }
}

/** Re-renders a motion clip with these values over its current ones; resolves the new clip's id. */
export async function rerenderMotionClip(
  projectId: string,
  itemId: string,
  variables: Record<string, unknown>,
): Promise<string> {
  const body = (await postJson(
    'motion/rerender',
    { project: projectId, item: itemId, variables },
    'The motion graphic could not be re-rendered',
  )) as { clipId: string }
  return body.clipId
}

export interface ProjectKitRecord {
  path: string
  creator?: string
  kitVersion: string
  hash: string
  appliedAt?: string
}

export interface ProjectKitInfo {
  record: ProjectKitRecord | null
  path?: string
  kit?: Record<string, unknown>
  /** The kit file changed since the project applied it. */
  drift?: boolean
  error?: string
}

/** The project's kit and its file now; null when there is no bridge. */
export async function readProjectKit(projectId: string): Promise<ProjectKitInfo | null> {
  try {
    const res = await fetch(`${BASE}/kit?project=${encodeURIComponent(projectId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as ProjectKitInfo
  } catch {
    return null
  }
}

/** Sets kit values by path (`titles.style.size` -> "104"), as `shred kit set` does. */
export async function setProjectKitValues(
  projectId: string,
  values: Record<string, string>,
): Promise<void> {
  await postJson('kit/set', { project: projectId, values }, 'The style kit could not be saved')
}
