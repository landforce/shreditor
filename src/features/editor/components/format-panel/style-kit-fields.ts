/**
 * The Video Style Kit values the Style tab edits, read off a kit.json
 * (docs/video-style-kit.md): the fonts, the look of titles, captions and
 * overlays, and which editing preferences are on. Each field names its kit
 * path, which `shred kit set` writes.
 */

export type KitFieldKind = 'text' | 'number' | 'color' | 'select' | 'toggle'

export interface KitField {
  path: string
  /** A key under formats.style.fields, or null to show `label` as is. */
  labelKey: string | null
  label: string
  kind: KitFieldKind
  value: unknown
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
}

export interface KitFieldGroup {
  id: string
  titleKey: string
  title: string
  fields: KitField[]
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const WEIGHTS = [400, 500, 600, 700].map((w) => ({ value: String(w), label: String(w) }))

const SECTIONS = [
  { id: 'titles', title: 'Titles' },
  { id: 'captions', title: 'Captions' },
  { id: 'overlays', title: 'Overlays' },
]

const PREFERENCE_NAMES: Record<string, string> = {
  punchIns: 'Punch-ins',
  tightCuts: 'Tight cuts',
  alternateSides: 'Alternate sides',
  sfx: 'Sound effects',
  musicBed: 'Music bed',
  brandColors: 'Brand colours',
}

const humanize = (key: string) =>
  key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/** A font entry's own field: its chosen option, or the first family in its stack. */
function fontField(key: string, font: Json): KitField | null {
  if (typeof font.choice === 'string' && isObject(font.options))
    return {
      path: `fonts.${key}.choice`,
      labelKey: null,
      label: humanize(key),
      kind: 'select',
      value: font.choice,
      options: Object.entries(font.options).map(([value, option]) => ({
        value,
        label: isObject(option) && typeof option.label === 'string' ? option.label : value,
      })),
    }
  if (Array.isArray(font.stack) && typeof font.stack[0] === 'string')
    return {
      path: `fonts.${key}.stack.0`,
      labelKey: null,
      label: humanize(key),
      kind: 'text',
      value: font.stack[0],
    }
  return null
}

function styleFields(section: string, style: Json, fontKeys: string[]): KitField[] {
  const at = (key: string) => `${section}.style.${key}`
  const fields: KitField[] = []
  if (typeof style.font === 'string' && fontKeys.length)
    fields.push({
      path: at('font'),
      labelKey: 'font',
      label: 'Font',
      kind: 'select',
      value: style.font,
      options: fontKeys.map((key) => ({ value: key, label: humanize(key) })),
    })
  if (typeof style.weight === 'number')
    fields.push({
      path: at('weight'),
      labelKey: 'weight',
      label: 'Weight',
      kind: 'select',
      value: String(style.weight),
      options: WEIGHTS,
    })
  if (typeof style.size === 'number')
    fields.push({
      path: at('size'),
      labelKey: 'size',
      label: 'Size',
      kind: 'number',
      value: style.size,
      min: 8,
      max: 400,
      step: 1,
    })
  if (typeof style.color === 'string')
    fields.push({
      path: at('color'),
      labelKey: 'color',
      label: 'Colour',
      kind: 'color',
      value: style.color,
    })
  if (isObject(style.box) && typeof style.box.color === 'string')
    fields.push({
      path: at('box.color'),
      labelKey: 'boxColor',
      label: 'Box colour',
      kind: 'color',
      value: style.box.color,
    })
  if (typeof style.highlightColor === 'string')
    fields.push({
      path: at('highlightColor'),
      labelKey: 'highlightColor',
      label: 'Highlight',
      kind: 'color',
      value: style.highlightColor,
    })
  return fields
}

function preferenceFields(preferences: Json): KitField[] {
  const fields: KitField[] = []
  for (const [key, pref] of Object.entries(preferences)) {
    if (!isObject(pref) || typeof pref.on !== 'boolean') continue
    fields.push({
      path: `preferences.${key}.on`,
      labelKey: null,
      label: PREFERENCE_NAMES[key] ?? humanize(key),
      kind: 'toggle',
      value: pref.on,
    })
    if (key === 'brandColors' && Array.isArray(pref.colors))
      pref.colors.forEach((color, i) => {
        if (isObject(color) && typeof color.hex === 'string')
          fields.push({
            path: `preferences.brandColors.colors.${i}.hex`,
            labelKey: null,
            label: typeof color.job === 'string' && color.job ? color.job : `Colour ${i + 1}`,
            kind: 'color',
            value: color.hex,
          })
      })
  }
  return fields
}

/** The editable groups of a kit, empty groups left out. */
export function kitFieldGroups(kit: Json): KitFieldGroup[] {
  const fonts = isObject(kit.fonts) ? kit.fonts : {}
  const fontKeys = Object.keys(fonts)
  const groups: KitFieldGroup[] = [
    {
      id: 'fonts',
      titleKey: 'fonts',
      title: 'Fonts',
      fields: fontKeys.flatMap((key) => {
        const font = fonts[key]
        const field = isObject(font) ? fontField(key, font) : null
        return field ? [field] : []
      }),
    },
    ...SECTIONS.map(({ id, title }) => {
      const section = kit[id]
      const style = isObject(section) && isObject(section.style) ? section.style : null
      return { id, titleKey: id, title, fields: style ? styleFields(id, style, fontKeys) : [] }
    }),
    {
      id: 'preferences',
      titleKey: 'preferences',
      title: 'Editing preferences',
      fields: isObject(kit.preferences) ? preferenceFields(kit.preferences) : [],
    },
  ]
  return groups.filter((group) => group.fields.length > 0)
}

/**
 * A value as `shred kit set` takes it: text as is, everything else as JSON.
 * The kit field's own type decides how it is read back ("700" sets weight 700).
 */
export const kitValueText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value)
