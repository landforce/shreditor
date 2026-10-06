// Creator kit -> Shreditor: the kit's titles, captions and overlays as project
// text styles (`kit:*` ids), and back (save-back reads a style into kit
// values). Pixel values are the kit's own at its canvas; a style variant's
// lengths are pixels on the aspect's reference canvas (short side 1080), so a
// 1080x1920 kit maps one to one. Positions become layout ratios of the canvas.
//
// Anchors (kit `anchors`): `top` puts the box's top edge (padding and outline
// included) at y and the text grows down; `bottom` puts its bottom edge at y
// and the text grows up; `center` centres it on y; `free` is chosen per shot
// (the style starts centred on y). The text box is the item's transform box,
// so the kit's `x`/`width` are its left edge and width, and its padding is the
// box padding plus the outline width.
import { cloneTextStyleVariant } from '../../src/shared/typography/text-styles/text-style-family.mjs'
import { kitAspect, kitSectionFor } from './kit.mjs'

const WEIGHT_NAMES = Object.freeze({ 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold' })
const WEIGHT_NUMBERS = Object.freeze({ normal: 400, medium: 500, semibold: 600, bold: 700 })

/** Kit weight (400/500/600/700) -> text item fontWeight. */
export function fontWeightFromKit(weight) {
  return WEIGHT_NAMES[weight] ?? 'normal'
}

/** Text item fontWeight -> kit weight. */
export function kitWeightFromFontWeight(name) {
  return WEIGHT_NUMBERS[name] ?? 400
}

const VERTICAL_ALIGN = { top: 'top', bottom: 'bottom', center: 'middle', free: 'middle' }

/** How the text sits in its box for an anchor: top grows down, bottom grows up. */
function verticalAlignForAnchor(anchor) {
  return VERTICAL_ALIGN[anchor] ?? 'middle'
}

const round6 = (value) => Math.round(value * 1e6) / 1e6

/** Top edge of a box of `height` placed by `anchor` at `y`. */
function boxTop(anchor, y, height) {
  if (anchor === 'top') return y
  if (anchor === 'bottom') return y - height
  return y - height / 2
}

/**
 * A kit box (anchor, y, x, width, height in canvas pixels) as layout ratios:
 * the box centre's offset from the canvas centre (+y down) and its size.
 */
export function anchorBoxToLayout({ anchor, x, width, y, height }, canvas) {
  const top = boxTop(anchor, y, height)
  return {
    xRatio: round6((x + width / 2 - canvas.width / 2) / canvas.width),
    yRatio: round6((top + height / 2 - canvas.height / 2) / canvas.height),
    widthRatio: round6(width / canvas.width),
    heightRatio: round6(height / canvas.height),
  }
}

/** Layout ratios back to a kit box: left edge, width and the anchor's y, in whole pixels. */
export function layoutToAnchorBox(layout, anchor, canvas) {
  const width = (layout.widthRatio ?? 1) * canvas.width
  const height = (layout.heightRatio ?? 0) * canvas.height
  const centreX = ((layout.xRatio ?? 0) + 0.5) * canvas.width
  const centreY = ((layout.yRatio ?? 0) + 0.5) * canvas.height
  const y =
    anchor === 'top' ? centreY - height / 2 : anchor === 'bottom' ? centreY + height / 2 : centreY
  return { x: Math.round(centreX - width / 2), width: Math.round(width), y: Math.round(y) }
}

const outlineWidth = (style) => (style.outline ? Number(style.outline.width) || 0 : 0)

/** Box padding: the kit box's padding plus the outline, which the kit's box includes. */
function paddingOf(style) {
  const outline = outlineWidth(style)
  return {
    x: (style.box ? Number(style.box.padX) || 0 : 0) + outline,
    y: (style.box ? Number(style.box.padY) || 0 : 0) + outline,
  }
}

function paddingFields(style) {
  const pad = paddingOf(style)
  if (pad.x === pad.y) return { textPadding: pad.x }
  return { textPadding: pad.y, textPaddingX: pad.x, textPaddingY: pad.y }
}

function boxFields(box) {
  if (!box) return {}
  return {
    backgroundColor: box.color,
    backgroundRadius: Number(box.radius) || 0,
    backgroundMode: box.perLine ? 'lines' : 'text',
  }
}

function strokeFields(outline) {
  if (!outline) return {}
  return { stroke: { width: Number(outline.width) || 0, color: outline.color, join: 'round' } }
}

/** A kit text style as a style look (every field a style controls). */
function kitLook(style, placement, familyFor) {
  return {
    fontFamily: familyFor(style.font),
    fontWeight: fontWeightFromKit(style.weight),
    fontStyle: 'normal',
    underline: false,
    fontSize: style.size,
    color: style.color,
    letterSpacing: Number(style.letterSpacing) || 0,
    lineHeight: Number(style.lineHeight) || 1.2,
    textAlign: placement.align ?? 'center',
    verticalAlign: verticalAlignForAnchor(placement.anchor),
    ...boxFields(style.box),
    ...paddingFields(style),
    ...strokeFields(style.outline),
  }
}

/**
 * Height of the text box: the section's most lines at its size, plus padding
 * and the outline (as the renderer measures it). A top- or bottom-anchored box
 * with a zone reaches to the zone's far edge, so extra lines grow away from
 * the anchor instead of around the middle.
 */
function boxHeightFor(section, look, placement, maxLines) {
  const pad = paddingOf(section.style)
  const stroke = outlineWidth(section.style)
  const content = maxLines * look.fontSize * look.lineHeight + pad.y * 2 + stroke * 2
  const zone = placement.zone
  if (!Array.isArray(zone)) return content
  if (placement.anchor === 'top') return Math.max(content, zone[1] - placement.y)
  if (placement.anchor === 'bottom') return Math.max(content, placement.y - zone[0])
  return content
}

function variantFor(aspect, section, placement, familyFor, { maxLines, canvas }) {
  const look = kitLook(section.style, placement, familyFor)
  const height = boxHeightFor(section, look, placement, maxLines)
  const layout = anchorBoxToLayout({ ...placement, height }, canvas)
  return { aspect, style: look, layout }
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/** Most lines a title takes: its maxLines rule, else 3. */
function titleMaxLines(section) {
  const rule = (section.must ?? []).find((entry) => entry?.check?.type === 'maxLines')
  return isNumber(rule?.check?.value) ? rule.check.value : 3
}

function overlayMaxLines(section) {
  const counts = [section.oneShot?.lines, section.tenShot?.lines]
    .map((lines) => (Array.isArray(lines) ? lines[1] : lines))
    .filter(isNumber)
  return counts.length ? Math.max(...counts) : 2
}

const wordsMax = (words) => (Array.isArray(words) ? words[words.length - 1] : words)

/**
 * Caption chunking: the kit's most words per chunk and lines, characters per
 * line from the text width at the caption size (a bold sans averages about
 * 0.55 of the size per character), held at least 0.3 s at 30 fps.
 */
function kitCaptionRules(section, look) {
  const chunking = section.chunking ?? {}
  const pad = paddingOf(section.style)
  const textWidth = section.placement.width - pad.x * 2
  return {
    maxWordsPerChunk: Math.max(1, Math.round(wordsMax(chunking.wordsPerChunk) ?? 3)),
    maxCharsPerLine: Math.max(4, Math.floor(textWidth / (look.fontSize * 0.55))),
    maxLines: Math.max(1, Math.round(chunking.lines ?? 2)),
    minChunkFrames: 9,
    case: 'as-is',
    punctuation: 'keep',
  }
}

const FROM_KIT = (kit) => `From the creator kit${kit.creator ? ` (${kit.creator})` : ''}.`

function describe(kit, ...notes) {
  return [FROM_KIT(kit), ...notes, 'Change the kit, not this style: shred kit apply.']
    .filter(Boolean)
    .join(' ')
    .slice(0, 500)
}

/** Style specs: id, name, role, the section and how to place it. */
function titleSpecs(kit) {
  const style = kit.titles.style
  const small =
    isNumber(style.sizeSmall) && style.sizeSmallWhen?.linesOver
      ? `Size ${style.size}px; use ${style.sizeSmall}px when it wraps past ${style.sizeSmallWhen.linesOver} lines.`
      : ''
  return [
    {
      id: 'kit:title',
      name: 'Kit title',
      role: 'title',
      section: 'titles',
      description: describe(kit, small),
      defaultDurationFrames: 90,
      placement: (section) => section.placement,
      maxLines: titleMaxLines,
    },
    {
      id: 'kit:emphasis',
      name: 'Kit emphasis label',
      role: 'label',
      section: 'titles',
      description: describe(kit, 'A one- or two-word emphasis label in the title style.'),
      // Placed per shot: it starts centred on the canvas.
      placement: (section, canvas) => ({
        ...section.placement,
        anchor: 'center',
        y: canvas.height / 2,
        zone: undefined,
      }),
      maxLines: () => 1,
    },
  ]
}

const POSITION_IDS = { belowChin: 'kit:caption-low' }
const POSITION_NAMES = { belowChin: 'Kit caption (below chin)' }

const slug = (text) =>
  String(text)
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function captionSpec(kit, name, position, isDefault) {
  return {
    id: isDefault ? 'kit:caption' : (POSITION_IDS[name] ?? `kit:caption-${slug(name)}`),
    name: isDefault ? 'Kit caption' : (POSITION_NAMES[name] ?? `Kit caption (${name})`),
    role: 'caption',
    section: 'captions',
    position: name,
    description: describe(kit, position.when ? `${name}: ${position.when}` : ''),
    placement: (section) => {
      const { positions: _positions, default: _default, ...rest } = section.placement
      return { ...rest, y: section.placement.positions?.[name]?.y ?? position.y }
    },
    maxLines: (section) => Math.max(1, Math.round(section.chunking?.lines ?? 2)),
    caption: true,
  }
}

function captionSpecs(kit) {
  const placement = kit.captions.placement
  const positions = placement.positions ?? { default: { y: placement.y } }
  const chosen = placement.default ?? Object.keys(positions)[0]
  return Object.entries(positions).map(([name, position]) =>
    captionSpec(kit, name, position, name === chosen),
  )
}

function overlaySpecs(kit) {
  const specs = [
    {
      id: 'kit:overlay',
      name: 'Kit overlay',
      role: 'label',
      section: 'overlays',
      description: describe(
        kit,
        'On-screen text: centred, moved only as far as needed to keep the subject visible.',
      ),
      placement: (section) => section.placement,
      maxLines: overlayMaxLines,
    },
  ]
  if (kit.overlays.listicle) specs.push(listicleSpec(kit))
  return specs
}

function listicleSpec(kit) {
  return {
    id: 'kit:listicle-headline',
    name: 'Kit listicle headline',
    role: 'label',
    section: 'overlays',
    description: describe(
      kit,
      'The headline right before a numbered list, one left-aligned block.',
    ),
    restyle: (section) => ({
      ...section,
      style: {
        ...section.style,
        size: section.listicle.headlineSize ?? section.style.size,
        weight: section.listicle.headlineWeight ?? section.style.weight,
      },
    }),
    placement: (section) => ({
      ...section.placement,
      align: section.listicle.align ?? section.placement.align,
      x: section.listicle.x ?? section.placement.x,
      width: section.listicle.width ?? section.placement.width,
    }),
    maxLines: () => 2,
  }
}

/** Every text style the kit defines, as specs (see kitTextStyles). */
export function kitStyleSpecs(kit) {
  return [...titleSpecs(kit), ...captionSpecs(kit), ...overlaySpecs(kit)]
}

function specVariant(spec, kit, aspect, familyFor) {
  const view = kitSectionFor(kit, spec.section, aspect)
  if (!view) return undefined
  const section = spec.restyle ? spec.restyle(view.section) : view.section
  const placement = spec.placement(section, view.canvas)
  const variant = variantFor(aspect, section, placement, familyFor, {
    maxLines: spec.maxLines(section),
    canvas: view.canvas,
  })
  return spec.caption
    ? { ...variant, caption: kitCaptionRules({ ...section, placement }, variant.style) }
    : variant
}

/**
 * The kit's text styles in the style family shape (no version or time yet):
 * the kit canvas's aspect from the kit, and 16:9 from the section's
 * `variants["16:9"]` when it has one, else cloned from the vertical look the
 * way the editor's "Make a 16:9 version" does.
 */
export function kitTextStyles(kit, { familyFor }) {
  const own = kitAspect(kit)
  return kitStyleSpecs(kit).map((spec) => {
    const base = specVariant(spec, kit, own, familyFor)
    const landscape =
      own === '16:9'
        ? undefined
        : (specVariant(spec, kit, '16:9', familyFor) ?? cloneTextStyleVariant(base, '16:9'))
    return {
      id: spec.id,
      name: spec.name,
      role: spec.role,
      description: spec.description,
      ...(spec.defaultDurationFrames ? { defaultDurationFrames: spec.defaultDurationFrames } : {}),
      variants: landscape ? [base, landscape] : [base],
    }
  })
}

/** Which kit section and caption position a `kit:*` style comes from. */
export function kitStyleSource(kit, styleId) {
  const spec = kitStyleSpecs(kit).find((entry) => entry.id === styleId)
  return spec ? { section: spec.section, position: spec.position, spec } : undefined
}
