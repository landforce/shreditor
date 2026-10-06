/**
 * Validation for text style definitions: the project copies in
 * `timeline.textStyles`, styles the agent sends in an op, and the workspace
 * library file. Field rules mirror the timeline item schema so a resolved
 * style always makes a valid item.
 */

import { z } from 'zod'
import { TEXT_STYLE_ROLES, type TextStyleDefinition } from '@/types/text-style'
import type { TextMotionSpec } from '@/types/text-motion'
import { sanitizeTextMotion } from '@/shared/projects/migrations/sanitize-text-motion'

const TEXT_STYLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

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
    backgroundMode: z.enum(['text', 'box']).optional(),
    backgroundRadius: finite.min(0).max(2000).optional(),
    textPadding: finite.min(0).max(1000).optional(),
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

const definitionFields = {
  name: z.string().trim().min(1).max(80),
  role: z.enum(TEXT_STYLE_ROLES),
  description: z.string().max(500).optional(),
  style: lookSchema,
  layout: layoutSchema.optional(),
  textMotion: textMotionSchema.optional(),
  spanStyles: z.array(spanStyleSchema).max(8).optional(),
  defaultDurationFrames: z.number().int().min(1).max(216_000).optional(),
  caption: captionRulesSchema.optional(),
}

/** A stored style: everything required. */
export const textStyleDefinitionSchema = z
  .object({
    id: z.string().regex(TEXT_STYLE_ID_PATTERN),
    ...definitionFields,
    version: z.number().int().min(1),
    updatedAt: z.number().int().min(0),
  })
  .strict()

/** A style as written by a person or the agent: id, version and time are filled in. */
const textStyleInputSchema = z
  .object({
    id: z.string().regex(TEXT_STYLE_ID_PATTERN).optional(),
    ...definitionFields,
    version: z.number().int().min(1).optional(),
    updatedAt: z.number().int().min(0).optional(),
  })
  .strict()

export type TextStyleInput = z.input<typeof textStyleInputSchema>

function firstProblem(error: z.ZodError): string {
  const issue = error.issues[0]
  return `${issue?.path.join('.') || 'style'}: ${issue?.message ?? 'invalid'}`
}

/** Parse a style someone wrote; throws with the first problem as "field: message". */
export function parseTextStyleInput(value: unknown): z.output<typeof textStyleInputSchema> {
  const result = textStyleInputSchema.safeParse(value)
  if (!result.success) throw new Error(`style.${firstProblem(result.error)}`)
  return result.data
}

/** The valid styles in a list (a project copy or the library file); bad entries are dropped. */
export function sanitizeTextStyles(value: unknown): TextStyleDefinition[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((entry) => {
    const result = textStyleDefinitionSchema.safeParse(entry)
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
export function uniqueTextStyleId(name: string, taken: ReadonlySet<string>): string {
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
 * style (by id, else name) replaces it and bumps its version; otherwise it
 * gets a fresh id from its name.
 */
export function normalizeTextStyleInput(
  input: unknown,
  existing: readonly TextStyleDefinition[],
  now = Date.now(),
): TextStyleDefinition {
  const parsed = parseTextStyleInput(input)
  const match = parsed.id
    ? existing.find((style) => style.id === parsed.id)
    : findTextStyle(existing, parsed.name)
  const id =
    parsed.id ?? match?.id ?? uniqueTextStyleId(parsed.name, new Set(existing.map((s) => s.id)))
  const version = Math.max(parsed.version ?? 1, match ? match.version + 1 : 1)
  return { ...parsed, id, version, updatedAt: parsed.updatedAt ?? now } as TextStyleDefinition
}
