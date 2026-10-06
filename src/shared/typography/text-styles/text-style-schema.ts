/**
 * Validation for text style definitions: the project copies in
 * `timeline.textStyles`, styles the agent sends in an op, and the workspace
 * library file. Field rules mirror the timeline item schema so a resolved
 * style always makes a valid item.
 *
 * Stored styles are families (one variant per aspect ratio). Old single-look
 * styles still load: they become a one-variant family (see
 * text-style-family.mjs) and are written back in the family shape.
 */

import { z } from 'zod'
import { TEXT_STYLE_ROLES, type TextStyleDefinition } from '@/types/text-style'
import type { TextMotionSpec } from '@/types/text-motion'
import { sanitizeTextMotion } from '@/shared/projects/migrations/sanitize-text-motion'
import { parseAspect } from '@/shared/projects/aspect.mjs'
import {
  LEGACY_TEXT_STYLE_ASPECT,
  mergeTextStyleFamilies,
  toTextStyleFamily,
} from './text-style-family.mjs'

// Letters, digits, '_', '-' and ':' (a namespace, as in `kit:title`).
const TEXT_STYLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$/

const fontWeight = z.enum(['normal', 'medium', 'semibold', 'bold'])
const fontStyle = z.enum(['normal', 'italic'])
const finite = z.number().finite()

const lookSchema = z
  .object({
    fontSize: finite.positive().max(2000).optional(),
    fontFamily: z.string().min(1).max(120).optional(),
    fontWeight: fontWeight.optional(),
    fontStyle: fontStyle.optional(),
    underline: z.boolean().optional(),
    color: z.string().min(1).max(64).optional(),
    letterSpacing: finite.min(-200).max(200).optional(),
    lineHeight: finite.positive().max(10).optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    backgroundColor: z.string().min(1).max(64).optional(),
    backgroundMode: z.enum(['text', 'lines', 'box']).optional(),
    backgroundRadius: finite.min(0).max(2000).optional(),
    textPadding: finite.min(0).max(1000).optional(),
    textPaddingX: finite.min(0).max(1000).optional(),
    textPaddingY: finite.min(0).max(1000).optional(),
    textShadow: z
      .object({ offsetX: finite, offsetY: finite, blur: finite.min(0), color: z.string().min(1) })
      .strict()
      .optional(),
    stroke: z
      .object({
        width: finite.min(0).max(200),
        color: z.string().min(1),
        join: z.enum(['round', 'miter', 'bevel']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const spanStyleSchema = lookSchema
  .pick({
    fontSize: true,
    fontFamily: true,
    fontWeight: true,
    fontStyle: true,
    underline: true,
    color: true,
    letterSpacing: true,
  })
  .strict()

const layoutSchema = z
  .object({
    xRatio: finite.min(-2).max(2).optional(),
    yRatio: finite.min(-2).max(2).optional(),
    widthRatio: finite.positive().max(4).optional(),
    heightRatio: finite.positive().max(4).optional(),
  })
  .strict()

const captionRulesSchema = z
  .object({
    maxWordsPerChunk: z.number().int().min(1).max(40),
    maxCharsPerLine: z.number().int().min(4).max(200),
    maxLines: z.number().int().min(1).max(6),
    minChunkFrames: z.number().int().min(0).max(600),
    case: z.enum(['as-is', 'upper', 'lower']).optional(),
    punctuation: z.enum(['keep', 'strip']).optional(),
  })
  .strict()

const textMotionSchema = z.unknown().transform((value, ctx): TextMotionSpec => {
  const sanitized = sanitizeTextMotion(value)
  if (!sanitized) {
    ctx.addIssue({ code: 'custom', message: 'textMotion needs a valid in, out or loop effect' })
    return z.NEVER
  }
  return sanitized
})

const ASPECT_KEY = /^[1-9]\d{0,4}:[1-9]\d{0,4}$/

/** The look parts of a style, as one variant or an old single-look style holds them. */
const lookFields = {
  style: lookSchema,
  layout: layoutSchema.optional(),
  textMotion: textMotionSchema.optional(),
  spanStyles: z.array(spanStyleSchema).max(8).optional(),
  caption: captionRulesSchema.optional(),
}

const variantSchema = z.object({ aspect: z.string().regex(ASPECT_KEY), ...lookFields }).strict()

const variantsSchema = z
  .array(variantSchema)
  .min(1)
  .max(16)
  .refine((variants) => new Set(variants.map((v) => v.aspect)).size === variants.length, {
    message: 'one variant per aspect',
  })

const sharedFields = {
  name: z.string().trim().min(1).max(80),
  role: z.enum(TEXT_STYLE_ROLES),
  description: z.string().max(500).optional(),
  defaultDurationFrames: z.number().int().min(1).max(216_000).optional(),
}

const storedIdentity = {
  id: z.string().regex(TEXT_STYLE_ID_PATTERN),
  version: z.number().int().min(1),
  updatedAt: z.number().int().min(0),
}

/** A stored style: a family with every field required. */
export const textStyleDefinitionSchema = z
  .object({ ...storedIdentity, ...sharedFields, variants: variantsSchema })
  .strict()

/** An old single-look style, as projects and libraries saved before variants. */
const legacyTextStyleSchema = z
  .object({ ...storedIdentity, ...sharedFields, ...lookFields })
  .strict()

/** A style as a project may store it: a family, or an old single-look style. */
export const storedTextStyleSchema = z.union([textStyleDefinitionSchema, legacyTextStyleSchema])

const inputIdentity = {
  id: z.string().regex(TEXT_STYLE_ID_PATTERN).optional(),
  version: z.number().int().min(1).optional(),
  updatedAt: z.number().int().min(0).optional(),
}

/**
 * A style as written by a person or the agent (id, version and time are
 * filled in): a family with `variants`, or one look with an optional
 * `aspect` (default: the canvas it is written on).
 */
const familyInputSchema = z
  .object({ ...inputIdentity, ...sharedFields, variants: variantsSchema })
  .strict()
const lookInputSchema = z
  .object({
    ...inputIdentity,
    ...sharedFields,
    aspect: z.string().min(1).max(32).optional(),
    ...lookFields,
  })
  .strict()

const hasVariants = (value: unknown) =>
  typeof value === 'object' && value !== null && 'variants' in value

function firstProblem(error: z.ZodError): string {
  const issue = error.issues[0]
  return `${issue?.path.join('.') || 'style'}: ${issue?.message ?? 'invalid'}`
}

type ParsedTextStyleInput = Omit<TextStyleDefinition, 'id' | 'version' | 'updatedAt'> &
  Partial<Pick<TextStyleDefinition, 'id' | 'version' | 'updatedAt'>>

/**
 * Parse a style someone wrote into the family shape; one look becomes the
 * variant for its `aspect`, else `aspect` (the canvas it is written on).
 * Throws with the first problem as "field: message".
 */
export function parseTextStyleInput(
  value: unknown,
  aspect = LEGACY_TEXT_STYLE_ASPECT,
): ParsedTextStyleInput {
  const result = (hasVariants(value) ? familyInputSchema : lookInputSchema).safeParse(value)
  if (!result.success) throw new Error(`style.${firstProblem(result.error)}`)
  const data = result.data as Record<string, unknown>
  const own = typeof data.aspect === 'string' ? parseAspectField(data.aspect) : aspect
  return toTextStyleFamily({ ...data, aspect: own }) as unknown as ParsedTextStyleInput
}

function parseAspectField(text: string): string {
  try {
    return parseAspect(text)
  } catch (error) {
    throw new Error(`style.aspect: ${(error as Error).message}`)
  }
}

/**
 * The valid styles in a list (a project copy or the library file) in the
 * family shape; bad entries are dropped. Old single-look styles become a
 * variant for `legacyAspect` (a project's own aspect for its copies).
 */
export function sanitizeTextStyles(
  value: unknown,
  legacyAspect = LEGACY_TEXT_STYLE_ASPECT,
): TextStyleDefinition[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((entry) => {
    const result = textStyleDefinitionSchema.safeParse(toTextStyleFamily(entry, legacyAspect))
    if (!result.success || seen.has(result.data.id)) return []
    seen.add(result.data.id)
    return [result.data as TextStyleDefinition]
  })
}

function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return slug || 'style'
}

/** A readable id from the name that no style in `taken` has. */
function uniqueTextStyleId(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Find a style by id, else by name (case-insensitive). */
export function findTextStyle<T extends Pick<TextStyleDefinition, 'id' | 'name'>>(
  styles: readonly T[],
  idOrName: string,
): T | undefined {
  const wanted = idOrName.trim().toLowerCase()
  return (
    styles.find((style) => style.id === idOrName) ??
    styles.find((style) => style.name.toLowerCase() === wanted)
  )
}

/**
 * Turn written input into a stored definition. An input matching an existing
 * style (by id, else name) is laid over it and bumps its version: its
 * variants replace those for the same aspects and the others stay. Otherwise
 * it gets a fresh id from its name. One look is the variant for `aspect`.
 */
export function normalizeTextStyleInput(
  input: unknown,
  existing: readonly TextStyleDefinition[],
  options: { aspect?: string; now?: number } = {},
): TextStyleDefinition {
  const parsed = parseTextStyleInput(input, options.aspect)
  const match = parsed.id
    ? existing.find((style) => style.id === parsed.id)
    : findTextStyle(existing, parsed.name)
  const id =
    parsed.id ?? match?.id ?? uniqueTextStyleId(parsed.name, new Set(existing.map((s) => s.id)))
  const version = Math.max(parsed.version ?? 1, match ? match.version + 1 : 1)
  const merged = match ? mergeTextStyleFamilies(match, { ...match, ...parsed }) : parsed
  return {
    ...merged,
    id,
    version,
    updatedAt: parsed.updatedAt ?? options.now ?? Date.now(),
  } as TextStyleDefinition
}
