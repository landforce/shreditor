// Types for ./text-style-family.mjs (shared by the editor and the agent tools).
import type { TextStyleDefinition, TextStyleVariant } from '../../../types/text-style'

export const LEGACY_TEXT_STYLE_ASPECT: string

export function referenceCanvasForAspect(aspect: string): { width: number; height: number }
export function toTextStyleFamily<T = TextStyleDefinition>(entry: unknown, legacyAspect?: string): T
export function textStyleVariantFor(
  style: Pick<TextStyleDefinition, 'variants'>,
  aspect: string,
): TextStyleVariant | undefined
export function textStyleAspects(style: Pick<TextStyleDefinition, 'variants'>): string[]
export function withTextStyleVariant<T extends Pick<TextStyleDefinition, 'variants'>>(
  style: T,
  variant: TextStyleVariant,
): T
export function mergeTextStyleFamilies<T extends Pick<TextStyleDefinition, 'variants'>>(
  base: T,
  incoming: T,
): T
export function cloneTextStyleVariant(variant: TextStyleVariant, toAspect: string): TextStyleVariant
export function addClonedTextStyleVariant<T extends TextStyleDefinition>(
  style: T,
  toAspect: string,
  fromAspect?: string,
): { style: T; from: string }
export function missingTextStyleVariantMessage(
  style: Pick<TextStyleDefinition, 'id' | 'name' | 'variants'>,
  aspect: string,
  projectId?: string,
): string

export const TEXT_STYLE_LIBRARY_SEED: number
export function textStyleLibraryNeedsSeed(file: object | null | undefined): boolean
export function seedTextStyles<T extends Pick<TextStyleDefinition, 'id' | 'name'>>(
  styles: readonly T[],
  builtins: readonly T[],
): T[]
