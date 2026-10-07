// Types for ./estimate.mjs.
import type { ResolvedFormat } from '../../registry.mjs'
import type { ScorecardCheck, ScoreOptions } from '../../scorecard.mjs'
import type { Plan } from '../schema.mjs'
import type { PerformanceCut } from './validate.mjs'

export function performanceEstimates(
  plan: Plan,
  layout: PerformanceCut,
  format: ResolvedFormat,
  options?: Pick<ScoreOptions, 'transcripts'>,
): ScorecardCheck[]
