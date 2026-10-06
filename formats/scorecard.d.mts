// Types for ./scorecard.mjs (the editor imports it as '@formats/scorecard.mjs').
import type { FormatRole, FormatTarget, ResolvedFormat } from './registry.mjs'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'na'

export interface FrameRange {
  startFrame: number
  /** Exclusive. */
  endFrame: number
}

export interface ScorecardCheck {
  key: string
  label: string
  status: CheckStatus
  value: number | boolean | null
  /** Human-readable target, e.g. "40-80 s", "<= 2 s", "required". */
  target: string
  detail: string
  /** Where to look: set on warn/fail checks. */
  ranges: FrameRange[]
  /** Numeric targets only. */
  severity?: FormatTarget['severity']
  source?: FormatTarget['source']
}

export interface Scorecard {
  format: string
  variant: string | null
  durationSec: number
  checks: ScorecardCheck[]
  summary: { pass: number; warn: number; fail: number }
}

/** Transcript as stored (envelope with data.segments) or plain { segments } / { words }. */
export type ScorecardTranscript =
  | { data: { segments?: unknown[]; words?: unknown[] } }
  | { segments?: unknown[]; words?: unknown[] }

type Lookup<T> = Record<string, T> | Map<string, T>

export interface ScoreOptions {
  /** Media metadata by id: category, audioCodec and fps are read. */
  mediaById?: Lookup<{ category?: string; audioCodec?: string; fps?: number } | undefined>
  /** Transcripts by media id, word times in source seconds. */
  transcripts?: Lookup<ScorecardTranscript | undefined>
  /** Format id or resolved format; defaults to project.format. */
  format?: string | ResolvedFormat
  variant?: string | null
  /** Targets patched by key, e.g. a creator kit's pause limit: { pauseMaxSec: { max: 0.3 } }. */
  targetOverrides?: Record<string, Partial<FormatTarget>>
}

interface ScorableProject {
  metadata?: { fps?: number; height?: number }
  format?: { id: string; variant?: string }
  timeline?: { tracks: unknown[]; items: unknown[]; transitions?: unknown[] }
}

export function scoreProject(project: ScorableProject, options?: ScoreOptions): Scorecard

export function resolveItemRoles(
  project: ScorableProject,
  options?: Pick<ScoreOptions, 'mediaById' | 'format' | 'variant'>,
): Map<
  string,
  { role: FormatRole; source: 'formatRole' | 'textRole' | 'category' | 'track' | 'heuristic' }
>

export function trackRole(
  track: { name?: string; kind?: string; formatRole?: string } | undefined,
  format: ResolvedFormat | undefined,
): FormatRole | null

export function mapClipWords(
  item: {
    from: number
    durationInFrames: number
    sourceStart?: number
    sourceEnd?: number
    sourceFps?: number
    speed?: number
  },
  transcript: ScorecardTranscript,
  options: { fps: number; mediaFps?: number },
): Array<{ start: number; end: number; text: string }>

export function describeTarget(target: Pick<FormatTarget, 'min' | 'max' | 'ideal' | 'unit'>): string
