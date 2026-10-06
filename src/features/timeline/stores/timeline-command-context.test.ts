// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  makeTimelineVideoItem as makeVideoItem,
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/timeline/test-helpers'
import { useTimelineCommandStore } from './timeline-command-store'
import { useItemsStore } from './items-store'

/** Execute a change that actually mutates items so a history entry is recorded. */
function recordChange(itemId: string): void {
  useTimelineCommandStore.getState().execute({ type: 'TEST_ADD' }, () => {
    useItemsStore
      .getState()
      .setItems([
        ...useItemsStore.getState().items,
        makeVideoItem({ id: itemId, trackId: 'track-v1' }),
      ])
  })
}

describe('timeline-command-store per-context history', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([])
    useTimelineCommandStore.getState().clearHistory()
  })

  afterEach(() => resetTimelineCompositionTestState())

  it('parks and restores per-context undo stacks on setActiveContext', () => {
    const cmd = useTimelineCommandStore

    // Record one entry in the root context.
    recordChange('root-1')
    expect(cmd.getState().undoStack).toHaveLength(1)
    expect(cmd.getState().canUndo).toBe(true)

    // Switching to a composition context parks root and starts empty.
    cmd.getState().setActiveContext('comp-a')
    expect(cmd.getState().undoStack).toHaveLength(0)
    expect(cmd.getState().canUndo).toBe(false)

    // Record two entries in comp-a's context.
    recordChange('a-1')
    recordChange('a-2')
    expect(cmd.getState().undoStack).toHaveLength(2)

    // Back to root: comp-a parked, root's single entry restored.
    cmd.getState().setActiveContext(null)
    expect(cmd.getState().undoStack).toHaveLength(1)
    expect(cmd.getState().canUndo).toBe(true)

    // Back to comp-a: its two entries are intact.
    cmd.getState().setActiveContext('comp-a')
    expect(cmd.getState().undoStack).toHaveLength(2)
  })

  it('clearHistory wipes every parked context', () => {
    const cmd = useTimelineCommandStore
    recordChange('root-1')
    cmd.getState().setActiveContext('comp-a')
    recordChange('a-1')
    // Return to root so comp-a's stack is *parked* (not active) at clear time.
    cmd.getState().setActiveContext(null)
    expect(cmd.getState().undoStack).toHaveLength(1) // root-1 restored

    cmd.getState().clearHistory()

    expect(cmd.getState().undoStack).toHaveLength(0)
    expect(cmd.getState().activeContextKey).toBe('__root__')

    // Swap comp-a back in: if clearHistory really wiped the parked stacks, its
    // previously-recorded entry is gone (this forces the real swap-in path).
    cmd.getState().setActiveContext('comp-a')
    expect(cmd.getState().undoStack).toHaveLength(0)
  })

  it('removeContext drops a parked composition context', () => {
    const cmd = useTimelineCommandStore
    recordChange('root-1')
    cmd.getState().setActiveContext('comp-a')
    recordChange('a-1')
    cmd.getState().setActiveContext(null) // park comp-a with its entry

    cmd.getState().removeContext('comp-a')

    // Re-entering comp-a now finds no parked history.
    cmd.getState().setActiveContext('comp-a')
    expect(cmd.getState().undoStack).toHaveLength(0)
  })

  it('is a no-op when switching to the already-active context', () => {
    const cmd = useTimelineCommandStore
    recordChange('root-1')
    cmd.getState().setActiveContext(null) // already root
    expect(cmd.getState().undoStack).toHaveLength(1)
  })

  it('a command run inside another is one undo step', () => {
    const cmd = useTimelineCommandStore
    cmd.getState().execute({ type: 'OUTER' }, () => {
      recordChange('nested-1')
      recordChange('nested-2')
    })
    expect(cmd.getState().undoStack.map((e) => e.command.type)).toEqual(['OUTER'])
    cmd.getState().undo()
    expect(useItemsStore.getState().items).toEqual([])
  })

  it('an update that writes what was already there adds no undo step', () => {
    recordChange('same-1')
    const cmd = useTimelineCommandStore
    cmd.getState().execute({ type: 'NO_OP' }, () => {
      useItemsStore.getState().setItems(useItemsStore.getState().items.map((item) => ({ ...item })))
    })
    expect(cmd.getState().undoStack.map((e) => e.command.type)).toEqual(['TEST_ADD'])
  })

  it('changes of one edit session (typing) are one undo step', () => {
    const cmd = useTimelineCommandStore
    for (const id of ['t-1', 't-2', 't-3']) {
      cmd
        .getState()
        .execute({ type: 'EDIT_TEXT', payload: { coalesce: 'session-a' } }, () =>
          useItemsStore
            .getState()
            .setItems([
              ...useItemsStore.getState().items,
              makeVideoItem({ id, trackId: 'track-v1' }),
            ]),
        )
    }
    cmd
      .getState()
      .execute({ type: 'EDIT_TEXT', payload: { coalesce: 'session-b' } }, () =>
        useItemsStore
          .getState()
          .setItems([
            ...useItemsStore.getState().items,
            makeVideoItem({ id: 't-4', trackId: 'track-v1' }),
          ]),
      )
    expect(cmd.getState().undoStack).toHaveLength(2)
    cmd.getState().undo()
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['t-1', 't-2', 't-3'])
    cmd.getState().undo()
    expect(useItemsStore.getState().items).toEqual([])
  })
})
