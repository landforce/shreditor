// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  makeTimelineVideoItem as makeVideoItem,
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/timeline/test-helpers'
import { setAgentEditLock } from '@/shared/state/agent-edit-lock'
import { captureSnapshot } from './commands/snapshot'
import { useTimelineCommandStore } from './timeline-command-store'
import { useItemsStore } from './items-store'
import { useTimelineSettingsStore } from './timeline-settings-store'

const commands = () => useTimelineCommandStore.getState()
const itemIds = () => useItemsStore.getState().items.map((item) => item.id)

/** An ordinary edit: add a clip, as the timeline actions do. */
function addClip(id: string): string {
  return commands().execute({ type: 'ADD_ITEM' }, () => {
    useItemsStore
      .getState()
      .setItems([...useItemsStore.getState().items, makeVideoItem({ id, trackId: 'track-v1' })])
    return id
  })
}

describe('watch mode (an agent is mid-pass): the command store refuses edits', () => {
  const onRefused = vi.fn()
  let exempt = false
  const lock = () => setAgentEditLock({ locked: true, isExempt: () => exempt, onRefused })

  beforeEach(() => {
    resetTimelineCompositionTestState()
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([])
    commands().clearHistory()
    onRefused.mockClear()
    exempt = false
  })

  afterEach(() => {
    setAgentEditLock(null)
    resetTimelineCompositionTestState()
  })

  it('puts a refused command back, keeps it out of history and tells the user', () => {
    addClip('before')
    lock()
    const result = addClip('during')
    expect(result).toBe('during') // callers still get their value, so drags and dialogs finish
    expect(itemIds()).toEqual(['before'])
    expect(commands().undoStack).toHaveLength(1)
    expect(onRefused).toHaveBeenCalledTimes(1)
  })

  it('allows the same command once the lock lifts', () => {
    lock()
    addClip('refused')
    setAgentEditLock(null)
    addClip('allowed')
    expect(itemIds()).toEqual(['allowed'])
    expect(commands().undoStack).toHaveLength(1)
  })

  it('lets view settings through, and says nothing for commands that change nothing', () => {
    lock()
    const snap = useTimelineSettingsStore.getState().snapEnabled
    commands().execute({ type: 'TOGGLE_SNAP' }, () =>
      useTimelineSettingsStore.getState().toggleSnap(),
    )
    expect(useTimelineSettingsStore.getState().snapEnabled).toBe(!snap)
    commands().execute({ type: 'UPDATE_ITEM' }, () => undefined)
    expect(onRefused).not.toHaveBeenCalled()
  })

  it('lets the editor load the project (an agent pass landing) while locked', () => {
    lock()
    exempt = true
    addClip('from-disk')
    expect(itemIds()).toEqual(['from-disk'])
    expect(onRefused).not.toHaveBeenCalled()
  })

  it('reverts a live drag committed through addUndoEntry, leaving no ghost state', () => {
    addClip('clip')
    lock()
    const before = captureSnapshot()
    // A slider or graph drag writes the stores as it moves...
    useItemsStore
      .getState()
      .setItems([makeVideoItem({ id: 'clip', trackId: 'track-v1', from: 90 })])
    // ...and commits on release.
    commands().addUndoEntry({ type: 'UPDATE_TRANSFORM' }, before)
    expect(useItemsStore.getState().items[0]?.from).toBe(before.items[0]?.from)
    expect(commands().undoStack).toHaveLength(1)
    expect(onRefused).toHaveBeenCalledTimes(1)
  })

  it('refuses undo and redo', () => {
    addClip('a')
    lock()
    commands().undo()
    expect(itemIds()).toEqual(['a'])
    setAgentEditLock(null)
    commands().undo()
    expect(itemIds()).toEqual([])
    lock()
    commands().redo()
    expect(itemIds()).toEqual([])
    expect(onRefused).toHaveBeenCalledTimes(2)
  })
})
