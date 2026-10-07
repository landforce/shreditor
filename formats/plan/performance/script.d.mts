// Types for ./script.mjs.
import type { Plan } from '../schema.mjs'
import type { ResolvedLine } from './layout.mjs'
import type { PerformanceCut } from './validate.mjs'

export function performanceScript(
  plan: Plan,
  lines: Array<ResolvedLine>,
  layout: PerformanceCut,
): string[]
export function toSourceList(lines: ResolvedLine[], layout: PerformanceCut, fps: number): string[]
