import { create } from 'zustand'

/**
 * Whether the open timeline matches project.json on disk.
 *
 * `conflict` means the file changed on disk (usually an agent pass) while the
 * editor held unsaved edits, or a save was refused for the same reason. The
 * user picks a side; nothing is merged automatically.
 */
type ProjectSyncStatus = 'synced' | 'reloading' | 'conflict'

interface ProjectSyncState {
  status: ProjectSyncStatus
  /** True while this tab is writing project.json, so the watcher ignores it. */
  writing: boolean
  lastExternalLoadAt: number | null
  setStatus: (status: ProjectSyncStatus) => void
  setWriting: (writing: boolean) => void
  markExternalLoad: () => void
}

export const useProjectSyncStore = create<ProjectSyncState>()((set) => ({
  status: 'synced',
  writing: false,
  lastExternalLoadAt: null,
  setStatus: (status) => set({ status }),
  setWriting: (writing) => set({ writing }),
  markExternalLoad: () => set({ status: 'synced', lastExternalLoadAt: Date.now() }),
}))
