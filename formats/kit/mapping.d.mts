// Types for ./mapping.mjs.
import type { TextStyleDefinition, TextStyleLayout } from '../../src/types/text-style'
import type { TextFontWeight } from '../../src/types/text'
import type { Kit, KitSection } from './kit.mjs'

type Canvas = { width: number; height: number }
export type KitStyleInput = Omit<TextStyleDefinition, 'version' | 'updatedAt'>

export function fontWeightFromKit(weight: number): TextFontWeight
export function kitWeightFromFontWeight(name: string | undefined): number
export function anchorBoxToLayout(
  box: { anchor: string; x: number; width: number; y: number; height: number },
  canvas: Canvas,
): Required<TextStyleLayout>
export function layoutToAnchorBox(
  layout: TextStyleLayout,
  anchor: string,
  canvas: Canvas,
): { x: number; width: number; y: number }
export function kitStyleSpecs(
  kit: Kit,
): Array<{ id: string; name: string; role: string; section: string; position?: string }>
export function kitTextStyles(
  kit: Kit,
  options: { familyFor: (fontKey: string) => string },
): KitStyleInput[]
export function kitStyleSource(
  kit: Kit,
  styleId: string,
): { section: string; position?: string } | undefined
