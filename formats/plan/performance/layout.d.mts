// Types for ./layout.mjs.
import type { Plan } from '../schema.mjs'
import type { PlanMedia } from '../validate.mjs'
import type { LinePoint, PerformanceLine } from './read.mjs'
import type { TranscriptWord } from './words.mjs'

/** A line with its media (null when it could not be resolved) and transcript words. */
export interface ResolvedLine extends PerformanceLine {
  media: PlanMedia | null
  words: TranscriptWord[] | null
}

export interface SpeakerRun {
  id: string
  mediaId: string
  media: PlanMedia
  /** The clip's source window, seconds. */
  inSec: number
  outSec: number
  /** Timeline frames, end exclusive. */
  start: number
  end: number
  /** Kept line ids, in order. */
  lines: string[]
}

export interface LineSpan {
  start: number
  /** Exclusive. */
  end: number
  /** The frame the line's source in-point plays at. */
  speechStart: number
  run: string
}

export interface PerformanceLayout {
  runs: SpeakerRun[]
  spans: Map<string, LineSpan>
  durationFrames: number
}

export function pointFrame(
  point: LinePoint | undefined,
  edge: 'at' | 'until',
  context: {
    line: PerformanceLine
    span: LineSpan
    words: TranscriptWord[] | null
    fps: number
    spans: Map<string, LineSpan>
  },
): { frame: number; error?: undefined } | { error: string; frame?: undefined }
export function layoutPerformance(plan: Plan, lines: ResolvedLine[]): PerformanceLayout
