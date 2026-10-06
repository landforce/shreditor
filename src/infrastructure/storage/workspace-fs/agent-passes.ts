/**
 * Reads the agent's pass records (`projects/{id}/agent/passes/NNN.json`, written
 * by `shred publish`) so the editor can name the undo step a pass becomes.
 *
 * `shred publish` writes `agent/publishing.json` ({ label, baseRevision })
 * before it replaces project.json, and the numbered record right after, so the
 * label is known whichever lands first when the editor reloads.
 */

import { requireWorkspaceRoot } from './root'
import { listDirectory, readJson } from './fs-primitives'
import { projectDir } from './paths'

interface PassLabelRecord {
  label?: unknown
  baseRevision?: unknown
  resultRevision?: unknown
}

const PASS_FILE = /^\d+\.json$/

const agentDir = (projectId: string) => [...projectDir(projectId), 'agent']

const labelOf = (record: PassLabelRecord | null): string | null =>
  typeof record?.label === 'string' && record.label.trim() ? record.label.trim() : null

/**
 * The label of the pass that turned `previousRevision` into `revision`, or
 * null when the change on disk was not a published pass (or can't be read).
 */
export async function readAgentPassLabel(
  projectId: string,
  revision: string | null,
  previousRevision: string | null,
): Promise<string | null> {
  try {
    const root = requireWorkspaceRoot()
    const passes = (await listDirectory(root, [...agentDir(projectId), 'passes']))
      .filter((entry) => entry.kind === 'file' && PASS_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    const latest = passes.at(-1)
    if (latest && revision) {
      const record = await readJson<PassLabelRecord>(root, [
        ...agentDir(projectId),
        'passes',
        latest,
      ])
      if (record?.resultRevision === revision) return labelOf(record)
    }
    if (!previousRevision) return null
    const publishing = await readJson<PassLabelRecord>(root, [
      ...agentDir(projectId),
      'publishing.json',
    ])
    return publishing?.baseRevision === previousRevision ? labelOf(publishing) : null
  } catch {
    return null
  }
}
