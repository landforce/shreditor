// Types for ./scaffold.mjs.
import type { ResolvedFormat } from '../../registry.mjs'
import type { TranscriptWord } from './words.mjs'

export function isFiller(text: string): boolean
export function isRetake(a: string, b: string): boolean
export function scaffoldPerformance(
  speakers: Array<{ mediaId: string; duration: number; words: TranscriptWord[] }>,
  options: { format: ResolvedFormat; fps: number; padFrames?: number; pauseSec: number },
): {
  /** Plan JSON (schema v3, mode performance), ready to write. */
  plan: Record<string, any>
  counts: { lines: number; kept: number; retakes: number; falseStarts: number; pauses: number }
}
