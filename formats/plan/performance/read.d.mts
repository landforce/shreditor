// Types for ./read.mjs.
import type { IssueList } from '../shape.mjs'

export type CutReason =
  | 'flub'
  | 'retake'
  | 'pause'
  | 'tangent'
  | 'false start'
  | 'dead air'
  | 'other'
export type VisualRole = 'images' | 'plates' | 'broll' | 'labels'

/** A point in a line: seconds after its source in, a phrase it says, a word index, or (until) a kept line's end. */
export type LinePoint = { sec: number } | { phrase: string } | { word: number } | { line: string }

export interface LineVisual {
  track: string | null
  asset: string | null
  toSource: string | null
  at: LinePoint | undefined
  until: LinePoint | undefined
  /** Seconds into a video asset. */
  in: number
  fit: 'contain' | 'cover' | Record<string, number> | null
  note: string
}

export interface LineOnScreen {
  text: string
  /** null: title on the opening hook line, labels elsewhere. */
  role: 'title' | 'labels' | null
  at: LinePoint | undefined
  until: LinePoint | undefined
  style?: string
}

export interface PerformanceLine {
  id: string
  /** Position in the plan's lines. */
  index: number
  source: { mediaId: string; inSec: number; outSec: number }
  text: string
  keep: boolean
  reason: CutReason | null
  takeOf: string | null
  role: string | null
  visuals: LineVisual[]
  onScreen: LineOnScreen | null
  takeaway: string
  why: string
}

export interface Performance {
  speaker: string[]
  padFrames: number
  lines: PerformanceLine[]
}

export const VISUAL_ROLES: readonly VisualRole[]
export function readPerformance(raw: unknown, fps: number, issues: IssueList): Performance | null
