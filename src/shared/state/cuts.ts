import { useEffect } from 'react'
import { create } from 'zustand'
import { listCutGroup, readCutPassCounts, type CutGroup } from '@/infrastructure/storage'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('Cuts')

/** How often the group's pass folders are checked for a pass the agent published. */
const POLL_MS = 10_000

interface CutsState {
  projectId: string | null
  group: CutGroup | null
  /** Each cut's pass count when this editor first saw it. */
  seenPasses: Record<string, number>
  /** Cuts (other than the open one) with a pass newer than this editor has seen. */
  fresh: string[]
  load: (projectId: string | null) => Promise<void>
  refresh: () => Promise<void>
  poll: () => Promise<void>
}

/** `seenPasses` plus each cut of the group not seen before, at its last pass. */
function withSeenPasses(
  seenPasses: Record<string, number>,
  group: CutGroup | null,
): Record<string, number> {
  const seen = { ...seenPasses }
  for (const cut of group?.cuts ?? []) seen[cut.id] ??= cut.lastPass?.n ?? 0
  return seen
}

/**
 * The open project's cut group (docs/cuts.md): its cuts in order with size
 * and last pass, re-read on focus, plus which sibling got a new pass since
 * the editor opened (the agent may publish to a cut the user isn't viewing).
 */
export const useCutsStore = create<CutsState>()((set, get) => ({
  projectId: null,
  group: null,
  seenPasses: {},
  fresh: [],

  load: async (projectId) => {
    set({ projectId, group: null, seenPasses: {}, fresh: [] })
    if (projectId) await get().refresh()
  },

  refresh: async () => {
    const projectId = get().projectId
    if (!projectId) return
    try {
      const group = await listCutGroup(projectId)
      if (get().projectId !== projectId) return
      set({ group, seenPasses: withSeenPasses(get().seenPasses, group) })
    } catch (error) {
      logger.warn('Reading the cut group failed', error)
    }
  },

  poll: async () => {
    const { projectId, group, seenPasses } = get()
    if (!projectId || !group || group.cuts.length < 2) return
    const others = group.cuts.map((cut) => cut.id).filter((id) => id !== projectId)
    const counts = await readCutPassCounts(others).catch(() => ({}) as Record<string, number>)
    const fresh = others.filter((id) => (counts[id] ?? 0) > (seenPasses[id] ?? 0))
    if (fresh.join() !== get().fresh.join()) {
      set({ fresh })
      await get().refresh()
    }
  },
}))

/** Load the open project's cuts; re-read them on focus and poll for new passes. */
export function useCutsSync(projectId: string): void {
  useEffect(() => {
    const store = useCutsStore.getState()
    void store.load(projectId)
    const onFocus = () => void useCutsStore.getState().refresh()
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void useCutsStore.getState().poll(), POLL_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [projectId])
}

/**
 * The name an export of the open project gets when it is one of several cuts:
 * "<project name> · <label>" (a cut's project name already ends with its
 * label). Null when the project has no sibling cuts.
 */
export function cutExportName(projectName: string): string | null {
  const { group, projectId } = useCutsStore.getState()
  const cut = group?.cuts.find((c) => c.id === projectId)
  if (!group || !cut || group.cuts.length < 2) return null
  return projectName.endsWith(` · ${cut.label}`) ? projectName : `${projectName} · ${cut.label}`
}
