/**
 * What the text style picker offers and how it talks about a style: project
 * styles first, then library styles not in the project yet, with the styles
 * whose role suits the item's format track suggested at the top of each.
 */

import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition, TextStyleRole } from '@/types/text-style'
import {
  deriveTextStyleFromItem,
  textStyleRoleMatchesFormatRole,
} from '@/shared/typography/text-styles/text-style-resolve'
import {
  findTextStyle,
  normalizeTextStyleInput,
} from '@/shared/typography/text-styles/text-style-schema'

export interface PickerEntry {
  style: TextStyleDefinition
  suggested: boolean
}

function suggestFirst(styles: readonly TextStyleDefinition[], formatRole?: string): PickerEntry[] {
  return styles
    .map((style) => ({ style, suggested: textStyleRoleMatchesFormatRole(style.role, formatRole) }))
    .sort(
      (a, b) =>
        Number(b.suggested) - Number(a.suggested) || a.style.name.localeCompare(b.style.name),
    )
}

export function buildTextStylePickerGroups(
  projectStyles: readonly TextStyleDefinition[],
  libraryStyles: readonly TextStyleDefinition[],
  formatRole?: string,
): { project: PickerEntry[]; library: PickerEntry[] } {
  const inProject = new Set(projectStyles.map((style) => style.id))
  return {
    project: suggestFirst(projectStyles, formatRole),
    library: suggestFirst(
      libraryStyles.filter((style) => !inProject.has(style.id)),
      formatRole,
    ),
  }
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

export type LibraryState = 'missing' | 'same' | 'differs'

/** How a project style stands against the library copy with its id. */
export function libraryStateOf(
  style: TextStyleDefinition,
  libraryStyles: readonly TextStyleDefinition[],
): LibraryState {
  const source = libraryStyles.find((entry) => entry.id === style.id)
  if (!source) return 'missing'
  return sameTextStyle(source, style) ? 'same' : 'differs'
}

/** A new style made from an item's look. Throws when the name is taken. */
export function newTextStyleFromItem(
  item: TextItem,
  draft: { name: string; role: TextStyleRole },
  canvas: { width: number; height: number },
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

/** The style with the item's current look (same id and name, next version). */
export function textStyleUpdatedFromItem(
  style: TextStyleDefinition,
  item: TextItem,
  canvas: { width: number; height: number },
): TextStyleDefinition {
  const derived = deriveTextStyleFromItem(item, canvas)
  return {
    ...style,
    style: derived.style,
    layout: derived.layout ?? style.layout,
    textMotion: derived.textMotion,
    spanStyles: derived.spanStyles,
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
