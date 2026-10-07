// Types for ./compare.mjs.
import type { FrameRange } from '../scorecard.mjs'
import type { Plan } from './schema.mjs'
import type { ResolvedBeat } from './validate.mjs'

export interface PlanFinding {
  level: 'warn' | 'info'
  message: string
  ranges: FrameRange[]
}

export function comparePlan(
  plan: Plan,
  beats: ResolvedBeat[],
  timeline:
    | { items?: Array<{ mediaId?: string; type: string; from: number; durationInFrames: number }> }
    | undefined,
): { findings: PlanFinding[]; checked: number; skipped: number }
export const range: (startFrame: number, endFrame: number) => FrameRange
export const describe: (r: FrameRange, fps: number) => string
export function lengthFinding(
  plan: Pick<Plan, 'fps' | 'durationFrames'>,
  end: number,
): PlanFinding | null
