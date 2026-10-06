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
