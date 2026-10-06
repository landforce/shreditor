// Types for ./compare.mjs.
import type { Plan } from '../schema.mjs'
import type { PlanFinding } from '../compare.mjs'
import type { ResolvedLine } from './layout.mjs'
import type { PerformanceLayout } from './layout.mjs'

export function comparePerformance(
  plan: Plan,
  lines: ResolvedLine[],
  layout: PerformanceLayout,
  timeline:
    | {
        items?: Array<{
          mediaId?: string
          type: string
          from: number
          durationInFrames: number
          sourceStart?: number
          sourceEnd?: number
          sourceFps?: number
          speed?: number
        }>
      }
    | undefined,
): { findings: PlanFinding[]; checked: number; skipped: number }
