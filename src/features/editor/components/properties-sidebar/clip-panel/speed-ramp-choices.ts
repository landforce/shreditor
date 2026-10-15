/**
 * Speed ramp presets as the clip panel and the Concise shot card offer them:
 * which one a clip carries, and applying one (or none) to the selection.
 */

import {
  hasSpeedRamp,
  sameSpeedRamp,
  speedRampPreset,
  speedRange,
  type SpeedRampKey,
  type SpeedRampPreset,
} from '@/shared/timeline/speed-ramp.mjs'
import {
  clearSpeedRamp,
  setSpeedRamp,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'

export type SpeedRampChoice = 'none' | SpeedRampPreset

/** What a selection carries: a preset (or none), a hand-made curve, or different ones. */
export type SpeedRampState = SpeedRampChoice | 'custom' | 'mixed'

export const SPEED_RAMP_CHOICES: readonly SpeedRampChoice[] = [
  'none',
  'ease-in',
  'ease-out',
  'hero',
  'whip',
]

export const SPEED_RAMP_CHOICE_LABEL_KEYS: Record<SpeedRampChoice, string> = {
  none: 'editor.speedRamp.none',
  'ease-in': 'editor.speedRamp.easeIn',
  'ease-out': 'editor.speedRamp.easeOut',
  hero: 'editor.speedRamp.hero',
  whip: 'editor.speedRamp.whip',
}

interface RampedClip {
  speedRamp?: readonly SpeedRampKey[]
  durationInFrames: number
}

/** The preset a clip's ramp equals (built for its current length), else 'custom'. */
export function getSpeedRampChoice(item: RampedClip): SpeedRampChoice | 'custom' {
  if (!hasSpeedRamp(item)) return 'none'
  const preset = SPEED_RAMP_CHOICES.find(
    (choice) =>
      choice !== 'none' &&
      sameSpeedRamp(
        item.speedRamp,
        speedRampPreset(choice, { durationInFrames: item.durationInFrames }),
      ),
  )
  return preset ?? 'custom'
}

/** The selection's shared ramp state ('mixed' when the clips differ). */
export function getSharedSpeedRampState(items: readonly RampedClip[]): SpeedRampState {
  let shared: SpeedRampState | null = null
  for (const item of items) {
    const choice = getSpeedRampChoice(item)
    if (shared === null) shared = choice
    else if (shared !== choice) return 'mixed'
  }
  return shared ?? 'none'
}

/** Slowest and fastest speed across the selection's ramped clips; null when none is ramped. */
export function getCombinedSpeedRampRange(
  items: readonly RampedClip[],
): { min: number; max: number } | null {
  let range: { min: number; max: number } | null = null
  for (const item of items) {
    if (!hasSpeedRamp(item)) continue
    const next = speedRange(item)
    range = range
      ? { min: Math.min(range.min, next.min), max: Math.max(range.max, next.max) }
      : next
  }
  return range
}

/** "0.3", "2", "1.25": a ramp speed for display. */
export function formatRampSpeed(speed: number): string {
  return String(Math.round(speed * 100) / 100)
}

/**
 * Give the clips a preset ramp built for each one's length, or remove their
 * ramps ('none'). One undo step; linked audio follows.
 */
export function applySpeedRampChoice(itemIds: readonly string[], choice: SpeedRampChoice): void {
  if (itemIds.length === 0) return
  const items = useTimelineStore.getState().items
  if (choice === 'none') {
    const ramped = itemIds.filter((itemId) =>
      hasSpeedRamp(items.find((entry) => entry.id === itemId)),
    )
    if (ramped.length > 0) clearSpeedRamp(ramped)
    return
  }
  setSpeedRamp(itemIds, (itemId) => {
    const item = items.find((entry) => entry.id === itemId)
    return item ? speedRampPreset(choice, { durationInFrames: item.durationInFrames }) : null
  })
}
