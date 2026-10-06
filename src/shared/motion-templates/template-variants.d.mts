// Types for ./template-variants.mjs (shared by the editor and the agent tools).
import type { MotionTemplate, StoredComposition } from './template-core.mjs'

export function axisAnchor(
  offset: number,
  size: number,
  frameSize: number,
): 'start' | 'centre' | 'end'
export function adaptCompositionToCanvas(
  composition: StoredComposition,
  to: { width: number; height: number },
): StoredComposition
export function cloneSourceAspect(
  template: MotionTemplate,
  aspect: string,
  from?: string,
): string | null
export function cloneTemplateVariant(
  template: MotionTemplate,
  options: {
    aspect: string
    canvas: { width: number; height: number }
    from?: string
    now?: number
  },
): { template: MotionTemplate; from: string }
