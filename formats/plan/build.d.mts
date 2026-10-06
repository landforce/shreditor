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

type Op = Record<string, unknown> & { op: string }
interface FoundTrack {
  id: string | { $ref: string }
  name: string
  added?: boolean
}
export const markerId: (id: string) => string
export const markerText: (label: string) => string
export function trackFinder(
  project: unknown,
  format: ResolvedFormat,
  ops: Op[],
): (role: string, kind: 'video' | 'audio') => FoundTrack
export function styleFinder(
  project: unknown,
): (text: { role: 'title' | 'labels'; style?: string }) => string | undefined
export function clipOps(
  beat: Pick<ResolvedBeat, 'start' | 'end' | 'media'> & { source: { inSec: number } },
  callerId: string,
  track: FoundTrack,
  options: { fps: number; dropSyncSound: boolean },
): { ops: Op[]; syncSound: 'kept' | 'removed' | null }
export function textOps(
  text: { text: string; role: 'title' | 'labels'; start: number; end: number; style?: string },
  callerId: string,
  findTrack: ReturnType<typeof trackFinder>,
  styleFor: ReturnType<typeof styleFinder>,
): { ops: Op[]; placed: NonNullable<PlacedBeat['text']> }
export function clearingOps(
  project: unknown,
  options: { replace?: boolean; markersOnly?: boolean },
): Op[]
