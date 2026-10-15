/**
 * Cuts on disk (docs/cuts.md): a cut is its own project, linked to its
 * siblings by `project.cut`. This module lists a group with each cut's last
 * pass, writes a new cut's agent files, and parks a removed cut's bin list so
 * the Trash's purge never deletes media.
 */

import {
  cutGroupOf,
  cutLabelOf,
  cutsInGroup,
  isMainCut,
  projectAspect,
} from '@/shared/projects/cuts.mjs'
import { requireWorkspaceRoot } from './root'
import {
  listDirectory,
  readBlob,
  readJson,
  removeEntry,
  writeBlob,
  writeJsonAtomic,
} from './fs-primitives'
import { projectDir, projectMediaLinksPath } from './paths'
import { getAllProjects } from './projects'

export interface CutScoreSummary {
  pass: number
  warn: number
  fail: number
}

export interface CutLastPass {
  n: number
  label: string
  createdAt: string | null
  summary: CutScoreSummary | null
}

export interface CutSummary {
  id: string
  name: string
  label: string
  main: boolean
  /** Switcher order (Main is 0). */
  order: number
  width: number
  height: number
  aspect: string
  lastPass: CutLastPass | null
}

export interface CutGroup {
  groupId: string
  /** The group's name: its main cut's project name. */
  groupName: string
  cuts: CutSummary[]
}

const PASS_FILE = /^\d+\.json$/
const agentDir = (id: string) => [...projectDir(id), 'agent']
const passesDir = (id: string) => [...agentDir(id), 'passes']

async function passFiles(id: string): Promise<string[]> {
  try {
    return (await listDirectory(requireWorkspaceRoot(), passesDir(id)))
      .filter((entry) => entry.kind === 'file' && PASS_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

interface PassRecordHead {
  id?: unknown
  label?: unknown
  createdAt?: unknown
  scorecard?: { summary?: Partial<CutScoreSummary> }
}

const isSummary = (s: Partial<CutScoreSummary> | undefined): s is CutScoreSummary =>
  Boolean(s) &&
  typeof s?.pass === 'number' &&
  typeof s.warn === 'number' &&
  typeof s.fail === 'number'

/** A cut's newest pass record (label and scorecard summary), or null. */
async function readLastPass(id: string): Promise<CutLastPass | null> {
  const latest = (await passFiles(id)).at(-1)
  if (!latest) return null
  try {
    const record = await readJson<PassRecordHead>(requireWorkspaceRoot(), [
      ...passesDir(id),
      latest,
    ])
    if (!record) return null
    const summary = record.scorecard?.summary
    return {
      n: Number(latest.slice(0, -5)),
      label: typeof record.label === 'string' ? record.label : '',
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
      summary: isSummary(summary) ? summary : null,
    }
  } catch {
    return null
  }
}

/** How many passes each cut has: a cheap poll for new passes. */
export async function readCutPassCounts(ids: readonly string[]): Promise<Record<string, number>> {
  const counts = await Promise.all(ids.map(async (id) => [id, (await passFiles(id)).length]))
  return Object.fromEntries(counts)
}

/** The group a project is in, in cut order (trashed cuts are left out). */
export async function listCutGroup(projectId: string): Promise<CutGroup | null> {
  const projects = await getAllProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return null
  const groupId = cutGroupOf(project)!
  const members = cutsInGroup(projects, groupId)
  const main = members.find((member) => isMainCut(member))
  const cuts = await Promise.all(
    members.map(
      async (member): Promise<CutSummary> => ({
        id: member.id,
        name: member.name,
        label: cutLabelOf(member),
        main: isMainCut(member),
        order: isMainCut(member) ? 0 : (member.cut?.order ?? 0),
        width: member.metadata.width,
        height: member.metadata.height,
        aspect: projectAspect(member),
        lastPass: await readLastPass(member.id),
      }),
    ),
  )
  return { groupId, groupName: main?.name ?? project.name, cuts }
}

/**
 * Copy the brief and plan from one cut to a new one (the plan's validation
 * record points at the copy) and write the new cut's first pass record.
 */
export async function writeNewCutAgentFiles(
  fromId: string,
  toId: string,
  firstPass: Record<string, unknown>,
): Promise<void> {
  const root = requireWorkspaceRoot()
  for (const name of ['brief.yaml', 'plan.json']) {
    const blob = await readBlob(root, [...agentDir(fromId), name])
    if (blob) await writeBlob(root, [...agentDir(toId), name], await blob.text())
  }
  const state = await readJson<{ file?: string }>(root, [...agentDir(fromId), 'plan.state.json'])
  if (state) {
    const from = `/projects/${fromId}/agent/plan.json`
    const file =
      typeof state.file === 'string' && state.file.endsWith(from)
        ? `${state.file.slice(0, -from.length)}/projects/${toId}/agent/plan.json`
        : state.file
    await writeJsonAtomic(root, [...agentDir(toId), 'plan.state.json'], { ...state, file })
  }
  await writeJsonAtomic(root, [...passesDir(toId), '001.json'], firstPass)
}

/**
 * Before a cut goes to the Trash: park its bin list (media-links.json →
 * media-links.cut-removed.json) so the Trash's purge can't delete media only
 * it used. A restored cut re-links its timeline's media when it is opened.
 */
export async function parkCutMediaLinks(id: string): Promise<void> {
  const root = requireWorkspaceRoot()
  const links = await readJson<unknown>(root, projectMediaLinksPath(id))
  if (!links) return
  await writeJsonAtomic(root, [...projectDir(id), 'media-links.cut-removed.json'], links)
  await removeEntry(root, projectMediaLinksPath(id))
}
