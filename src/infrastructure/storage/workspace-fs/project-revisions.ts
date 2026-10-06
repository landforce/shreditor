/**
 * Content revisions for `project.json`, shared with the headless service.
 *
 * A revision is `sha256:<hex>` of the file's exact bytes (the same formula as
 * `headless/lib/lifecycle-store.mjs#revisionOf`). The editor records the
 * revision it loaded; a timeline save is refused if the file on disk has moved
 * on since, so an agent's edit is never silently overwritten.
 */

import { requireWorkspaceRoot } from './root'
import { projectJsonPath } from './paths'

export class ProjectRevisionConflictError extends Error {
  constructor(
    readonly projectId: string,
    readonly expectedRevision: string,
    readonly actualRevision: string | null,
  ) {
    super(`project.json for ${projectId} changed on disk since it was loaded`)
    this.name = 'ProjectRevisionConflictError'
  }
}

export async function revisionOfText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

export interface ProjectFileStamp {
  revision: string
  lastModified: number
  size: number
}

async function projectFile(id: string): Promise<File | null> {
  const root = requireWorkspaceRoot()
  const segments = projectJsonPath(id)
  try {
    let dir = root
    for (const segment of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(segment)
    const handle = await dir.getFileHandle(segments[segments.length - 1]!)
    return await handle.getFile()
  } catch (error) {
    if ((error as DOMException)?.name === 'NotFoundError') return null
    throw error
  }
}

/** Cheap check first (mtime + size); hashes only when those changed. */
export async function readProjectStamp(
  id: string,
  previous?: ProjectFileStamp | null,
): Promise<ProjectFileStamp | null> {
  const file = await projectFile(id)
  if (!file) return null
  if (previous && previous.lastModified === file.lastModified && previous.size === file.size) {
    return previous
  }
  return {
    revision: await revisionOfText(await file.text()),
    lastModified: file.lastModified,
    size: file.size,
  }
}

// Revision each open editor last loaded or wrote, keyed by project id. Only
// projects open in an editor are tracked; other writes are not guarded.
const tracked = new Map<string, string>()
const listeners = new Set<(projectId: string, revision: string | null) => void>()

export function getTrackedRevision(id: string): string | null {
  return tracked.get(id) ?? null
}

export function setTrackedRevision(id: string, revision: string | null): void {
  if (revision) tracked.set(id, revision)
  else tracked.delete(id)
  for (const listener of listeners) listener(id, revision)
}

export function onTrackedRevisionChange(
  listener: (projectId: string, revision: string | null) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
