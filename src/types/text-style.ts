import type { TextSpan, TextStyleFields } from './text'
import type { TextMotionSpec } from './text-motion'

/**
 * Text styles: named, reusable looks for text, used over and over and
 * live-linked to the items that use them (like paragraph styles).
 *
 * A style lives in the workspace library (`app/text-styles.json`, shared by
 * every project, the user and the agent) and is COPIED into a project
 * (`timeline.textStyles`) when used, so a project renders the same even when
 * the library changes. Items point at their project copy with `textStyleId`.
 * Editing the project copy writes the resolved fields onto every item that
 * uses it (one undo step), skipping the fields an item overrides.
 *
 * A style is a family with one look per aspect ratio (a variant for 9:16,
 * one for 16:9, ...): a vertical title can be bigger and sit elsewhere than
 * its landscape twin, and items stay linked to the one style. An item uses
 * the variant for the aspect of the canvas it is on; a style with no variant
 * for it offers to clone the closest one (see text-style-family.mjs).
 * Within a variant, lengths are pixels on its aspect's reference canvas
 * (short side 1080: 1080x1920, 1920x1080, 1080x1350) and scale uniformly on
 * other resolutions of that aspect.
 */

export const TEXT_STYLE_ROLES = ['title', 'caption', 'label', 'lower-third', 'other'] as const
export type TextStyleRole = (typeof TEXT_STYLE_ROLES)[number]

/** The short side, in pixels, of the canvas a variant's lengths are written for. */
export const TEXT_STYLE_REFERENCE_SIZE = 1080

/**
 * Look of a style: the complete set of typography fields, lengths in
 * reference pixels. A style controls every field, so a field it leaves out
 * (no background, no stroke) is cleared on the items that use it.
 */
export type TextStyleLook = TextStyleFields

/**
 * Canvas-relative position and box of the text. Ratios of the canvas, like
 * the caption presets: x/y are offsets of the box centre from the canvas
 * centre (+y is below), width/height are the box size.
 */
export interface TextStyleLayout {
  xRatio?: number
  yRatio?: number
  widthRatio?: number
  heightRatio?: number
}

export type CaptionTextCase = 'as-is' | 'upper' | 'lower'
export type CaptionPunctuation = 'keep' | 'strip'

/** How a caption style splits a transcript into on-screen chunks. */
export interface CaptionChunkRules {
  maxWordsPerChunk: number
  maxCharsPerLine: number
  maxLines: number
  /** Shortest a chunk stays on screen, in project frames. */
  minChunkFrames: number
  case?: CaptionTextCase
  punctuation?: CaptionPunctuation
}

/** The parts of a style that make up its look on one canvas. */
export interface TextStyleLookParts {
  style: TextStyleLook
  layout?: TextStyleLayout
  textMotion?: TextMotionSpec
  /**
   * Looks of the item's spans (font, size, colour per line), mapped onto an
   * item's spans by index; the last one repeats. Lengths in reference pixels.
   * Lets a lower third keep its big name and small role line.
   */
  spanStyles?: Array<Omit<TextSpan, 'text'>>
}

/** A style's look for one aspect ratio. */
export interface TextStyleVariant extends TextStyleLookParts {
  /** Aspect key ("9:16", "16:9", "1:1", "4:5" or a reduced "W:H"). */
  aspect: string
  caption?: CaptionChunkRules
}

export interface TextStyleDefinition {
  id: string
  name: string
  role: TextStyleRole
  description?: string
  /** One look per aspect ratio, at most one per aspect. */
  variants: TextStyleVariant[]
  /** Length of a new item made with this style, in project frames. */
  defaultDurationFrames?: number
  /** Bumped on every change, so a project copy can tell the library moved on. */
  version: number
  updatedAt: number
}

/**
 * A field of an item that a style controls. Layout is tracked per transform
 * axis so moving a styled title keeps its spot when the style changes.
 */
export type TextStyleFieldKey =
  | keyof TextStyleFields
  | 'transform.x'
  | 'transform.y'
  | 'transform.width'
  | 'transform.height'
  | 'textMotion'
  | 'textSpans'
