// Types for ./estimate.mjs.
import type { ResolvedFormat } from '../registry.mjs'
import type { ScorecardCheck, ScoreOptions } from '../scorecard.mjs'
import type { Plan } from './schema.mjs'
import type { ResolvedBeat } from './validate.mjs'

export function planEstimates(
  plan: Plan,
  beats: ResolvedBeat[],
  format: ResolvedFormat,
  options?: Pick<ScoreOptions, 'transcripts'>,
): ScorecardCheck[]
