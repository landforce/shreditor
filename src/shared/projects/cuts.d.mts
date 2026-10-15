// Types for ./cuts.mjs (shared by the editor and the agent tools).

export interface ProjectCutRecord {
  group: string
  label: string
  order?: number
}

interface CutMember {
  id: string
  name?: string
  createdAt?: number
  cut?: ProjectCutRecord
}

interface Canvas {
  width: number
  height: number
}

export const MAIN_CUT_LABEL: string
export const CUT_LABEL_MAX: number
export const CUT_ASPECT_PRESETS: readonly string[]

export function cutGroupOf(project: CutMember | null | undefined): string | undefined
export function isMainCut(project: CutMember | null | undefined): boolean
export function cutLabelOf(project: CutMember | null | undefined): string
export function cutLabelError(label: unknown): string | null
export function cutsInGroup<T extends CutMember>(projects: readonly T[], groupId: string): T[]
export function nextCutOrder(cuts: readonly CutMember[]): number
export function cutProjectName(groupName: string, label: string): string
export function cutGroupName(
  main: { name?: string } | null | undefined,
  source: CutMember | null | undefined,
): string
export function cutCanvasForAspect(aspect: string, source: Canvas): Canvas
export function parseCanvasSize(text: string): Canvas
export function coverTransform(
  box: { x: number; y: number; width: number; height: number },
  from: Canvas,
  to: Canvas,
): { x: number; y: number; width: number; height: number }

export type CutReviewReason = 'reanchored' | 'keyframed' | 'framing' | 'template' | 'compound'

export interface RefitTimelineResult<T> {
  timeline: T
  covered: string[]
  review: Array<{ id: string; name: string; reason: CutReviewReason }>
}

export function refitTimeline<T extends { items?: unknown[] }>(
  timeline: T,
  from: Canvas,
  to: Canvas,
  options?: { mediaSize?: (mediaId: string) => Canvas | null | undefined },
): RefitTimelineResult<T>

export function textStylesForAspect(
  timeline: { items?: unknown[]; textStyles?: unknown[] },
  toAspect: string,
  fromAspect: string,
): Array<{ styleId: string; name: string; itemIds: string[]; ready: boolean }>

export function portableTextOverrides(item: { textStyleOverrides?: readonly string[] }): string[]

export function cutCreatedPassRecord(options: {
  label: string
  fromLabel: string
  fromId: string
  revision: string | null
  timeline: unknown
  by?: 'agent' | 'user'
  scorecard?: unknown
  now?: Date
}): Record<string, unknown>

export function projectAspect(project: { metadata?: Partial<Canvas> }): string
