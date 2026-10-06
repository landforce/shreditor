// @vitest-environment node

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import { TEXT_STYLE_PRESET_IDS } from '../text-style-preset-ids'
import { buildTextStylePresetTemplate } from '../text-style-presets'
import { CAPTION_STYLE_PRESETS, resolveCaptionStylePatch } from '../caption-style-presets'
import { buildBuiltinTextStyles } from './builtin-text-styles'
import { buildApplyTextStyleUpdates } from './text-style-resolve'
import { textStyleDefinitionSchema } from './text-style-schema'

const JSON_PATH = path.join(__dirname, 'builtin-text-styles.json')
const CANVASES = [
  { width: 1080, height: 1920, fps: 30 },
  { width: 1920, height: 1080, fps: 30 },
]

const item = (extra: Partial<TextItem> = {}): TextItem => ({
  id: 'i',
  type: 'text',
  trackId: 't',
  from: 0,
  durationInFrames: 30,
  label: '',
  text: 'Hi',
  color: '#000',
  transform: { x: 40, y: 0, width: 800, height: 300, rotation: 0, opacity: 1 },
  ...extra,
})

describe('built-in text styles', () => {
  const builtins = buildBuiltinTextStyles()

  it('are the JSON the agent tools seed from', () => {
    const text = `${JSON.stringify(builtins, null, 2)}\n`
    if (process.env.UPDATE_BUILTIN_TEXT_STYLES) fs.writeFileSync(JSON_PATH, text)
    expect(fs.readFileSync(JSON_PATH, 'utf8')).toBe(text)
  })

  it('are 13 title and 5 caption styles, each valid with 9:16 and 16:9 variants', () => {
    expect(builtins).toHaveLength(TEXT_STYLE_PRESET_IDS.length + CAPTION_STYLE_PRESETS.length)
    expect(new Set(builtins.map((style) => style.name.toLowerCase())).size).toBe(builtins.length)
    for (const style of builtins) {
      expect(textStyleDefinitionSchema.safeParse(style).success).toBe(true)
      expect(style.variants.map((variant) => variant.aspect)).toEqual(['9:16', '16:9'])
    }
  })

  it.each(CANVASES)('title styles look like the presets on $width x $height', (canvas) => {
    for (const presetId of TEXT_STYLE_PRESET_IDS) {
      const style = builtins.find((entry) => entry.id === presetId)!
      const preset = buildTextStylePresetTemplate(presetId, canvas, 1)
      const spans = preset.textSpans?.map((span) => ({ ...span, text: 'x' }))
      const resolved = buildApplyTextStyleUpdates(item({ textSpans: spans }), style, canvas)
      for (const key of [
        'fontSize',
        'fontFamily',
        'fontWeight',
        'color',
        'letterSpacing',
        'lineHeight',
        'textPadding',
        'backgroundColor',
        'backgroundRadius',
        'textShadow',
        'stroke',
      ] as const) {
        expect([presetId, key, resolved[key]]).toEqual([presetId, key, preset[key]])
      }
      expect(resolved.textSpans).toEqual(spans)
      // A title preset never moved the item; neither does its style.
      expect(resolved.transform).toBeUndefined()
    }
  })

  it.each([...CANVASES, { width: 720, height: 1280, fps: 30 }])(
    'caption styles look like the presets on $width x $height',
    (canvas) => {
      for (const preset of CAPTION_STYLE_PRESETS) {
        const style = builtins.find((entry) => entry.id === preset.id)!
        const base = item()
        const expected = resolveCaptionStylePatch(
          preset,
          canvas.width,
          canvas.height,
          base.transform,
        )
        const resolved = buildApplyTextStyleUpdates(base, style, canvas)
        expect(Math.abs(resolved.fontSize! - expected.fontSize!)).toBeLessThanOrEqual(1)
        expect(resolved.transform).toMatchObject({
          x: 40,
          y: expected.transform!.y,
          width: expected.transform!.width,
          height: expected.transform!.height,
        })
        // Strokes and shadows were fixed pixels; a variant scales them with the canvas.
        if (Math.min(canvas.width, canvas.height) === 1080) {
          expect([resolved.color, resolved.stroke, resolved.textShadow]).toEqual([
            expected.color,
            expected.stroke,
            expected.textShadow,
          ])
        }
      }
    },
  )
})
