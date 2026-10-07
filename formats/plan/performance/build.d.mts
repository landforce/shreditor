// Types for ./build.mjs.
import type { ResolvedFormat } from '../../registry.mjs'
import type { Plan } from '../schema.mjs'
import type { PlacedBeat } from '../build.mjs'
import type { ResolvedLine, SpeakerRun } from './layout.mjs'
import type { PerformanceCut, PlacedVisual } from './validate.mjs'

export function firstWords(text: string, count?: number): string
export function buildPerformanceOps(
  plan: Plan,
  layout: PerformanceCut,
  lines: ResolvedLine[],
  options: { project: unknown; format: ResolvedFormat; replace?: boolean; markersOnly?: boolean },
): {
  ops: Array<Record<string, unknown> & { op: string }>
  placed: {
    runs: Array<{
      run: SpeakerRun
      track: string
      trackAdded: boolean
      syncSound: PlacedBeat['syncSound']
    }>
    visuals: Array<{ visual: PlacedVisual; track: string; trackAdded: boolean }>
    texts: Array<NonNullable<PlacedBeat['text']>>
    toSource: PlacedVisual[]
  }
}
