// Types for ./build.mjs.
import type { ResolvedFormat } from '../registry.mjs'
import type { Plan } from './schema.mjs'
import type { ResolvedBeat } from './validate.mjs'

export interface PlacedBeat {
  beat: ResolvedBeat
  track?: string
  trackAdded?: boolean
  syncSound?: 'kept' | 'removed' | null
  text?: {
    role: string
    text: string
    start: number
    end: number
    track: string
    style: string | null
  }
}

export function buildPlanOps(
  plan: Plan,
  beats: ResolvedBeat[],
  options: { project: unknown; format: ResolvedFormat; replace?: boolean; markersOnly?: boolean },
): { ops: Array<Record<string, unknown> & { op: string }>; placed: PlacedBeat[] }
