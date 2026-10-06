// Types for ./schema.mjs.
import type { StructureRole } from '../registry.mjs'

export interface PlanIssue {
  /** A beat id, or 'plan'. */
  where: string
  message: string
}

export interface PlanText {
  text: string
  role: 'title' | 'labels'
  start: number
  /** Exclusive. */
  end: number
  style?: string
}

export interface PlanBeat {
  id: string
  role: StructureRole | string | null
  start: number
  /** Exclusive. */
  end: number
  source: { mediaId?: string; asset?: string; inSec: number }
  takeaway: string
  why: string
  treatment: string
  sound: string
  track: string | null
  gapBefore: boolean
  text: PlanText | null
}

export interface Plan {
  version: 1 | 2
  fps: number
  durationFrames: number
  request: string
  story: { arc: string; structure: string[] }
  sources: unknown[]
  beats: PlanBeat[]
}

export function issueList(): {
  errors: PlanIssue[]
  warnings: PlanIssue[]
  error(where: string, message: string): void
  warn(where: string, message: string): void
}
export function readPlan(
  raw: unknown,
  options?: { projectFps?: number },
): { plan: Plan | null; errors: PlanIssue[]; warnings: PlanIssue[] }
