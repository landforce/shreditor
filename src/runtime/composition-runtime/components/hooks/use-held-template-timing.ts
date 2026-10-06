/**
 * Motion template instances with a hold, in the preview's DOM tree: the
 * composition's items are laid out over the template's own length and the clock
 * frame their Sequences read is remapped (in, hold, out) through the same
 * helper the canvas renderers use (shared/motion-templates/instance-time).
 */
import { useMemo } from 'react'
import {
  useSequenceContext,
  useSequenceFrameRemap,
  type SequenceFrameRemap,
} from '@/runtime/composition-runtime/deps/player'
import { resolveHeldInstanceFrame } from '@/shared/motion-templates/instance-time'
import type { TimelineItem } from '@/types/timeline'

interface HeldComposition {
  fps: number
  durationInFrames: number
}

/** The window a held instance's items are laid out in: the whole template, 1x. */
export function heldTemplateWindow(
  item: Pick<TimelineItem, 'templateHold'>,
  subComp: HeldComposition | undefined,
  parentFps: number,
) {
  if (!item.templateHold || !subComp) return null
  return {
    durationInFrames: Math.ceil((subComp.durationInFrames * parentFps) / subComp.fps),
    speed: 1,
    sourceFps: subComp.fps,
    sourceStart: 0,
  }
}

/**
 * The frame remap a held instance's subtree uses (composed with any outer one),
 * or the outer remap unchanged when the instance has no hold.
 */
export function useHeldTemplateFrameRemap(
  item: Pick<TimelineItem, 'templateHold' | 'durationInFrames' | 'sourceDuration'>,
  subComp: HeldComposition | undefined,
  parentFps: number,
  frameOffset: number,
): SequenceFrameRemap | null {
  const outer = useSequenceFrameRemap()
  const start = (useSequenceContext()?.from ?? 0) + frameOffset
  const { templateHold, durationInFrames, sourceDuration } = item
  const fps = subComp?.fps
  const length = subComp?.durationInFrames
  return useMemo(() => {
    if (!templateHold || !fps || !length) return outer
    const timing = { templateHold, durationInFrames, sourceDuration }
    const own = (frame: number) => {
      const held = resolveHeldInstanceFrame(timing, frame - start, parentFps, fps, length)
      return held === null ? frame : start + (held * parentFps) / fps
    }
    return outer ? (frame: number) => own(outer(frame)) : own
  }, [durationInFrames, fps, length, outer, parentFps, sourceDuration, start, templateHold])
}
