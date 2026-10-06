/**
 * The built-in title and caption presets as library text styles. A workspace
 * library is seeded with these once (see seedTextStyles in
 * text-style-family.mjs), after which they are ordinary, editable styles.
 *
 * Each gets a 9:16 and a 16:9 variant made from the preset logic on those
 * canvases, so a seeded style looks like the preset did on each. The agent
 * tools read the same definitions from builtin-text-styles.json, which a test
 * keeps equal to {@link buildBuiltinTextStyles}.
 */

import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition, TextStyleRole, TextStyleVariant } from '@/types/text-style'
import { TEXT_STYLE_PRESET_IDS, type TextStylePresetId } from '../text-style-preset-ids'
import { TEXT_STYLE_PRESETS, buildTextStylePresetTemplate } from '../text-style-presets'
import { CAPTION_STYLE_PRESETS, resolveCaptionStylePatch } from '../caption-style-presets'
import { deriveTextStyleFromItem } from './text-style-resolve'

/** The canvases the seeded variants are made on (their reference canvases). */
const SEED_CANVASES = [
  { width: 1080, height: 1920 },
  { width: 1920, height: 1080 },
] as const

/** Fixed, so the seeded definitions are reproducible. */
const SEEDED_AT = Date.UTC(2026, 9, 6)

const PRESET_ROLES: Partial<Record<TextStylePresetId, TextStyleRole>> = {
  'lower-third': 'lower-third',
  'speaker-card': 'lower-third',
  badge: 'label',
  'outline-pill': 'label',
}

const BASE_ITEM: TextItem = {
  id: 'builtin',
  type: 'text',
  trackId: 'builtin',
  from: 0,
  durationInFrames: 1,
  label: '',
  text: '',
  color: '#ffffff',
}

function titleVariant(
  presetId: TextStylePresetId,
  canvas: { width: number; height: number },
): TextStyleVariant {
  const template = buildTextStylePresetTemplate(presetId, { ...canvas, fps: 30 }, 1)
  return deriveTextStyleFromItem({ ...BASE_ITEM, ...template, transform: undefined }, canvas)
}

function captionVariant(
  preset: (typeof CAPTION_STYLE_PRESETS)[number],
  canvas: { width: number; height: number },
): TextStyleVariant {
  const { transform: _transform, ...patch } = resolveCaptionStylePatch(
    preset,
    canvas.width,
    canvas.height,
  )
  const variant = deriveTextStyleFromItem({ ...BASE_ITEM, ...patch, transform: undefined }, canvas)
  // The preset's ratios as they are: x stays where the item is, like the preset.
  const { fontSizeRatio: _fontSize, ...layout } = preset.layout ?? {}
  return Object.keys(layout).length > 0 ? { ...variant, layout } : variant
}

function builtin(
  id: string,
  name: string,
  role: TextStyleRole,
  variants: TextStyleVariant[],
): TextStyleDefinition {
  return { id, name, role, variants, version: 1, updatedAt: SEEDED_AT }
}

/** The 13 title presets and 5 caption presets as styles with 9:16 and 16:9 variants. */
export function buildBuiltinTextStyles(): TextStyleDefinition[] {
  const titles = TEXT_STYLE_PRESET_IDS.map((presetId) =>
    builtin(
      presetId,
      TEXT_STYLE_PRESETS.find((preset) => preset.id === presetId)?.label ?? presetId,
      PRESET_ROLES[presetId] ?? 'title',
      SEED_CANVASES.map((canvas) => titleVariant(presetId, canvas)),
    ),
  )
  const captions = CAPTION_STYLE_PRESETS.map((preset) =>
    builtin(
      preset.id,
      preset.label,
      'caption',
      SEED_CANVASES.map((canvas) => captionVariant(preset, canvas)),
    ),
  )
  return [...titles, ...captions]
}
