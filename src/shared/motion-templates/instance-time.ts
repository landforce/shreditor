/**
 * Template instance time: which template frame a held instance shows.
 *
 * A motion template variant can name a hold frame (or an inclusive hold range).
 * An instance LONGER than its template plays the in-animation (the frames before
 * the hold), freezes on the hold for the extra time, then plays the
 * out-animation (the frames after it), so it ends exactly at the instance's end.
 * A SHORTER instance gives up hold frames first: the in- and out-animations both
 * play down to their combined length; below that the end is cut.
 *
 * Every renderer (preview DOM tree, canvas/GPU export, the native exporter's
 * overlay route and the headless frame renderer) maps instance time through
 * resolveHeldInstanceFrame, so all instances keep sharing one composition and the
 * mapping is per instance (its own duration), never a copy per length.
 */

/** Template frames: `start`..`end` inclusive. */
export interface TemplateHold {
  start: number
  end: number
}

/**
 * The template frame shown `t` frames into an instance `instanceFrames` long, of a
 * template `templateFrames` long holding on `hold` (all in template frames).
 */
export function heldTemplateFrame(
  t: number,
  instanceFrames: number,
  templateFrames: number,
  hold: TemplateHold,
): number {
  const inFrames = hold.start
  const outFrames = Math.max(0, templateFrames - 1 - hold.end)
  const holdFrames = Math.max(0, instanceFrames - inFrames - outFrames)
  if (t < inFrames) return t
  if (t < inFrames + holdFrames) return Math.min(hold.start + (t - inFrames), hold.end)
  return hold.end + 1 + (t - inFrames - holdFrames)
}

export interface HeldInstanceTiming {
  templateHold?: TemplateHold
  durationInFrames: number
  sourceDuration?: number
}

/**
 * The composition frame a held template instance shows `relativeFrame` parent
 * frames after its start, or null when the instance has no hold (the caller's
 * usual sourceStart/speed mapping applies). `templateFrames` is the composition's
 * length (defaults to the instance's sourceDuration).
 */
export function resolveHeldInstanceFrame(
  item: HeldInstanceTiming,
  relativeFrame: number,
  parentFps: number,
  compositionFps: number,
  templateFrames: number | undefined = item.sourceDuration,
): number | null {
  const hold = item.templateHold
  if (!hold || !templateFrames || !(parentFps > 0) || !(compositionFps > 0)) return null
  const toComposition = compositionFps / parentFps
  return heldTemplateFrame(
    Math.max(0, relativeFrame) * toComposition,
    item.durationInFrames * toComposition,
    templateFrames,
    hold,
  )
}

/** True for an instance whose length is free (a hold maps any length onto the template). */
export function isHeldTemplateInstance(item: { templateHold?: TemplateHold }): boolean {
  return Boolean(item.templateHold)
}
