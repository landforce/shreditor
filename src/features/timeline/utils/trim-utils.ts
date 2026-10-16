import type { TimelineItem } from '@/types/timeline'
import {
  getSourceProperties,
  getMaxTimelineDuration as calcMaxDuration,
  getMaxStartExtension,
  isMediaItem,
  timelineToSourceFrames,
} from './source-calculations'
import { useCompositionsStore } from '../stores/compositions-store'
import { isCompositionAudioItem } from '@/shared/utils/linked-media'
import { isHeldTemplateInstance } from '@/shared/motion-templates/instance-time'
import {
  getSpeedRamp,
  localFrameAtSourceFrames,
  pruneSpeedRamp,
  shiftSpeedRamp,
  sourceFramesAtLocalFrame,
  type SpeedRampKey,
} from '@/shared/timeline/speed-ramp.mjs'

export type TrimHandle = 'start' | 'end'

interface TrimClampResult {
  clampedAmount: number
  maxExtend: number | null
}

/**
 * For composition wrappers, the cached sourceDuration can grow stale when
 * inner edits extend the sub-comp. Read the live sub-comp duration instead
 * so the wrapper can be ripple/slide resized to match.
 */
function getEffectiveSourceDuration(item: TimelineItem): number | undefined {
  const compositionId =
    item.type === 'composition'
      ? item.compositionId
      : isCompositionAudioItem(item)
        ? item.compositionId
        : null
  if (compositionId) {
    const subComp = useCompositionsStore.getState().getComposition(compositionId)
    if (subComp) return subComp.durationInFrames
  }
  return getSourceProperties(item).sourceDuration
}

/**
 * Calculate the clamped trim amount respecting source boundaries.
 *
 * For media items (video/audio), trimming is constrained by:
 * - Start handle: can't extend past source start (0)
 * - End handle: can't extend past source end (sourceDuration)
 * - Both: can't shrink below 1 frame duration
 *
 * Speed is accounted for: timeline frames = source frames / speed
 *
 * @param item - The timeline item being trimmed
 * @param handle - Which handle is being dragged ('start' or 'end')
 * @param trimAmount - The requested trim amount in timeline frames
 *                     Positive = shrink for start, extend for end
 *                     Negative = extend for start, shrink for end
 * @returns The clamped trim amount and max extend value (if applicable)
 */
export function clampTrimAmount(
  item: TimelineItem,
  handle: TrimHandle,
  trimAmount: number,
  timelineFps: number = 30,
): TrimClampResult {
  if (isMediaItem(item) && !isHeldTemplateInstance(item) && getSpeedRamp(item)) {
    return clampRampedTrimAmount(item, handle, trimAmount, timelineFps)
  }

  let clampedAmount = trimAmount
  let maxExtend: number | null = null

  // A held template instance maps any length onto its template: no source edges.
  if (isMediaItem(item) && !isHeldTemplateInstance(item)) {
    const { sourceStart, sourceEnd, sourceFps, speed } = getSourceProperties(item)
    const sourceDuration = getEffectiveSourceDuration(item)
    const effectiveSourceFps = sourceFps ?? timelineFps

    if (handle === 'start') {
      // Start handle: negative trimAmount = extending left
      if (trimAmount < 0) {
        maxExtend =
          item.isReversed === true && sourceDuration !== undefined
            ? getMaxStartExtension(
                sourceDuration - (sourceEnd ?? sourceDuration),
                speed,
                effectiveSourceFps,
                timelineFps,
              )
            : getMaxStartExtension(sourceStart, speed, effectiveSourceFps, timelineFps)
        if (-trimAmount > maxExtend) {
          clampedAmount = -maxExtend
        }
      }
    } else {
      // End handle: positive trimAmount = extending right
      // Always use sourceDuration - trimming should always be reversible
      // (user can extend back to full source regardless of rate stretch state)
      if (item.isReversed === true) {
        const maxDuration =
          item.durationInFrames +
          getMaxStartExtension(sourceStart, speed, effectiveSourceFps, timelineFps)
        maxExtend = maxDuration - item.durationInFrames
        if (item.durationInFrames + trimAmount > maxDuration) {
          clampedAmount = maxDuration - item.durationInFrames
        }
      } else if (sourceDuration !== undefined) {
        const maxDuration = calcMaxDuration(
          sourceDuration,
          sourceStart,
          speed,
          effectiveSourceFps,
          timelineFps,
        )
        maxExtend = maxDuration - item.durationInFrames

        if (item.durationInFrames + trimAmount > maxDuration) {
          clampedAmount = maxDuration - item.durationInFrames
        }
      }
    }
  }

  // Clamp to minimum duration of 1 frame (applies to all items)
  clampedAmount = clampToMinDuration(item.durationInFrames, handle, clampedAmount)

  return { clampedAmount, maxExtend }
}

/** clampTrimAmount for a speed-ramped clip: its source edges come from the curve. */
function clampRampedTrimAmount(
  item: TimelineItem,
  handle: TrimHandle,
  trimAmount: number,
  timelineFps: number,
): TrimClampResult {
  let clampedAmount = trimAmount
  const maxExtend = clampRampedTrim(item, handle, trimAmount, timelineFps)
  if (maxExtend !== null) {
    if (handle === 'start' && trimAmount < 0 && -trimAmount > maxExtend) clampedAmount = -maxExtend
    if (handle === 'end' && trimAmount > maxExtend) clampedAmount = maxExtend
  }
  clampedAmount = clampToMinDuration(item.durationInFrames, handle, clampedAmount)
  return { clampedAmount, maxExtend }
}

/**
 * How far a speed-ramped clip can extend at a handle: the curve holds its edge
 * speed past the clip, and the source it would play must exist. Null when the
 * media length is unknown (end handle).
 */
function clampRampedTrim(
  item: TimelineItem,
  handle: TrimHandle,
  trimAmount: number,
  timelineFps: number,
): number | null {
  if (handle === 'start') {
    return trimAmount < 0 ? rampedStartExtension(item, timelineFps) : null
  }
  return rampedEndExtension(item, timelineFps)
}

function rampedStartExtension(item: TimelineItem, timelineFps: number): number {
  const { sourceStart, sourceEnd } = getSourceProperties(item)
  const sourceDuration = getEffectiveSourceDuration(item)
  // Source before the first played frame: below sourceStart, or above sourceEnd reversed.
  const available =
    item.isReversed === true
      ? sourceDuration !== undefined
        ? Math.max(0, sourceDuration - (sourceEnd ?? sourceDuration))
        : 0
      : sourceStart
  return Math.max(0, Math.floor(-localFrameAtSourceFrames(item, -available, timelineFps) + 1e-6))
}

function rampedEndExtension(item: TimelineItem, timelineFps: number): number | null {
  const { sourceStart, sourceEnd } = getSourceProperties(item)
  const sourceDuration = getEffectiveSourceDuration(item)
  if (item.isReversed === true) {
    // Reversed playback reads down from sourceEnd: everything to frame 0 is available.
    const end = sourceEnd ?? sourceDuration
    if (end === undefined) return null
    const maxDuration = Math.floor(localFrameAtSourceFrames(item, end, timelineFps) + 1e-6)
    return Math.max(0, maxDuration - item.durationInFrames)
  }
  if (sourceDuration === undefined) return null
  const maxDuration = Math.floor(
    localFrameAtSourceFrames(item, sourceDuration - sourceStart, timelineFps) + 1e-6,
  )
  return Math.max(0, maxDuration - item.durationInFrames)
}

/**
 * Clamp trim amount so the item doesn't overlap adjacent items on the same track.
 *
 * For start handle (extending left): can't extend past the end of the previous item.
 * For end handle (extending right): can't extend past the start of the next item.
 *
 * @param transitionLinkedIds - IDs of clips that have a transition with this item.
 *   These clips are allowed to overlap (they already do in the overlap model).
 */
export function clampToAdjacentItems(
  item: TimelineItem,
  handle: TrimHandle,
  trimAmount: number,
  allItems: TimelineItem[],
  transitionLinkedIds?: Set<string>,
): number {
  const itemEnd = item.from + item.durationInFrames

  if (handle === 'end' && trimAmount > 0) {
    // Extending right — find nearest item that starts at or after our current end
    let nearestStart = Infinity
    for (const other of allItems) {
      if (other.id === item.id) continue
      if (other.trackId !== item.trackId) continue
      // Skip transition-linked clips — they're allowed to overlap
      if (transitionLinkedIds?.has(other.id)) continue
      if (other.from >= itemEnd) {
        nearestStart = Math.min(nearestStart, other.from)
      }
    }
    if (nearestStart !== Infinity) {
      const maxExtend = nearestStart - itemEnd
      if (trimAmount > maxExtend) {
        return maxExtend
      }
    }
  } else if (handle === 'start' && trimAmount < 0) {
    // Extending left — find nearest item that ends at or before our current start
    let nearestEnd = -Infinity
    for (const other of allItems) {
      if (other.id === item.id) continue
      if (other.trackId !== item.trackId) continue
      // Skip transition-linked clips — they're allowed to overlap
      if (transitionLinkedIds?.has(other.id)) continue
      const otherEnd = other.from + other.durationInFrames
      if (otherEnd <= item.from) {
        nearestEnd = Math.max(nearestEnd, otherEnd)
      }
    }
    if (nearestEnd !== -Infinity) {
      const maxExtend = item.from - nearestEnd
      if (-trimAmount > maxExtend) {
        return maxExtend > 0 ? -maxExtend : 0
      }
    }
  }

  return trimAmount
}

/**
 * Clamp trim amount to ensure minimum duration of 1 frame.
 */
function clampToMinDuration(
  currentDuration: number,
  handle: TrimHandle,
  trimAmount: number,
): number {
  if (handle === 'start') {
    // Start: positive trim shrinks, negative extends
    const newDuration = currentDuration - trimAmount
    if (newDuration <= 0) {
      return currentDuration - 1
    }
  } else {
    // End: positive trim extends, negative shrinks
    const newDuration = currentDuration + trimAmount
    if (newDuration <= 0) {
      return -currentDuration + 1
    }
  }
  return trimAmount
}

/**
 * Calculate new source boundaries after a trim operation.
 */
interface TrimSourceUpdate {
  sourceStart?: number
  sourceEnd?: number
  /** A ramped clip's keys after the trim (a start trim moves them with the clip's start). */
  speedRamp?: SpeedRampKey[]
}

/** `nextEnd`, kept inside the media when its length is known. */
function clampToSourceDuration(nextEnd: number, sourceDuration: number | undefined): number {
  return sourceDuration !== undefined ? Math.min(sourceDuration, nextEnd) : nextEnd
}

/** Source window of a ramped clip after a start trim removed `removed` source frames. */
function rampedStartTrimWindow(
  item: TimelineItem,
  removed: number,
  span: number,
): Pick<TrimSourceUpdate, 'sourceStart' | 'sourceEnd'> {
  const { sourceStart, sourceEnd } = getSourceProperties(item)
  const sourceDuration = getEffectiveSourceDuration(item)
  if (item.isReversed === true) {
    const currentEnd = sourceEnd ?? sourceDuration ?? sourceStart + span
    const nextEnd = currentEnd - removed
    return {
      sourceStart: Math.max(0, nextEnd - span),
      sourceEnd: clampToSourceDuration(nextEnd, sourceDuration),
    }
  }
  const nextStart = Math.max(0, sourceStart + removed)
  return {
    sourceStart: nextStart,
    sourceEnd: clampToSourceDuration(nextStart + span, sourceDuration),
  }
}

/** Source window of a ramped clip after an end trim left it `span` source frames. */
function rampedEndTrimWindow(
  item: TimelineItem,
  span: number,
): Pick<TrimSourceUpdate, 'sourceStart' | 'sourceEnd'> {
  const { sourceStart, sourceEnd } = getSourceProperties(item)
  const sourceDuration = getEffectiveSourceDuration(item)
  if (item.isReversed === true) {
    const currentEnd = sourceEnd ?? sourceDuration ?? sourceStart + span
    return { sourceStart: Math.max(0, currentEnd - span) }
  }
  return { sourceEnd: clampToSourceDuration(sourceStart + span, sourceDuration) }
}

/** Source window and keys of a speed-ramped clip after a trim (the time map's integral). */
function calculateRampedTrimSourceUpdate(
  item: TimelineItem,
  keys: readonly SpeedRampKey[],
  handle: TrimHandle,
  clampedAmount: number,
  newDuration: number,
  timelineFps: number,
): TrimSourceUpdate {
  const nextKeys =
    handle === 'start'
      ? pruneSpeedRamp(shiftSpeedRamp(keys, -clampedAmount), newDuration)
      : pruneSpeedRamp(keys, newDuration)
  const next = { ...item, durationInFrames: newDuration, speedRamp: nextKeys }
  const span = Math.max(1, Math.round(sourceFramesAtLocalFrame(next, newDuration, timelineFps)))
  if (handle === 'start') {
    const removed = Math.round(sourceFramesAtLocalFrame(item, clampedAmount, timelineFps))
    return { ...rampedStartTrimWindow(item, removed, span), speedRamp: nextKeys }
  }
  return { ...rampedEndTrimWindow(item, span), speedRamp: nextKeys }
}

export function calculateTrimSourceUpdate(
  item: TimelineItem,
  handle: TrimHandle,
  clampedAmount: number,
  newDuration: number,
  timelineFps: number = 30,
): TrimSourceUpdate | null {
  if (!isMediaItem(item) || isHeldTemplateInstance(item)) return null

  const rampKeys = getSpeedRamp(item)
  if (rampKeys) {
    return calculateRampedTrimSourceUpdate(
      item,
      rampKeys,
      handle,
      clampedAmount,
      newDuration,
      timelineFps,
    )
  }

  const { sourceStart, sourceEnd, sourceFps, speed } = getSourceProperties(item)
  const sourceDuration = getEffectiveSourceDuration(item)
  const effectiveSourceFps = sourceFps ?? timelineFps

  if (handle === 'start') {
    const sourceFramesDelta = timelineToSourceFrames(
      clampedAmount,
      speed,
      timelineFps,
      effectiveSourceFps,
    )
    if (item.isReversed === true) {
      const currentSourceEnd = sourceEnd ?? sourceDuration ?? sourceStart + 1
      const nextSourceEnd = currentSourceEnd - sourceFramesDelta
      return {
        sourceEnd: Math.max(
          sourceStart + 1,
          sourceDuration !== undefined ? Math.min(sourceDuration, nextSourceEnd) : nextSourceEnd,
        ),
      }
    }
    return { sourceStart: sourceStart + sourceFramesDelta }
  } else {
    // Trimming end: update sourceEnd.
    // For clips with explicit sourceEnd, update by delta to avoid
    // cumulative one-frame loss from duration-based recomputation.
    const sourceFramesDelta = timelineToSourceFrames(
      clampedAmount,
      speed,
      timelineFps,
      effectiveSourceFps,
    )
    if (item.isReversed === true) {
      const currentSourceEnd = sourceEnd ?? sourceDuration ?? sourceStart + 1
      return {
        sourceStart: Math.min(currentSourceEnd - 1, Math.max(0, sourceStart - sourceFramesDelta)),
      }
    }
    const explicitSourceEnd = item.sourceEnd
    const recomputedSourceEnd =
      sourceStart + timelineToSourceFrames(newDuration, speed, timelineFps, effectiveSourceFps)
    const newSourceEnd =
      explicitSourceEnd !== undefined ? explicitSourceEnd + sourceFramesDelta : recomputedSourceEnd

    // Keep at least 1 source frame and clamp to media bounds.
    const minSourceEnd = sourceStart + 1
    const boundedByMin = Math.max(minSourceEnd, newSourceEnd)
    const clampedSourceEnd =
      sourceDuration !== undefined ? Math.min(boundedByMin, sourceDuration) : boundedByMin
    return {
      sourceEnd: clampedSourceEnd,
    }
  }
}
