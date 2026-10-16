/**
 * Speed as headless ops: `setSpeedRamp` / `clearSpeedRamp`, and the rate-stretch
 * semantics `updateItem { speed }` follows.
 *
 * A ramp keeps the clip's length and re-derives its source window from the
 * curve's integral (src/shared/timeline/speed-ramp.mjs); the linked audio takes
 * the same curve. A window that would run past the media fails, naming the
 * longest clip the curve allows. A constant speed set through updateItem is a
 * rate stretch, as in the editor: the clip keeps its source and changes length.
 */
import type { TimelineItem } from '@/types/timeline'
import {
  MAX_SPEED,
  MIN_SPEED,
  SPEED_RAMP_PRESETS,
  getSpeedRamp,
  speedRampKeysProblem,
  speedRampPreset,
  speedRange,
  type SpeedRampKey,
} from '@/shared/timeline/speed-ramp.mjs'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import {
  isSpeedRampable,
  planItemSpeedRamp,
  SpeedRampFitError,
} from '@/features/timeline/stores/actions/speed-ramp-actions'
import { commitSpeedRampPlan } from '@/features/timeline/stores/timeline-actions'
import {
  sourceToTimelineFrames,
  timelineToSourceFrames,
} from '@/features/timeline/utils/source-calculations'

export type SpeedRampOperationName = 'setSpeedRamp' | 'clearSpeedRamp'

type Op = Record<string, unknown>

const PRESET_OPTION_KEYS = [
  'frame',
  'speed',
  'baseSpeed',
  'startSpeed',
  'endSpeed',
  'holdFrames',
  'rampFrames',
] as const

function requireRampable(op: Op): TimelineItem {
  const id = typeof op.id === 'string' ? op.id : ''
  if (!id) throw new Error(`${String(op.op)} requires \`id\``)
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`id: item "${id}" does not exist`)
  if (!isSpeedRampable(item)) {
    throw new Error(
      `id: ${item.type} "${item.label || id}" can't take a speed ramp (video or audio only)`,
    )
  }
  return item
}

function presetOptionsFromOp(op: Op): Record<string, number> {
  const options: Record<string, number> = {}
  for (const key of PRESET_OPTION_KEYS) {
    if (op[key] === undefined) continue
    if (typeof op[key] !== 'number' || !Number.isFinite(op[key])) {
      throw new Error(`${key} must be a number`)
    }
    options[key] = op[key]
  }
  return options
}

function assertPresetOptionsInRange(options: Record<string, number>, item: TimelineItem) {
  if (options.frame !== undefined && (options.frame < 0 || options.frame > item.durationInFrames)) {
    throw new Error(`frame ${options.frame} is outside the clip (0..${item.durationInFrames})`)
  }
  for (const key of ['speed', 'baseSpeed', 'startSpeed', 'endSpeed'] as const) {
    const value = options[key]
    if (value !== undefined && (value < MIN_SPEED || value > MAX_SPEED)) {
      throw new Error(`${key} ${value} is outside ${MIN_SPEED}..${MAX_SPEED}`)
    }
  }
}

function presetKeysFromOp(op: Op, item: TimelineItem): SpeedRampKey[] {
  const name = String(op.preset)
  if (!SPEED_RAMP_PRESETS.includes(name as never)) {
    throw new Error(`preset: unknown "${name}" (presets: ${SPEED_RAMP_PRESETS.join(', ')})`)
  }
  const options = presetOptionsFromOp(op)
  assertPresetOptionsInRange(options, item)
  return speedRampPreset(name, { durationInFrames: item.durationInFrames, ...options })
}

function keysFromOp(op: Op, item: TimelineItem): SpeedRampKey[] | null {
  const hasKeys = op.keys !== undefined
  const hasPreset = op.preset !== undefined
  if (hasKeys === hasPreset) {
    throw new Error('setSpeedRamp needs exactly one of `keys` or `preset`')
  }
  if (hasPreset) return presetKeysFromOp(op, item)
  const problem = speedRampKeysProblem(op.keys, item.durationInFrames)
  if (problem) throw new Error(`keys: ${problem}`)
  const keys = op.keys as SpeedRampKey[]
  return keys.length > 0 ? keys : null
}

function runSetSpeedRamp(op: Op, keys: SpeedRampKey[] | null, item: TimelineItem) {
  let plan
  try {
    plan = planItemSpeedRamp(item.id, keys, { fit: 'error', linked: op.linked !== false })
  } catch (error) {
    if (error instanceof SpeedRampFitError) throw new Error(error.message)
    throw error
  }
  commitSpeedRampPlan(plan)
  const updated = useItemsStore.getState().itemById[item.id]!
  const range = speedRange(updated)
  return {
    id: item.id,
    keys: (getSpeedRamp(updated) ?? []).map(({ frame, speed, easing }) => ({
      frame,
      speed,
      ...(easing ? { easing } : {}),
    })),
    speedRange: range,
    durationInFrames: updated.durationInFrames,
    sourceStart: updated.sourceStart,
    sourceEnd: updated.sourceEnd,
    ...(plan.length > 1
      ? { linked: plan.filter((entry) => entry.item.id !== item.id).map((entry) => entry.item.id) }
      : {}),
  }
}

/** `setSpeedRamp` / `clearSpeedRamp`; null when `op` is neither. */
export function runSpeedRampOp(op: Op): { result: unknown } | null {
  switch (op.op) {
    case 'setSpeedRamp': {
      const item = requireRampable(op)
      return { result: runSetSpeedRamp(op, keysFromOp(op, item), item) }
    }
    case 'clearSpeedRamp': {
      const item = requireRampable(op)
      return { result: runSetSpeedRamp(op, null, item) }
    }
    default:
      return null
  }
}

/**
 * The timing updates `updateItem` applies when it changes `speed`, matching
 * the editor's rate stretch: with `speed` alone the clip keeps its source
 * window and its length follows (faster is shorter); with `durationInFrames`
 * the source window follows the new length; with `sourceEnd` the length
 * follows that window; all three must agree. On a ramped clip `speed` is only
 * stored (it is the speed the clip goes back to when the ramp is cleared).
 * Throws when the window would run past the media, naming the longest clip
 * that fits. `speedRamp` itself can't be set this way (setSpeedRamp).
 */
interface StretchContext {
  speed: number
  fps: number
  sourceFps: number
  sourceStart: number
}

function requireSpeed(speed: unknown): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed))
    throw new Error('speed must be a number')
  if (speed < MIN_SPEED || speed > MAX_SPEED) {
    throw new Error(`speed ${speed} is outside ${MIN_SPEED}..${MAX_SPEED}`)
  }
  return speed
}

function assertTimingAgrees(updates: Partial<TimelineItem>, ctx: StretchContext) {
  const { speed, fps, sourceFps, sourceStart } = ctx
  const expected = timelineToSourceFrames(updates.durationInFrames!, speed, fps, sourceFps)
  const actual = updates.sourceEnd! - sourceStart
  if (Math.abs(expected - actual) > Math.max(1, speed * (sourceFps / fps))) {
    throw new Error(
      `speed ${speed} for ${updates.durationInFrames} frames plays ${expected} source frames, ` +
        `but sourceStart..sourceEnd is ${actual}; give two of speed, durationInFrames and sourceEnd`,
    )
  }
}

/** The source window (and length) a rate stretch to `ctx.speed` gives. */
function stretchTiming(
  item: TimelineItem,
  updates: Partial<TimelineItem>,
  ctx: StretchContext,
): Partial<TimelineItem> {
  const { speed, fps, sourceFps, sourceStart } = ctx
  const hasDuration = 'durationInFrames' in updates
  const hasSourceEnd = 'sourceEnd' in updates
  const next: Partial<TimelineItem> = { ...updates }

  if (hasDuration && hasSourceEnd) {
    assertTimingAgrees(updates, ctx)
  } else if (hasDuration) {
    next.sourceStart = sourceStart
    next.sourceEnd =
      sourceStart + timelineToSourceFrames(updates.durationInFrames!, speed, fps, sourceFps)
  } else {
    const currentSpan =
      item.sourceEnd !== undefined
        ? item.sourceEnd - (item.sourceStart ?? 0)
        : timelineToSourceFrames(item.durationInFrames, item.speed ?? 1, fps, sourceFps)
    const span = hasSourceEnd ? updates.sourceEnd! - sourceStart : currentSpan
    next.sourceStart = sourceStart
    next.sourceEnd = sourceStart + span
    next.durationInFrames = Math.max(1, sourceToTimelineFrames(span, speed, sourceFps, fps))
  }
  return next
}

function assertWithinMedia(item: TimelineItem, next: Partial<TimelineItem>, ctx: StretchContext) {
  const { speed, fps, sourceFps, sourceStart } = ctx
  const sourceDuration = item.sourceDuration
  if (
    sourceDuration !== undefined &&
    next.sourceEnd !== undefined &&
    next.sourceEnd > sourceDuration
  ) {
    const maxDuration = Math.max(
      1,
      sourceToTimelineFrames(sourceDuration - sourceStart, speed, sourceFps, fps),
    )
    throw new Error(
      `speed ${speed}: the clip would play source frames ${sourceStart}..${next.sourceEnd}, ` +
        `past the media's end (${sourceDuration}); at ${speed}x it can be at most ${maxDuration} frames long`,
    )
  }
}

/**
 * The timing updates `updateItem` applies when it changes `speed`, matching
 * the editor's rate stretch: with `speed` alone the clip keeps its source
 * window and its length follows (faster is shorter); with `durationInFrames`
 * the source window follows the new length; with `sourceEnd` the length
 * follows that window; all three must agree. On a ramped clip `speed` is only
 * stored (it is the speed the clip goes back to when the ramp is cleared).
 * Throws when the window would run past the media, naming the longest clip
 * that fits. `speedRamp` itself can't be set this way (setSpeedRamp).
 */
export function speedUpdateTiming(
  item: TimelineItem,
  updates: Partial<TimelineItem>,
): Partial<TimelineItem> {
  if ('speedRamp' in updates) {
    throw new Error(
      'speedRamp: set a speed ramp with the setSpeedRamp op (clearSpeedRamp removes it)',
    )
  }
  if (!('speed' in updates)) return updates
  const speed = requireSpeed(updates.speed)
  if (!isSpeedRampable(item) || getSpeedRamp(item)) return updates

  const fps = useTimelineSettingsStore.getState().fps || 30
  const ctx: StretchContext = {
    speed,
    fps,
    sourceFps: item.sourceFps ?? fps,
    sourceStart: updates.sourceStart ?? item.sourceStart ?? 0,
  }
  const next = stretchTiming(item, updates, ctx)
  assertWithinMedia(item, next, ctx)
  return next
}
