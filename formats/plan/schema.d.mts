// Types for ./schema.mjs.
import type { StructureRole } from '../registry.mjs'
import type { Performance } from './performance/read.mjs'
import type { PlanIssue } from './shape.mjs'

export type { PlanIssue }

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

export type PlanMode = 'story' | 'performance'

export interface Plan {
  version: 1 | 2 | 3
  /** v1 and v2 are story plans. */
  mode: PlanMode
  fps: number
  durationFrames: number
  request: string
  story: { arc: string; structure: string[] }
  sources: unknown[]
  /** A story plan's beats (empty in performance mode). */
  beats: PlanBeat[]
  /** A performance plan's lines (null in story mode, or when unreadable). */
  performance: Performance | null
}

export function readPlan(
  raw: unknown,
  options?: { projectFps?: number; defaultMode?: PlanMode },
): { plan: Plan | null; errors: PlanIssue[]; warnings: PlanIssue[] }
