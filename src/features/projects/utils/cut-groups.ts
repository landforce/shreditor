import type { Project } from '@/types/project'
import { cutGroupOf, cutsInGroup } from '@/shared/projects/cuts.mjs'

/** One entry in the project list: a project, or a group of cuts shown as its Main. */
interface ProjectEntry {
  /** The card's project: the group's Main (its first cut while Main is in the Trash). */
  project: Project
  /** The group's cuts in cut order when it has more than one, else empty. */
  cuts: Project[]
}

/**
 * The project list's entries (docs/cuts.md): a group of cuts is one entry,
 * its cuts listed beneath it. `shown` is the searched, filtered and sorted
 * list: a group appears when any of its cuts is shown, where the first of
 * them is. `all` is every live project, so the list names every cut.
 */
export function groupProjectEntries(shown: readonly Project[], all: readonly Project[]) {
  const seen = new Set<string>()
  const entries: ProjectEntry[] = []
  for (const project of shown) {
    const group = cutGroupOf(project) ?? project.id
    if (seen.has(group)) continue
    seen.add(group)
    const cuts = cutsInGroup(all, group)
    entries.push({ project: cuts[0] ?? project, cuts: cuts.length > 1 ? cuts : [] })
  }
  return entries
}
