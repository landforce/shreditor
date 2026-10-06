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
  captureSnapshot,
  useCompositionNavigationStore,
  useItemsStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
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
 * Re-read the project's settings outside the timeline from project.json: the
 * format, the style kit and the canvas (after an agent pass, `shred format set`
 * or `shred kit apply` reloaded the timeline).
 */
export async function refreshProjectSettingsFromDisk(projectId: string): Promise<void> {
  const fresh = await getProject(projectId)
  const { currentProject } = useProjectStore.getState()
  if (!fresh || currentProject?.id !== projectId) return
  const { format: _format, kit: _kit, ...rest } = currentProject
  useProjectStore.setState({
    currentProject: {
      ...rest,
      metadata: { ...rest.metadata, ...fresh.metadata },
      ...(fresh.format ? { format: fresh.format } : {}),
      ...(fresh.kit ? { kit: fresh.kit } : {}),
    },
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
  // The format and the tracks it adds are one undo step.
  const before = captureSnapshot()
  await useProjectStore.getState().setProjectFormat(projectId, format)
  let added: TimelineTrack[] = []
  if (addTracks && isMainTimelineActive()) {
    const timeline = useTimelineStore.getState()
    const result = addMissingFormatTracks(
      timeline.tracks,
      resolveFormat(selection.id, selection.variant),
    )
    added = result.added
    if (added.length > 0) useItemsStore.getState().setTracks(result.tracks)
  }
  useTimelineSettingsStore.getState().markDirty()
  useTimelineCommandStore.getState().addUndoEntry({ type: 'SET_FORMAT' }, before)
  return { format, added }
}
