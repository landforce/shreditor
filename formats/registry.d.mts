// Types for ./registry.mjs (the editor imports it as '@formats/registry.mjs').

export type FormatId = 'graphic-yap' | 'greenscreen' | 'vlog' | 'ten-shot'

export type FormatRole =
  | 'speaker'
  | 'images'
  | 'plates'
  | 'broll'
  | 'shots'
  | 'title'
  | 'captions'
  | 'labels'
  | 'voice'
  | 'music'
  | 'sfx'

/** Stored on a project: which format defines it. */
export interface ProjectFormat {
  id: FormatId
  variant?: string
  /** Guide hash the format's targets were reviewed against when it was set. */
  reviewedHash?: string
}

export type Presence = 'required' | 'default' | 'optional' | 'none'

export interface FormatTarget {
  key: string
  label: string
  unit: string
  min: number | null
  max: number | null
  ideal: number | null
  severity: 'fail' | 'warn'
  /** 'kit': replaced by the project's Video Style Kit (its preferences). */
  source: 'measured' | 'vdb' | 'colin' | 'kit'
  /** Range seen in the VDB sample. */
  seen?: [number, number]
  /** Metric to measure when it differs from key. */
  metric?: string
  note?: string
}

export interface FormatRules {
  titleHook: {
    required: boolean
    fromSec: number
    holdSec: { min: number | null; max: number | null }
    /** Holding the title for the whole video also passes. */
    allowFullHold: boolean
  }
  captions: Presence
  speech: 'required' | 'none'
  voiceover: Presence
  music: Presence
  sfx: Presence
  /** Audible sound from b-roll/shots/images/plates clips. */
  syncSound: 'allowed' | 'none'
  transitions: 'none'
}

export interface FormatTrackSpec {
  name: string
  kind: 'video' | 'audio'
  role: FormatRole
}

/** A story role a plan's beat plays (`shred plan`), shared across formats. */
export type StructureRole = 'hook' | 'setup' | 'body' | 'payoff' | 'close'

/** One section of the guide's Structure, in story order. */
export interface FormatStructurePart {
  role: StructureRole
  /** The guide's word for it (a vlog's close is its "End"). */
  name: string
  /** false: the guide makes it optional. */
  required: boolean
  note: string
}

export interface FormatVariant {
  id: string
  name: string
  description: string
  overrides: {
    targets?: Record<string, Partial<FormatTarget> | null>
    rules?: Partial<FormatRules>
    checklist?: string[]
  }
}

export interface FormatGuide {
  /** Vendored guide, relative to the repo root. */
  path: string
  research: string
  /** Paths in the ai-video-editor plugin. */
  source: string
  researchSource: string
  reviewedHash: string
}

export interface FormatDefinition {
  id: FormatId
  name: string
  tagline: string
  description: string
  /** One line from the decision guide: when this format fits the footage. */
  useWhen: string
  guide: FormatGuide
  canvas: { width: number; height: number; fps: number }
  defaultVariant: string | null
  variants: readonly FormatVariant[]
  /** The guide's Structure: the story roles a plan's beats use, in order. */
  structure: readonly FormatStructurePart[]
  /**
   * What the plan lays out: 'performance' (a speaker's lines, kept or cut, with
   * visuals per line) for the speaker formats, 'story' (beats) for the others.
   */
  planMode: 'story' | 'performance'
  /** Tracks top to bottom. */
  tracks: readonly FormatTrackSpec[]
  /** Media category -> role in this format. */
  categoryRoles: Readonly<Record<string, FormatRole>>
  /** Fallback roles by item type. */
  defaultRoles: { video: FormatRole; image: FormatRole; audio: FormatRole }
  rules: FormatRules
  targets: readonly FormatTarget[]
  checklist: readonly string[]
}

export interface ResolvedFormat extends Omit<FormatDefinition, 'targets' | 'checklist'> {
  variant: { id: string; name: string; description: string } | null
  targets: FormatTarget[]
  checklist: string[]
}

/** A timeline track as createFormatTracks builds it (TimelineTrack-compatible). */
export interface FormatTrack {
  id: string
  name: string
  kind: 'video' | 'audio'
  formatRole: FormatRole
  height: number
  locked: boolean
  syncLock: boolean
  visible: boolean
  muted: boolean
  solo: boolean
  volume: number
  order: number
  items: never[]
}

export const FORMAT_ROLES: readonly FormatRole[]
export const STRUCTURE_ROLES: readonly StructureRole[]
export const FORMATS: readonly FormatDefinition[]
export const FORMAT_IDS: readonly FormatId[]
export const CHOOSING_GUIDE: { path: string; source: string; reviewedHash: string }

export function getFormat(id: unknown): FormatDefinition | undefined
export function resolveFormat(id: string | { id: string }, variant?: string | null): ResolvedFormat
export function projectFormat(
  project: { format?: ProjectFormat } | null | undefined,
): ResolvedFormat | null
export function projectFormatRecord(id: string, variant?: string | null): ProjectFormat
export function createFormatTracks(
  format: string | FormatDefinition | ResolvedFormat,
  options?: { height?: number; idFor?: (entry: FormatTrackSpec, index: number) => string },
): FormatTrack[]
