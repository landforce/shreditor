/**
 * Rename, reorder, make Main and remove cuts from the editor (the Manage cuts
 * dialog), the same writes `shred cut rename` / `main` / `remove` make. Only the cut's own
 * project.json changes (no timeline), so an open editor on it is not
 * reloaded; removal is the editor's Trash, never a media delete.
 */

import {
  parkCutMediaLinks,
  softDeleteProject,
  updateProject,
  type CutGroup,
  type CutSummary,
} from '@/infrastructure/storage'
import { cutProjectName, cutRecord, makeMainUpdates } from '@/shared/projects/cuts.mjs'

/** The cut's record with a new label or order; Main keeps its flag (docs/cuts.md). */
const recordOf = (group: CutGroup, cut: CutSummary, changes: { label?: string; order?: number }) =>
  cutRecord({
    id: cut.id,
    group: group.groupId,
    label: cut.label,
    order: cut.order,
    main: cut.main,
    ...changes,
  })

export async function renameCut(group: CutGroup, cutId: string, label: string): Promise<void> {
  const cut = group.cuts.find((c) => c.id === cutId)
  if (!cut) return
  const wanted = label.trim()
  await updateProject(cutId, {
    cut: recordOf(group, cut, { label: wanted }),
    ...(cut.main ? {} : { name: cutProjectName(group.groupName, wanted) }),
  })
}

/** Swap a cut with its neighbour (`delta` -1 up, +1 down); Main stays first. */
export async function moveCut(group: CutGroup, cutId: string, delta: -1 | 1): Promise<void> {
  const others = group.cuts.filter((c) => !c.main)
  const index = others.findIndex((c) => c.id === cutId)
  const neighbour = others[index + delta]
  const cut = others[index]
  if (!cut || !neighbour) return
  // Orders can tie (hand-made groups); give both a distinct slot.
  const [a, b] =
    cut.order === neighbour.order ? [index + 1 + delta, index + 1] : [neighbour.order, cut.order]
  await updateProject(cut.id, { cut: recordOf(group, cut, { order: a }) })
  await updateProject(neighbour.id, { cut: recordOf(group, neighbour, { order: b }) })
}

/**
 * Make a cut the group's Main: it and the old Main swap places and names; the
 * group id and every other cut stay as they are.
 */
export async function makeMainCut(group: CutGroup, cutId: string): Promise<void> {
  for (const write of makeMainUpdates(group.cuts, cutId, group.groupId, group.groupName))
    await updateProject(write.id, write.updates)
}

/** Move a cut to the Trash (restorable from the project list); its media stays. */
export async function removeCut(cutId: string): Promise<void> {
  await parkCutMediaLinks(cutId)
  await softDeleteProject(cutId)
}
