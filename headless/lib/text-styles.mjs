// Text styles on the Node side: the wire schema for style ops and style packs,
// the workspace library (app/text-styles.json, written atomically), and the
// extra edit input style ops need (library styles they name, transcripts for
// addCaptions). The browser re-validates every style against the item schema.
//
// Styles are families with one variant (look) per aspect ratio; the shared
// helpers in src/shared/typography/text-styles/text-style-family.mjs migrate
// old single-look styles, merge and clone variants for both sides.
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseAspect } from '../../src/shared/projects/aspect.mjs'
import {
  mergeTextStyleFamilies,
  seedTextStyles,
  TEXT_STYLE_LIBRARY_SEED,
  textStyleLibraryNeedsSeed,
  toTextStyleFamily,
} from '../../src/shared/typography/text-styles/text-style-family.mjs'

const TEXT_STYLE_ROLES = ['title', 'caption', 'label', 'lower-third', 'other']
const styleId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
const finite = z.number().finite()

const look = z
  .object({
    fontSize: finite.positive().optional(),
    fontFamily: z.string().min(1).optional(),
    fontWeight: z.enum(['normal', 'medium', 'semibold', 'bold']).optional(),
    fontStyle: z.enum(['normal', 'italic']).optional(),
    underline: z.boolean().optional(),
    color: z.string().min(1).optional(),
    letterSpacing: finite.optional(),
    lineHeight: finite.positive().optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    backgroundColor: z.string().min(1).optional(),
    backgroundMode: z.enum(['text', 'box']).optional(),
    backgroundRadius: finite.min(0).optional(),
    textPadding: finite.min(0).optional(),
    textShadow: z
      .object({ offsetX: finite, offsetY: finite, blur: finite.min(0), color: z.string().min(1) })
      .strict()
      .optional(),
    stroke: z
      .object({
        width: finite.min(0),
        color: z.string().min(1),
        join: z.enum(['round', 'miter', 'bevel']).optional(),
      })
      .strict()
      .optional(),
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

const lookFields = {
  style: look,
  layout: z
    .object({
      xRatio: finite.optional(),
      yRatio: finite.optional(),
      widthRatio: finite.positive().optional(),
      heightRatio: finite.positive().optional(),
    })
    .strict()
    .optional(),
  textMotion: z.record(z.string(), z.unknown()).optional(),
  spanStyles: z.array(look.partial()).max(8).optional(),
  caption: captionRulesSchema.optional(),
}

const aspectArg = z.string().refine((value) => {
  try {
    parseAspect(value)
    return true
  } catch {
    return false
  }
}, 'expected an aspect ratio such as 9:16, 16:9, 1:1 or 4:5')

const variant = z.object({ aspect: z.string().regex(/^\d+:\d+$/), ...lookFields }).strict()

const sharedFields = {
  id: styleId.optional(),
  name: z.string().trim().min(1).max(80),
  role: z.enum(TEXT_STYLE_ROLES),
  description: z.string().max(500).optional(),
  defaultDurationFrames: z.number().int().positive().optional(),
  version: z.number().int().min(1).optional(),
  updatedAt: z.number().int().nonnegative().optional(),
}

/** A family: one look per aspect ratio. */
const textStyleFamilySchema = z
  .object({
    ...sharedFields,
    variants: z
      .array(variant)
      .min(1)
      .refine((list) => new Set(list.map((v) => v.aspect)).size === list.length, {
        message: 'one variant per aspect',
      }),
  })
  .strict()

/** One look (an old single-look style); `aspect` says which (else the canvas it is used on). */
const textStyleLookSchema = z
  .object({ ...sharedFields, aspect: aspectArg.optional(), ...lookFields })
  .strict()

/** A style as a person or the agent writes it (id, version and time are optional). */
const textStyleInputSchema = z.union([textStyleFamilySchema, textStyleLookSchema])

/**
 * A style in an op: one look, or a family whose variants the browser checks
 * field by field (kept light here so the published op schema stays small).
 */
const textStyleWireSchema = z.union([
  z
    .object({
      ...sharedFields,
      variants: z
        .array(
          z
            .object({ aspect: z.string().regex(/^\d+:\d+$/), style: z.object({}).passthrough() })
            .passthrough(),
        )
        .min(1),
    })
    .strict(),
  textStyleLookSchema,
])

/** A style in the family shape; a single look becomes its `aspect`'s variant (else 9:16). */
function asFamily(style) {
  const aspect = typeof style.aspect === 'string' ? parseAspect(style.aspect) : undefined
  return toTextStyleFamily(aspect ? { ...style, aspect } : style)
}

/** A style pack: a brand kit's styles in one file (`shred styles import/export`). */
export const textStylePackSchema = z
  .object({
    kind: z.literal('shreditor-text-styles'),
    version: z.literal(1),
    name: z.string().optional(),
    styles: z.array(textStyleInputSchema).min(1),
  })
  .strict()

const LIBRARY = ['app', 'text-styles.json']
const libraryPath = (workspace) => path.join(workspace, ...LIBRARY)
const BUILTINS_FILE = new URL(
  '../../src/shared/typography/text-styles/builtin-text-styles.json',
  import.meta.url,
)

/** The built-in title and caption styles a library is seeded with (see builtin-text-styles.ts). */
export function builtinTextStyles() {
  return JSON.parse(fs.readFileSync(BUILTINS_FILE, 'utf8'))
}

function readLibraryFile(workspace) {
  try {
    return JSON.parse(fs.readFileSync(libraryPath(workspace), 'utf8'))
  } catch {
    return null
  }
}

/** Valid styles of a library file, in the family shape. */
function stylesOf(file) {
  return (Array.isArray(file?.styles) ? file.styles : [])
    .map((style) => (style && typeof style === 'object' ? toTextStyleFamily(style) : style))
    .filter((style) => textStyleFamilySchema.safeParse(style).success && style.id)
}

function writeLibraryFile(workspace, styles, seeded) {
  const file = libraryPath(workspace)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  const body = { version: 2, ...(seeded ? { seeded } : {}), styles }
  fs.writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`)
  fs.renameSync(temp, file)
}

/**
 * The library file as it is now, seeded with the built-in styles first when
 * it is missing or never was (once: deleting a built-in does not bring it back).
 */
function seededLibraryFile(workspace) {
  const file = readLibraryFile(workspace)
  if (!textStyleLibraryNeedsSeed(file)) return file
  const styles = seedTextStyles(stylesOf(file), builtinTextStyles())
  writeLibraryFile(workspace, styles, TEXT_STYLE_LIBRARY_SEED)
  return { version: 2, seeded: TEXT_STYLE_LIBRARY_SEED, styles }
}

/** The library's styles as families (valid entries only; an unreadable file reads as empty). */
export function readTextStyleLibrary(workspace) {
  return stylesOf(seededLibraryFile(workspace))
}

/**
 * Apply one change to the library as it is on disk now and write it atomically
 * (temp file + rename), so the editor, which re-reads the file when it changes,
 * never sees half a file and nobody's change is lost to a stale copy.
 */
export function updateTextStyleLibrary(workspace, change) {
  const file = seededLibraryFile(workspace)
  const styles = change(stylesOf(file))
  writeLibraryFile(workspace, styles, file?.seeded)
  return styles
}

const slug = (name) =>
  name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'style'

/** Find a style by id, else by name (case-insensitive). */
export function findStyle(styles, idOrName) {
  const wanted = String(idOrName).trim().toLowerCase()
  return (
    styles.find((style) => style.id === idOrName) ??
    styles.find((style) => style.name.toLowerCase() === wanted)
  )
}

/**
 * Merge styles into a library: a style matching one there (by id, else name)
 * is laid over it and keeps that id, so projects stay linked; its variants
 * replace those for the same aspects and the library's other variants stay.
 * Others are added. A single look is the variant for its `aspect` (else 9:16).
 */
export function mergeStyles(library, incoming, now = Date.now()) {
  return incoming.reduce(
    (next, style) => mergeOne(next, asFamily({ ...style, version: style.version ?? 1 }), now),
    [...library],
  )
}

function mergeOne(styles, style, now) {
  const index = styles.findIndex((entry) => sameIdentity(entry, style))
  if (index < 0) {
    return [
      ...styles,
      { ...style, id: freeId(style.id || slug(style.name), styles), updatedAt: now },
    ]
  }
  const current = styles[index]
  const version = Math.max(style.version, current.version + 1)
  const merged = mergeTextStyleFamilies(current, style)
  return styles.with(index, { ...merged, id: current.id, version, updatedAt: now })
}

const sameIdentity = (entry, style) =>
  entry.id === style.id || entry.name.toLowerCase() === style.name.trim().toLowerCase()

function freeId(base, styles) {
  const taken = new Set(styles.map((entry) => entry.id))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

const STYLE_OPS = new Set(['addText', 'applyTextStyle', 'addCaptions'])

/** Library styles the ops name that the project does not have yet. */
function libraryStylesFor(workspace, project, ops) {
  const names = ops.filter((op) => STYLE_OPS.has(op.op) && typeof op.styleId === 'string')
  if (names.length === 0) return []
  const own = project?.timeline?.textStyles ?? []
  const library = readTextStyleLibrary(workspace)
  const wanted = names
    .filter((op) => !findStyle(own, op.styleId))
    .map((op) => findStyle(library, op.styleId))
    .filter(Boolean)
  return [...new Map(wanted.map((style) => [style.id, style])).values()]
}

function timelineItems(project) {
  const timeline = { items: [], compositions: [], ...project?.timeline }
  return [...timeline.items, ...timeline.compositions.flatMap((c) => c.items ?? [])]
}

/** Media whose transcript addCaptions needs: the clip's, or any clip the batch adds. */
function captionMediaIds(project, ops) {
  const captions = ops.filter((op) => op.op === 'addCaptions')
  if (captions.length === 0) return []
  const mediaByItem = new Map(timelineItems(project).map((item) => [item.id, item.mediaId]))
  const added = ops.filter((op) => op.op === 'addClip').map((op) => op.mediaId)
  // A clip the batch adds is referenced with $ref, so take every media the batch adds.
  const ids = captions.flatMap((op) => mediaByItem.get(op.clipId) ?? added)
  return [...new Set(ids.filter(Boolean))]
}

const MEDIA_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/**
 * The built-in transcript's segments (media/<id>/cache/ai/transcript.json, see
 * server/transcription.mjs; the older cache/transcript.json too), or null.
 */
function readTranscriptSegments(workspace, mediaId) {
  if (!MEDIA_ID.test(mediaId)) return null
  const dir = path.join(workspace, 'media', mediaId, 'cache')
  const found = [path.join(dir, 'ai', 'transcript.json'), path.join(dir, 'transcript.json')]
    .map(segmentsIn)
    .find(Array.isArray)
  return found ?? null
}

/** `segments` of a stored transcript file (an envelope's `data`, or a legacy bare one). */
function segmentsIn(file) {
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    return (stored.data ?? stored).segments
  } catch {
    return undefined
  }
}

/** The extra edit input text style ops need, or {} when the batch has none. */
export function collectTextStyleInput(workspace, project, ops) {
  const textStyleLibrary = libraryStylesFor(workspace, project, ops)
  const transcripts = captionMediaIds(project, ops).flatMap((mediaId) => {
    const segments = readTranscriptSegments(workspace, mediaId)
    return segments ? [{ mediaId, segments }] : []
  })
  return {
    ...(textStyleLibrary.length ? { textStyleLibrary } : {}),
    ...(transcripts.length ? { transcripts } : {}),
  }
}

// ---------------------------------------------------------------------------
// Wire schemas of the text style ops (spread into contract.mjs)
// ---------------------------------------------------------------------------

const itemId = z.string().min(1)

export const TEXT_STYLE_OP_NAMES = ['applyTextStyle', 'upsertTextStyle', 'addCaptions']

export const TEXT_STYLE_OP_SCHEMAS = [
  z
    .object({
      op: z.literal('applyTextStyle'),
      ids: z.array(itemId).min(1),
      styleId: z.string().min(1),
    })
    .strict(),
  z.union([
    z.object({ op: z.literal('upsertTextStyle'), style: textStyleWireSchema }).strict(),
    z
      .object({
        op: z.literal('upsertTextStyle'),
        fromItemId: itemId,
        name: z.string().trim().min(1).max(80),
        role: z.enum(TEXT_STYLE_ROLES),
        id: styleId.optional(),
        description: z.string().max(500).optional(),
        caption: captionRulesSchema.optional(),
      })
      .strict(),
  ]),
  z
    .object({
      op: z.literal('addCaptions'),
      clipId: itemId,
      styleId: z.string().min(1),
      trackId: itemId.optional(),
      replace: z.boolean().optional(),
    })
    .strict(),
]

export const TEXT_STYLE_OP_DESCRIPTIONS = {
  applyTextStyle: 'Link text items to a text style and give them its look',
  upsertTextStyle:
    "Add or replace a project text style (or save one from an item's look); restyles its items",
  addCaptions: 'Caption a clip from its transcript with a caption style, on the captions track',
}
