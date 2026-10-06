import { useMemo } from 'react'
import {
  projectFormat,
  projectFormatRecord,
  resolveFormat,
  type ProjectFormat,
  type ResolvedFormat,
} from '@formats/registry.mjs'
import type { TimelineTrack } from '@/types/timeline'
import { getProject } from '@/infrastructure/storage'
import { addMissingFormatTracks } from '@/shared/formats/format-tracks'
import type { FormatSelection } from '@/shared/formats/format-cards'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  useCompositionNavigationStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'

/** The open project's format record; null when it has none. */
export function useProjectFormatRecord(): ProjectFormat | null {
  return useProjectStore((s) => s.currentProject?.format ?? null)
}

/** The open project's format, resolved with its variant; null when it has none. */
export function useResolvedProjectFormat(): ResolvedFormat | null {
  const record = useProjectFormatRecord()
  return useMemo(() => {
    try {
      return projectFormat({ format: record ?? undefined })
    } catch {
      return null
    }
  }, [record])
}

/**
 * Re-read the project's format from project.json (after an agent pass or
 * `shred format set` reloaded the timeline).
 */
export async function refreshProjectFormatFromDisk(projectId: string): Promise<void> {
  const fresh = await getProject(projectId)
  const { currentProject } = useProjectStore.getState()
  if (!fresh || currentProject?.id !== projectId) return
  const { format: _previous, ...rest } = currentProject
  useProjectStore.setState({
    currentProject: fresh.format ? { ...rest, format: fresh.format } : rest,
  })
}

/** True when the timeline on show is Main (not a composition being edited). */
const isMainTimelineActive = () =>
  useCompositionNavigationStore.getState().activeCompositionId === null

/**
 * Set the project's format (written to project.json, where the agent's
 * `shred format` and `shred check` read it). With `addTracks`, the format's
 * missing layout tracks are added to Main (undoable); nothing is moved or deleted.
 */
export async function applyProjectFormat(
  projectId: string,
  selection: FormatSelection,
  { addTracks }: { addTracks: boolean },
): Promise<{ format: ProjectFormat; added: TimelineTrack[] }> {
  const format = projectFormatRecord(selection.id, selection.variant)
  await useProjectStore.getState().setProjectFormat(projectId, format)
  if (!addTracks || !isMainTimelineActive()) return { format, added: [] }
  const timeline = useTimelineStore.getState()
  const { tracks, added } = addMissingFormatTracks(
    timeline.tracks,
    resolveFormat(selection.id, selection.variant),
  )
  if (added.length > 0) timeline.setTracks(tracks)
  return { format, added }
}
