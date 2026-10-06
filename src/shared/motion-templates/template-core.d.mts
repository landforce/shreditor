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

/** The frame (or inclusive range) an instance longer than its template freezes on. */
export interface MotionTemplateHold {
  start: number
  end: number
}

/** One aspect ratio's version of a template. */
export interface MotionTemplateVariant {
  /** "9:16", "16:9", ... (the key it is stored under). */
  aspect: string
  /** The template version this variant was last saved in. */
  version: number
  updatedAt: number
  width: number
  height: number
  fps: number
  durationInFrames: number
  hold?: MotionTemplateHold
  /** The variant's root composition (a layer composition with published controls). */
  composition: StoredComposition
  /** Compositions the root nests (compound clips inside it). */
  subCompositions: StoredComposition[]
  /** The root's published controls (ids and targets are this variant's own). */
  controls: CompositionControlDefinition[]
  /** Workspace media the variant's compositions use. */
  media: MotionTemplateMediaRef[]
  /** Thumbnail file name in the template folder. */
  thumbnail?: string
}

/** A control as every variant shares it: by name. */
export interface MotionTemplateControlSummary {
  name: string
  kind: 'text' | 'color'
  property: CompositionControlProperty
  defaultValue: string
}

/** `<workspace>/app/templates/<id>/template.json`: a family of aspect ratio variants. */
export interface MotionTemplate {
  formatVersion: 2
  id: string
  name: string
  category: MotionTemplateCategory
  /** The format role an instance fills (title, labels, ...). */
  role?: FormatRole
  /** Bumped on every save of any variant. */
  version: number
  createdAt: number
  updatedAt: number
  variants: Record<string, MotionTemplateVariant>
  /** Control names across the variants (what an instance can change). */
  controls: MotionTemplateControlSummary[]
  /** Workspace media any variant uses. */
  media: MotionTemplateMediaRef[]
}

/** One variant as an insertable template (`version` is the variant's). */
export interface MotionTemplateVariantView extends MotionTemplateVariant {
  id: string
  name: string
  category: MotionTemplateCategory
  role?: FormatRole
  /** The family's version. */
  templateVersion: number
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
export function variantThumbnailFile(aspect: string): string

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
  /** undefined keeps the variant's current hold; null clears it. */
  hold?: MotionTemplateHold | null
  previous?:
    | (Pick<MotionTemplate, 'id' | 'version' | 'createdAt'> &
        Partial<Pick<MotionTemplate, 'variants'>>)
    | null
  mediaFileName?: (mediaId: string) => string
  now?: number
  newId?: () => string
}): MotionTemplate
export function withTemplateVariant(
  template: MotionTemplate,
  variant: MotionTemplateVariant,
  now?: number,
): MotionTemplate
export function templateHoldProblem(
  hold: MotionTemplateHold | null | undefined,
  durationInFrames: number,
): string | null
export function parseTemplateHold(text: string): MotionTemplateHold | null
export function formatTemplateHold(hold: MotionTemplateHold | null | undefined): string
export function templateAspects(template: Pick<MotionTemplate, 'variants'>): string[]
export function templateVariant(
  template: MotionTemplate,
  aspect: string,
): MotionTemplateVariantView | null
export function missingVariantMessage(template: MotionTemplate, aspect: string): string
export function chooseTemplateVariant(
  template: MotionTemplate,
  canvas: { width: number; height: number },
): MotionTemplateVariantView
export function parseMotionTemplate(value: unknown): MotionTemplate
export function findMotionTemplate<T extends Pick<MotionTemplate, 'id' | 'name'>>(
  templates: readonly T[],
  ref: string,
): T | null
