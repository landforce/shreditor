// Types for ./validate.mjs.
import type { FormatRole, ResolvedFormat } from '../registry.mjs'
import type { Plan, PlanBeat, PlanIssue } from './schema.mjs'

export interface PlanMedia {
  /** null when the file is only catalogued, not imported. */
  mediaId: string | null
  fileName: string
  kind: 'video' | 'image' | 'audio'
  /** Seconds. */
  duration: number
  sourceFps: number
  audioCodec: string | null
  category: string | null
  /** Pixels, when known. */
  width?: number
  height?: number
}

type Issues = import('./shape.mjs').IssueList
interface Entry {
  id: string
  role?: string | null
}
interface Span {
  id: string
  start: number
  end: number
}

export interface ResolvedBeat extends PlanBeat {
  media: PlanMedia | null
  trackRole: FormatRole | null
}

export function beatTrackRole(
  beat: Pick<PlanBeat, 'track'>,
  media: Pick<PlanMedia, 'kind' | 'category'>,
  format: ResolvedFormat,
): FormatRole | null
export function validatePlan(
  plan: Plan,
  options: {
    format: ResolvedFormat
    resolveMedia: (source: PlanBeat['source']) => PlanMedia | { error: string }
    briefTargetSec?: number | null
  },
): { beats: ResolvedBeat[]; errors: PlanIssue[]; warnings: PlanIssue[] }
export function checkRoleNames(
  plan: Pick<Plan, 'story'>,
  entries: Entry[],
  format: ResolvedFormat,
  issues: Issues,
): void
export function checkRequiredParts(
  entries: Entry[],
  format: ResolvedFormat,
  issues: Issues,
  noun: string,
): void
export function checkStoryOrder(ordered: Entry[], format: ResolvedFormat, issues: Issues): void
export function checkPlanMode(
  plan: Pick<Plan, 'mode'>,
  format: ResolvedFormat,
  issues: Issues,
): void
export function checkOverlaps(groups: Map<string, Span[]>, fps: number, issues: Issues): void
export function groupBy<T, K>(entries: T[], key: (entry: T) => K): Map<K, T[]>
