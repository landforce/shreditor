/**
 * What the text style picker offers and how it talks about a style: project
 * styles first, then library styles not in the project yet, with the styles
 * whose role suits the item's format track suggested at the top of each.
 * A style with no look for the canvas's aspect is still offered, marked, so
 * the user can make a version for it.
 */

import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition, TextStyleRole, TextStyleVariant } from '@/types/text-style'
import {
  canvasAspect,
  deriveTextStyleFromItem,
  textStyleRoleMatchesFormatRole,
  textStyleVariantForCanvas,
} from '@/shared/typography/text-styles/text-style-resolve'
import {
  findTextStyle,
  normalizeTextStyleInput,
} from '@/shared/typography/text-styles/text-style-schema'
import {
  addClonedTextStyleVariant,
  textStyleVariantFor,
  withTextStyleVariant,
} from '@/shared/typography/text-styles/text-style-family.mjs'

type Canvas = { width: number; height: number }

export interface PickerEntry {
  style: TextStyleDefinition
  suggested: boolean
  /** False when the style has no look for the canvas's aspect yet. */
  fits: boolean
}

function suggestFirst(
  styles: readonly TextStyleDefinition[],
  formatRole: string | undefined,
  canvas: Canvas | undefined,
): PickerEntry[] {
  return styles
    .map((style) => ({
      style,
      suggested: textStyleRoleMatchesFormatRole(style.role, formatRole),
      fits: !canvas || Boolean(textStyleVariantForCanvas(style, canvas)),
    }))
    .sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) ||
        Number(b.suggested) - Number(a.suggested) ||
        a.style.name.localeCompare(b.style.name),
    )
}

export function buildTextStylePickerGroups(
  projectStyles: readonly TextStyleDefinition[],
  libraryStyles: readonly TextStyleDefinition[],
  formatRole?: string,
  canvas?: Canvas,
): { project: PickerEntry[]; library: PickerEntry[] } {
  const inProject = new Set(projectStyles.map((style) => style.id))
  return {
    project: suggestFirst(projectStyles, formatRole, canvas),
    library: suggestFirst(
      libraryStyles.filter((style) => !inProject.has(style.id)),
      formatRole,
      canvas,
    ),
  }
}

/**
 * "Make a 16:9 version": the style with a variant for the canvas's aspect,
 * cloned from its closest one as a starting point (next version).
 */
export function textStyleWithVersionFor(
  style: TextStyleDefinition,
  canvas: Canvas,
): TextStyleDefinition {
  const { style: next } = addClonedTextStyleVariant(style, canvasAspect(canvas))
  return { ...next, version: style.version + 1, updatedAt: Date.now() }
}

/** Same definition, version and time aside. */
function sameTextStyle(a: TextStyleDefinition, b: TextStyleDefinition): boolean {
  const strip = ({ version: _version, updatedAt: _updatedAt, ...rest }: TextStyleDefinition) =>
    stableJson(rest)
  return strip(a) === strip(b)
}

/** JSON with object keys sorted at every level, so key order never counts. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined)
    entries.sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** `ahead`: the same, but the project has versions (aspects) the library lacks. */
export type LibraryState = 'missing' | 'same' | 'ahead' | 'differs'

/** How a project style stands against the library copy with its id. */
export function libraryStateOf(
  style: TextStyleDefinition,
  libraryStyles: readonly TextStyleDefinition[],
): LibraryState {
  const source = libraryStyles.find((entry) => entry.id === style.id)
  if (!source) return 'missing'
  if (sameTextStyle(source, style)) return 'same'
  const shared = style.variants.filter((variant) => textStyleVariantFor(source, variant.aspect))
  return shared.length < style.variants.length &&
    sameTextStyle(source, { ...style, variants: shared })
    ? 'ahead'
    : 'differs'
}

/** A new style made from an item's look. Throws when the name is taken. */
export function newTextStyleFromItem(
  item: TextItem,
  draft: { name: string; role: TextStyleRole },
  canvas: Canvas,
  existing: readonly TextStyleDefinition[],
): TextStyleDefinition {
  if (findTextStyle(existing, draft.name)) throw new Error(`A style named "${draft.name}" exists`)
  return normalizeTextStyleInput(
    {
      name: draft.name,
      role: draft.role,
      ...deriveTextStyleFromItem(item, canvas),
      defaultDurationFrames: item.durationInFrames,
    },
    existing,
  )
}

/**
 * The style with the item's current look written into the variant for the
 * item's canvas (same id and name, next version); other variants stay.
 */
export function textStyleUpdatedFromItem(
  style: TextStyleDefinition,
  item: TextItem,
  canvas: Canvas,
): TextStyleDefinition {
  const derived = deriveTextStyleFromItem(item, canvas)
  const current = textStyleVariantFor(style, derived.aspect)
  const variant: TextStyleVariant = {
    ...derived,
    ...(derived.layout || current?.layout ? { layout: derived.layout ?? current?.layout } : {}),
    ...(current?.caption ? { caption: current.caption } : {}),
  }
  return {
    ...withTextStyleVariant(style, variant),
    version: style.version + 1,
    updatedAt: Date.now(),
  }
}

/** A copy under a new name and id. */
export function duplicateTextStyle(
  style: TextStyleDefinition,
  name: string,
  existing: readonly TextStyleDefinition[],
): TextStyleDefinition {
  const { id: _id, version: _version, updatedAt: _updatedAt, ...rest } = style
  return normalizeTextStyleInput({ ...rest, name }, existing)
}

/** i18n key of a role's name. */
export function roleLabelKey(role: TextStyleRole): string {
  return `textStyles.roles.${role === 'lower-third' ? 'lowerThird' : role}`
}
