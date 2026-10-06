// Types for ./template-core.mjs (shared by the editor and the agent tools).
import type { FormatRole } from '../../../formats/registry.mjs'
import type {
  CompositionControlDefinition,
  CompositionControlProperty,
} from '../../types/composition-controls'
import type { ProjectTimeline } from '../../types/project'
import type { TimelineItem } from '../../types/timeline'

export type MotionTemplateCategory =
  | 'lower-third'
  | 'title'
  | 'callout'
  | 'transition'
  | 'overlay'
  | 'other'

/** A composition as a project stores it (`timeline.compositions[]`). */
export type StoredComposition = NonNullable<ProjectTimeline['compositions']>[number]

export interface MotionTemplateMediaRef {
  mediaId: string
  fileName: string
}

/** `<workspace>/app/templates/<id>/template.json` */
export interface MotionTemplate {
  formatVersion: 1
  id: string
  name: string
  category: MotionTemplateCategory
  /** The format role an instance fills (title, labels, ...). */
  role?: FormatRole
  /** Bumped on every save of the same template. */
  version: number
  createdAt: number
  updatedAt: number
  width: number
  height: number
  fps: number
  durationInFrames: number
  /** The template's root composition (a layer composition with published controls). */
  composition: StoredComposition
  /** Compositions the root nests (compound clips inside it). */
  subCompositions: StoredComposition[]
  /** The root's published controls (what an instance can change), by name. */
  controls: CompositionControlDefinition[]
  /** Workspace media the compositions use. */
  media: MotionTemplateMediaRef[]
}

export interface MotionTemplateControlInput {
  id?: string
  name: string
  targetItemId: string
  property: CompositionControlProperty
  defaultValue?: string
}

export const MOTION_TEMPLATE_CATEGORIES: readonly MotionTemplateCategory[]
export const MOTION_TEMPLATES_DIR: string[]
export const MOTION_TEMPLATE_FILE: string
export const MOTION_TEMPLATE_THUMBNAIL: string

export function compositionClosure<T extends { id: string; items: readonly unknown[] }>(
  rootId: string,
  compositions: readonly T[],
): T[]
export function resolveTemplateControls(
  composition: { items: readonly TimelineItem[] },
  requested: readonly MotionTemplateControlInput[] | undefined,
  newId: () => string,
): CompositionControlDefinition[]
export function buildMotionTemplate(input: {
  rootCompositionId: string
  compositions: readonly StoredComposition[]
  name: string
  category?: MotionTemplateCategory
  role?: FormatRole
  controls?: readonly MotionTemplateControlInput[]
  previous?: Pick<MotionTemplate, 'id' | 'version' | 'createdAt'> | null
  mediaFileName?: (mediaId: string) => string
  now?: number
  newId?: () => string
}): MotionTemplate
export function parseMotionTemplate(value: unknown): MotionTemplate
export function findMotionTemplate<T extends Pick<MotionTemplate, 'id' | 'name'>>(
  templates: readonly T[],
  ref: string,
): T | null
