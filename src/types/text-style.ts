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
 * Sizes are canvas-relative: lengths are stored as reference pixels for a
 * canvas whose SHORT side is 1080 (1080x1920 and 1920x1080 alike) and scale
 * with the short side elsewhere, so one style fits 9:16 and 16:9.
 */

export const TEXT_STYLE_ROLES = ['title', 'caption', 'label', 'lower-third', 'other'] as const
export type TextStyleRole = (typeof TEXT_STYLE_ROLES)[number]

/** The short side, in pixels, that a style's lengths are written for. */
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

export interface TextStyleDefinition {
  id: string
  name: string
  role: TextStyleRole
  description?: string
  style: TextStyleLook
  layout?: TextStyleLayout
  textMotion?: TextMotionSpec
  /**
   * Looks of the item's spans (font, size, colour per line), mapped onto an
   * item's spans by index; the last one repeats. Lengths in reference pixels.
   * Lets a lower third keep its big name and small role line.
   */
  spanStyles?: Array<Omit<TextSpan, 'text'>>
  /** Length of a new item made with this style, in project frames. */
  defaultDurationFrames?: number
  caption?: CaptionChunkRules
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
