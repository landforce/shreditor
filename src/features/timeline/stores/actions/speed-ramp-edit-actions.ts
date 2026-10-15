/**
 * Undoable speed ramp edits for the editor (clip panel, Concise shot card,
 * timeline menus). The planning and the keyframe-lane sync live in
 * ./speed-ramp-actions.
 */

import type { SpeedRampKey } from '@/shared/timeline/speed-ramp.mjs'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute, applyTransitionRepairs } from './shared'
import { applySpeedRampPlan, planItemSpeedRamp } from './speed-ramp-actions'

/**
 * Give clips a speed curve (their linked audio follows), in one undo step.
 * Each clip keeps its length unless its media runs out first, then it is
 * shortened to the longest length the media allows.
 */
export function setSpeedRamp(
  itemIds: readonly string[],
  keysFor: (itemId: string) => readonly SpeedRampKey[] | null,
): void {
  execute(
    'SET_SPEED_RAMP',
    () => {
      const changed = new Set<string>()
      for (const id of itemIds) {
        if (changed.has(id)) continue
        const plan = planItemSpeedRamp(id, keysFor(id), { fit: 'shorten' })
        applySpeedRampPlan(plan)
        for (const entry of plan) changed.add(entry.item.id)
      }
      if (changed.size > 0) {
        applyTransitionRepairs([...changed])
        useTimelineSettingsStore.getState().markDirty()
      }
    },
    { itemIds: [...itemIds] },
  )
}

/** Remove clips' speed curves: they play at their constant speed again, same length. */
export function clearSpeedRamp(itemIds: readonly string[]): void {
  setSpeedRamp(itemIds, () => null)
}

/** Apply a checked plan (planItemSpeedRamp) as one undo step: the agent's setSpeedRamp. */
export function commitSpeedRampPlan(plan: ReturnType<typeof planItemSpeedRamp>): void {
  execute(
    'SET_SPEED_RAMP',
    () => {
      applySpeedRampPlan(plan)
      applyTransitionRepairs(plan.map((entry) => entry.item.id))
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemIds: plan.map((entry) => entry.item.id) },
  )
}
