// Types for ./validate.mjs.
import type { ResolvedFormat } from '../../registry.mjs'
import type { Plan, PlanIssue } from '../schema.mjs'
import type { PlanBeat } from '../schema.mjs'
import type { PlanMedia } from '../validate.mjs'
import type { PerformanceLayout, ResolvedLine } from './layout.mjs'
import type { LineVisual, VisualRole } from './read.mjs'
import type { TranscriptWord } from './words.mjs'

export interface PlacedVisual {
  /** `<line id>-v<n>`. */
  id: string
  lineId: string
  visual: LineVisual
  /** null: still to source. */
  media: PlanMedia | null
  trackRole: VisualRole
  toSource: string | null
  start: number
  end: number
}

export interface PlacedText {
  id: string
  lineId: string
  text: string
  role: 'title' | 'labels'
  start: number
  end: number
  style?: string
}

export interface PerformanceCut extends PerformanceLayout {
  visuals: PlacedVisual[]
  texts: PlacedText[]
}

export function validatePerformance(
  plan: Plan,
  options: {
    format: ResolvedFormat
    resolveMedia: (source: PlanBeat['source']) => PlanMedia | { error: string }
    wordsFor: (mediaId: string) => TranscriptWord[] | null
    briefTargetSec?: number | null
  },
): { lines: ResolvedLine[]; layout: PerformanceCut; errors: PlanIssue[]; warnings: PlanIssue[] }
