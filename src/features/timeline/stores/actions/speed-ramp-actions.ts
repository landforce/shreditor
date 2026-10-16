/**
 * Speed ramp actions: set or clear a clip's variable-speed curve, keeping its
 * source window equal to the curve's integral and its linked companions (a
 * video's own audio) on the same curve. Shared by the editor and the agent's
 * `setSpeedRamp` op.
 *
 * The curve lives on the item (`speedRamp`, src/shared/timeline/speed-ramp.mjs)
 * because every renderer, mixer and mapper receives items. The editor's
 * keyframe/dopesheet editor shows it as the `speed` lane: `syncSpeedRampLanes`
 * mirrors the item curve into that lane, and an edit made in the lane comes
 * back to the item (with its source window re-derived) the same way.
 */

import type { AudioItem, TimelineItem, VideoItem } from '@/types/timeline'
import type { ItemKeyframes, Keyframe, PropertyKeyframes } from '@/types/keyframe'
import {
  DEFAULT_SPEED,
  getSpeedRamp,
  maxDurationForMedia,
  normalizeSpeedRamp,
  sameSpeedRamp,
  sourceSpanFrames,
  type SpeedRampKey,
} from '@/shared/timeline/speed-ramp.mjs'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { getSynchronizedLinkedItems } from '../../utils/linked-items'

const SPEED_LANE_PROPERTY = 'speed' as const

type RampableItem = VideoItem | AudioItem

export function isSpeedRampable(item: TimelineItem | undefined): item is RampableItem {
  return item?.type === 'video' || item?.type === 'audio'
}

export class SpeedRampFitError extends Error {
  constructor(
    message: string,
    readonly maxDurationInFrames: number,
  ) {
    super(message)
    this.name = 'SpeedRampFitError'
  }
}

interface SpeedRampPlan {
  item: RampableItem
  updates: Partial<TimelineItem>
}

function withIds(keys: SpeedRampKey[]): SpeedRampKey[] {
  return keys.map((key) => (key.id ? key : { ...key, id: crypto.randomUUID() }))
}

/** Source frames this clip can still play from its first frame (reversed: down to 0). */
function availableSourceFrames(item: RampableItem): number | undefined {
  if (item.isReversed === true) return item.sourceEnd ?? item.sourceDuration
  if (item.sourceDuration === undefined) return undefined
  return Math.max(0, item.sourceDuration - (item.sourceStart ?? 0))
}

function describeClip(item: RampableItem): string {
  return `${item.type} "${(item.label || item.id).slice(0, 40)}"`
}

/** The longest length `next`'s curve can play for in the media left to it. */
function maxRampDuration(
  item: RampableItem,
  next: RampableItem,
  available: number,
  fps: number,
): number {
  const start = item.isReversed === true ? 0 : (item.sourceStart ?? 0)
  const total = item.isReversed === true ? available : (item.sourceDuration ?? available)
  return Math.max(1, maxDurationForMedia(next, start, total, fps))
}

function speedRampFitError(
  item: RampableItem,
  keys: SpeedRampKey[] | undefined,
  span: number,
  available: number,
  maxDuration: number,
): SpeedRampFitError {
  const speeds = keys ? 'these speeds' : `${item.speed ?? DEFAULT_SPEED}x`
  return new SpeedRampFitError(
    `${describeClip(item)} would play ${Math.round(span)} source frames from ` +
      `${item.isReversed === true ? 'its sourceEnd' : `sourceStart ${item.sourceStart ?? 0}`}, ` +
      `but only ${available} are left in the media (sourceDuration ${item.sourceDuration ?? '?'}). ` +
      `At ${speeds} the clip can be at most ${maxDuration} frames long: shorten it, lower the speeds, or start earlier in the source.`,
    maxDuration,
  )
}

/** The source window `sourceFrames` long that the clip plays from its first frame. */
function rampSourceWindow(item: RampableItem, sourceFrames: number): Partial<TimelineItem> {
  if (item.isReversed === true) {
    const end = item.sourceEnd ?? (item.sourceStart ?? 0) + sourceFrames
    return { sourceEnd: end, sourceStart: Math.max(0, end - sourceFrames) }
  }
  const start = item.sourceStart ?? 0
  return { sourceStart: start, sourceEnd: start + sourceFrames }
}

/**
 * The item updates that give `item` these keys (or its constant speed when
 * none) at its current length, or at the longest length the media allows when
 * `fit` is 'shorten'. 'error' throws a SpeedRampFitError naming that length.
 */
function planSpeedRamp(
  item: RampableItem,
  keys: SpeedRampKey[] | undefined,
  durationInFrames: number,
  fit: 'error' | 'shorten',
  fps: number,
): { updates: Partial<TimelineItem>; durationInFrames: number } {
  const next = { ...item, speedRamp: keys, durationInFrames } as RampableItem
  const available = availableSourceFrames(item)
  let duration = durationInFrames
  let span = sourceSpanFrames(next, fps, duration)
  if (available !== undefined && Math.round(span) > available) {
    const maxDuration = maxRampDuration(item, next, available, fps)
    if (fit === 'error') throw speedRampFitError(item, keys, span, available, maxDuration)
    duration = maxDuration
    span = sourceSpanFrames(next, fps, duration)
  }
  const sourceFrames = Math.max(1, Math.round(span))
  const updates: Partial<TimelineItem> = {
    speedRamp: keys,
    durationInFrames: duration,
    ...rampSourceWindow(item, sourceFrames),
  }
  return { updates, durationInFrames: duration }
}

/**
 * Plan a ramp (or its removal, `keys` null/empty) for an item and the linked
 * companions that share its window. Throws when the item can't take a ramp or,
 * with fit 'error', when the source window would run past the media.
 */
export function planItemSpeedRamp(
  itemId: string,
  keys: readonly SpeedRampKey[] | null,
  options: { fit?: 'error' | 'shorten'; linked?: boolean } = {},
): SpeedRampPlan[] {
  const { items, itemById } = useItemsStore.getState()
  const item = itemById[itemId]
  if (!item) throw new Error(`item "${itemId}" does not exist`)
  if (!isSpeedRampable(item)) {
    throw new Error(
      `${item.type} "${item.label || item.id}" can't take a speed ramp (video or audio only)`,
    )
  }
  const fps = useTimelineSettingsStore.getState().fps || 30
  const normalized = keys ? withIds(normalizeSpeedRamp(keys)) : []
  const ramp = normalized.length > 0 ? normalized : undefined
  const group = (
    options.linked === false ? [item] : getSynchronizedLinkedItems(items, itemId)
  ).filter(isSpeedRampable)
  const fit = options.fit ?? 'shorten'
  // The shortest length any member's media allows applies to all, so they stay in sync.
  let duration = item.durationInFrames
  for (const member of group) {
    duration = Math.min(duration, planSpeedRamp(member, ramp, duration, fit, fps).durationInFrames)
  }
  return group.map((member) => ({
    item: member,
    updates: planSpeedRamp(member, ramp, duration, fit, fps).updates,
  }))
}

/** Apply a plan to the stores (no history): items, then their `speed` lanes. */
export function applySpeedRampPlan(plan: SpeedRampPlan[]): void {
  const itemsStore = useItemsStore.getState()
  for (const entry of plan) itemsStore._updateItem(entry.item.id, entry.updates)
  syncSpeedRampLanes(plan.map((entry) => entry.item.id))
}

// ---------------------------------------------------------------------------
// The `speed` keyframe lane
// ---------------------------------------------------------------------------

function laneKeyframes(keys: readonly SpeedRampKey[] | undefined): Keyframe[] {
  return (keys ?? [])
    .filter((key) => key.frame >= 0)
    .map((key) => ({
      id: key.id ?? crypto.randomUUID(),
      frame: key.frame,
      value: key.speed,
      easing: key.easing ?? 'linear',
      ...(key.easingConfig ? { easingConfig: key.easingConfig } : {}),
    }))
}

function keysFromLane(lane: PropertyKeyframes | undefined): SpeedRampKey[] {
  return normalizeSpeedRamp(
    (lane?.keyframes ?? []).map((keyframe) => ({
      id: keyframe.id,
      frame: keyframe.frame,
      speed: keyframe.value,
      ...(keyframe.easing !== 'linear' ? { easing: keyframe.easing } : {}),
      ...(keyframe.easingConfig ? { easingConfig: keyframe.easingConfig } : {}),
    })),
  )
}

function getSpeedLane(itemId: string): PropertyKeyframes | undefined {
  return useKeyframesStore
    .getState()
    .keyframesByItemId[itemId]?.properties.find((p) => p.property === SPEED_LANE_PROPERTY)
}

/** True when the lane shows exactly the item's keys at frame 0 and later. */
function laneMatchesItem(item: TimelineItem, lane: PropertyKeyframes | undefined): boolean {
  const visible = (getSpeedRamp(item) ?? []).filter((key) => key.frame >= 0)
  return sameSpeedRamp(normalizeSpeedRamp(visible), keysFromLane(lane))
}

let reconciling = false

/** Write the items' curves into their `speed` lanes (the item wins). */
export function syncSpeedRampLanes(itemIds?: readonly string[]): void {
  const { itemById, items } = useItemsStore.getState()
  const keyframesStore = useKeyframesStore.getState()
  const ids = itemIds ?? [
    ...new Set([
      ...items.filter((item) => getSpeedRamp(item)).map((item) => item.id),
      ...keyframesStore.keyframes
        .filter((entry) => entry.properties.some((p) => p.property === SPEED_LANE_PROPERTY))
        .map((entry) => entry.itemId),
    ]),
  ]
  let next: ItemKeyframes[] | null = null
  for (const id of ids) {
    const item = itemById[id]
    const lane = getSpeedLane(id)
    if (!item) continue
    if (laneMatchesItem(item, lane)) continue
    const keyframes = laneKeyframes(getSpeedRamp(item) ?? undefined)
    next ??= [...useKeyframesStore.getState().keyframes]
    const index = next.findIndex((entry) => entry.itemId === id)
    const existing = index >= 0 ? next[index]! : { itemId: id, properties: [] }
    const others = existing.properties.filter((p) => p.property !== SPEED_LANE_PROPERTY)
    const properties =
      keyframes.length > 0 ? [...others, { property: SPEED_LANE_PROPERTY, keyframes }] : others
    const updated = { ...existing, properties }
    if (index >= 0) next[index] = updated
    else next.push(updated)
  }
  if (!next) return
  const wasReconciling = reconciling
  reconciling = true
  try {
    useKeyframesStore.getState().setKeyframes(next)
  } finally {
    reconciling = wasReconciling
  }
}

/** Speed lanes and item curves before a command, to tell which side an edit changed. */
interface SpeedRampStateCapture {
  lanes: Map<string, PropertyKeyframes | undefined>
  ramps: Map<string, readonly SpeedRampKey[] | undefined>
}

function captureSpeedRampState(): SpeedRampStateCapture {
  const lanes = new Map<string, PropertyKeyframes | undefined>()
  for (const entry of useKeyframesStore.getState().keyframes) {
    const lane = entry.properties.find((p) => p.property === SPEED_LANE_PROPERTY)
    if (lane) lanes.set(entry.itemId, lane)
  }
  const ramps = new Map<string, readonly SpeedRampKey[] | undefined>()
  for (const item of useItemsStore.getState().items) {
    if (item.speedRamp) ramps.set(item.id, item.speedRamp)
  }
  return { lanes, ramps }
}

/** Which items take their lane's edit as their curve, and which write their curve to the lane. */
function partitionSpeedRampEdits(
  before: SpeedRampStateCapture,
  after: SpeedRampStateCapture,
): { fromLanes: Array<{ id: string; keys: SpeedRampKey[] }>; toLanes: string[] } {
  const ids = new Set([
    ...before.lanes.keys(),
    ...after.lanes.keys(),
    ...before.ramps.keys(),
    ...after.ramps.keys(),
  ])
  const { itemById } = useItemsStore.getState()
  const fromLanes: Array<{ id: string; keys: SpeedRampKey[] }> = []
  const toLanes: string[] = []
  for (const id of ids) {
    const item = itemById[id]
    if (!item) continue
    const lane = after.lanes.get(id)
    if (laneMatchesItem(item, lane)) continue
    const laneChanged = before.lanes.get(id) !== lane
    const rampChanged = before.ramps.get(id) !== after.ramps.get(id)
    if (laneChanged && !rampChanged && isSpeedRampable(item)) {
      // Keys before the clip's start (after a split) aren't in the lane; keep them.
      const hidden = (getSpeedRamp(item) ?? []).filter((key) => key.frame < 0)
      fromLanes.push({ id, keys: [...hidden, ...keysFromLane(lane)] })
    } else {
      toLanes.push(id)
    }
  }
  return { fromLanes, toLanes }
}

/**
 * Bring curves and lanes back in step after a change. A lane edited while
 * its item's curve stayed put (the dopesheet, the value graph) becomes the
 * item's curve, with the source window re-derived and the linked audio
 * following; otherwise the item's curve is written to the lane.
 */
function reconcileSpeedRamps(before: SpeedRampStateCapture): void {
  if (reconciling) return
  const { fromLanes, toLanes } = partitionSpeedRampEdits(before, captureSpeedRampState())
  reconciling = true
  try {
    for (const { id, keys } of fromLanes) {
      const keysInside = keys.filter((key) => key.frame >= 0)
      applySpeedRampPlan(planItemSpeedRamp(id, keysInside.length > 0 ? keys : null))
    }
  } finally {
    reconciling = false
  }
  if (toLanes.length > 0) syncSpeedRampLanes(toLanes)
}

let installed = false
let commandDepth = 0

/**
 * Keep curves and lanes in step for changes made outside commands (live
 * drags, snapshot restores, project loads). Commands reconcile on their own
 * (`runWithSpeedRampReconcile`).
 */
function installSpeedRampSync(): void {
  if (installed) return
  installed = true
  let { ramps, lanes } = captureSpeedRampState()
  const refresh = () => {
    ;({ ramps, lanes } = captureSpeedRampState())
  }
  useItemsStore.subscribe((state, previous) => {
    if (state.items === previous.items) return
    if (commandDepth === 0 && !reconciling) {
      reconcileSpeedRamps({ lanes: captureSpeedRampState().lanes, ramps })
    }
    refresh()
  })
  useKeyframesStore.subscribe((state, previous) => {
    if (state.keyframes === previous.keyframes) return
    if (commandDepth === 0 && !reconciling) {
      reconcileSpeedRamps({ lanes, ramps: captureSpeedRampState().ramps })
    }
    refresh()
  })
}

/** Run a command's action, then reconcile what it changed (one undo step). */
export function runWithSpeedRampReconcile<T>(action: () => T): T {
  installSpeedRampSync()
  const before = captureSpeedRampState()
  commandDepth += 1
  try {
    return action()
  } finally {
    commandDepth -= 1
    if (commandDepth === 0) reconcileSpeedRamps(before)
  }
}
