import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import type { TextItem } from '@/types/timeline'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useProjectStore } from '@/features/timeline/deps/projects'
import { useProjectTextStylesStore } from '@/shared/state/text-styles'
import { useItemsStore } from './items-store'
import { useKeyframesStore } from './keyframes-store'
import { useMarkersStore } from './markers-store'
import { useTimelineSettingsStore } from './timeline-settings-store'
import { useTimelineCommandStore } from './timeline-command-store'
import { captureSnapshot, restoreSnapshot, timelineContentEqual } from './commands/snapshot'
import { formatTimelineCommandLabel } from './commands/labels'
import { hydrateTimelineStoresFromProject } from './timeline-persistence'
import { useEditorStore } from '@/shared/state/editor'

// Existing suites assume a non-concise workspace (the default is concise).
useEditorStore.setState({ workspace: 'edit' })

const track = makeTimelineTrack({ id: 'track-v1', name: 'Speaker', kind: 'video', order: 0 })
const titleTrack = makeTimelineTrack({ id: 'track-t1', name: 'Title', kind: 'video', order: 1 })

function title(id: string, text: string): TextItem {
  return {
    id,
    type: 'text',
    trackId: titleTrack.id,
    from: 0,
    durationInFrames: 45,
    label: text,
    text,
    color: '#ffffff',
  }
}

function project(timeline: ProjectTimeline, metadata = { width: 1080, height: 1920, fps: 30 }) {
  return {
    id: 'project-1',
    name: 'Project',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 10,
    metadata,
    timeline,
  } satisfies Project
}

// The agent's pass: trims the user's clip, adds a title with a keyframe,
// a marker, a text style and a second track.
const passTimeline: ProjectTimeline = {
  tracks: [track, titleTrack],
  items: [
    makeTimelineVideoItem({ id: 'clip', trackId: track.id, durationInFrames: 40, sourceEnd: 40 }),
    title('pass-title', 'Hook'),
  ],
  keyframes: [
    {
      itemId: 'pass-title',
      properties: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'kf-1', frame: 0, value: 0, easing: 'linear' },
            { id: 'kf-2', frame: 10, value: 1, easing: 'linear' },
          ],
        },
      ],
    },
  ],
  markers: [{ id: 'm-agent', frame: 20, label: 'look here', color: '#ff0000' }],
  textStyles: [
    {
      id: 'style-hook',
      name: 'Hook',
      fontFamily: 'Inter',
      fontSize: 80,
      color: '#ffffff',
    } as never,
  ],
}

/** What the editor does when the file changed on disk: reload as one step. */
async function reloadAsAgentPass(next: Project, label?: string) {
  const before = captureSnapshot()
  await hydrateTimelineStoresFromProject(next, { keepHistory: true })
  return useTimelineCommandStore
    .getState()
    .recordExternalChange({ type: 'EXTERNAL_CHANGE', payload: label ? { label } : {} }, before)
}

const undoLabel = () => {
  const stack = useTimelineCommandStore.getState().undoStack
  const entry = stack[stack.length - 1]
  return entry ? formatTimelineCommandLabel(entry.command) : null
}

describe('an agent pass reloaded from disk is one undo step', () => {
  beforeEach(async () => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null, projects: [] })
    // Open the project: the first load clears history as before.
    await hydrateTimelineStoresFromProject(
      project({
        tracks: [track],
        items: [makeTimelineVideoItem({ id: 'clip', trackId: track.id })],
      }),
    )
    // The user's own edit, saved by autosave.
    useTimelineCommandStore.getState().execute({ type: 'ADD_MARKER' }, () => {
      useMarkersStore.getState().setMarkers([{ id: 'm-user', frame: 5, color: '#00ff00' }])
    })
    useTimelineSettingsStore.getState().markClean()
  })

  afterEach(() => resetTimelineCompositionTestState())

  it('undo restores the previous timeline exactly, redo re-applies the pass', async () => {
    const before = captureSnapshot()
    expect(await reloadAsAgentPass(project(passTimeline), 'Pass 2: hook title')).toBe(true)
    const after = captureSnapshot()

    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(2)
    expect(undoLabel()).toBe('Pass 2: hook title')
    expect(useTimelineSettingsStore.getState().isDirty).toBe(false)

    useTimelineCommandStore.getState().undo()
    expect(timelineContentEqual(captureSnapshot(), before)).toBe(true)
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['clip'])
    expect(useItemsStore.getState().items[0]?.durationInFrames).toBe(60)
    expect(useItemsStore.getState().tracks.map((t) => t.id)).toEqual(['track-v1'])
    expect(useKeyframesStore.getState().keyframes).toEqual([])
    expect(useProjectTextStylesStore.getState().styles).toEqual([])
    expect(useMarkersStore.getState().markers.map((m) => m.id)).toEqual(['m-user'])
    // The undone timeline needs saving, so the agent sees it.
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)

    useTimelineSettingsStore.getState().markClean()
    useTimelineCommandStore.getState().redo()
    expect(timelineContentEqual(captureSnapshot(), after)).toBe(true)
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['clip', 'pass-title'])
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
  })

  it('keeps the user history below the pass', async () => {
    await reloadAsAgentPass(project(passTimeline))
    expect(undoLabel()).toBe('Changes from the agent')

    useTimelineCommandStore.getState().undo() // the pass
    useTimelineCommandStore.getState().undo() // the user's marker
    expect(useMarkersStore.getState().markers).toEqual([])
    expect(useTimelineCommandStore.getState().canUndo).toBe(false)
    expect(useTimelineCommandStore.getState().redoStack).toHaveLength(2)
  })

  it('a reload that changes nothing adds no step', async () => {
    const { items, tracks, markers } = captureSnapshot()
    const timeline = { tracks, items, markers } as ProjectTimeline
    expect(await reloadAsAgentPass(project(timeline))).toBe(false)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('keeps project settings the reload brought (canvas) when the pass is undone', async () => {
    useProjectStore.setState({
      currentProject: project({ tracks: [track], items: [] }),
    })
    const before = captureSnapshot()
    await hydrateTimelineStoresFromProject(
      project(passTimeline, { width: 1920, height: 1080, fps: 25 }),
      {
        keepHistory: true,
      },
    )
    // The editor refreshes the canvas from disk before recording the step.
    useProjectStore.setState((state) => ({
      currentProject: state.currentProject && {
        ...state.currentProject,
        metadata: { width: 1920, height: 1080, fps: 25 },
      },
    }))
    useTimelineCommandStore.getState().recordExternalChange({ type: 'EXTERNAL_CHANGE' }, before)

    useTimelineCommandStore.getState().undo()
    expect(useProjectStore.getState().currentProject?.metadata).toEqual({
      width: 1920,
      height: 1080,
      fps: 25,
    })
    expect(useTimelineSettingsStore.getState().fps).toBe(25)
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['clip'])
  })

  it('drops parked composition histories that predate the reload', async () => {
    const cmd = useTimelineCommandStore.getState()
    cmd.setActiveContext('comp-a')
    cmd.execute({ type: 'TEST' }, () => useMarkersStore.getState().setMarkers([]))
    useTimelineCommandStore.getState().setActiveContext(null)
    expect(Object.keys(useTimelineCommandStore.getState().stacksByContext)).toEqual(['comp-a'])

    await reloadAsAgentPass(project(passTimeline))
    expect(useTimelineCommandStore.getState().stacksByContext).toEqual({})
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(2)
  })

  it('opening a project still starts with no history', async () => {
    await reloadAsAgentPass(project(passTimeline))
    await hydrateTimelineStoresFromProject(project(passTimeline))
    expect(useTimelineCommandStore.getState().undoStack).toEqual([])
    expect(useTimelineCommandStore.getState().canUndo).toBe(false)
  })

  it('history limits still apply', async () => {
    const { useSettingsStore } = await import('@/features/timeline/deps/settings')
    const previous = useSettingsStore.getState().maxUndoHistory
    useSettingsStore.setState({ maxUndoHistory: 2 })
    try {
      useTimelineCommandStore.getState().execute({ type: 'ADD_MARKER' }, () => {
        useMarkersStore.getState().setMarkers([{ id: 'm-2', frame: 9, color: '#00ff00' }])
      })
      await reloadAsAgentPass(project(passTimeline), 'Pass')
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(2)
      expect(undoLabel()).toBe('Pass')
    } finally {
      useSettingsStore.setState({ maxUndoHistory: previous })
    }
  })

  it('a format change undoes with the timeline; a reload keeps the format it brought', async () => {
    const setProjectFormat = vi.fn(async () => {})
    const vlog = { id: 'vlog', variant: 'fast' } as never
    useProjectStore.setState({
      currentProject: { ...project({ tracks: [track], items: [] }), format: vlog },
      setProjectFormat,
    } as never)
    const before = captureSnapshot()
    useProjectStore.setState((state) => ({
      currentProject: state.currentProject && { ...state.currentProject, format: undefined },
    }))
    restoreSnapshot(before)
    expect(setProjectFormat).toHaveBeenCalledWith('project-1', vlog)

    setProjectFormat.mockClear()
    const beforePass = captureSnapshot()
    await hydrateTimelineStoresFromProject(project(passTimeline), { keepHistory: true })
    useProjectStore.setState((state) => ({
      currentProject: state.currentProject && {
        ...state.currentProject,
        format: { id: 'ten-shot' } as never,
      },
    }))
    useTimelineCommandStore.getState().recordExternalChange({ type: 'EXTERNAL_CHANGE' }, beforePass)
    useTimelineCommandStore.getState().undo()
    expect(setProjectFormat).not.toHaveBeenCalled()
  })
})
