// Video Style Kit in words: its editing preferences for the agent's plan, what
// `shred kit apply` maps and what it can't (and why), the format targets a
// kit preference replaces, and a readable summary of a kit.
import { kitStyleSpecs } from './mapping.mjs'

const on = (pref) => Boolean(pref?.on)
const range = (pair, unit = '') =>
  Array.isArray(pair) ? `${pair[0]}-${pair[1]}${unit}` : `${pair}${unit}`

const PREFERENCE_TEXT = {
  punchIns: (p) =>
    on(p)
      ? `Punch-ins: on ${p.when ?? 'emphasis'}, scale ${range(p.scale, 'x')}${p.maxPerMinute ? `, at most ${p.maxPerMinute} a minute` : ''}.`
      : 'Punch-ins: off.',
  tightCuts: (p) =>
    on(p)
      ? `Tight cuts: no pause over ${p.maxPauseMs} ms${p.cutBreaths ? ', breaths cut' : ''}${p.paddingFrames ? `, ${p.paddingFrames} frames of padding at each cut` : ''} (this replaces the format's pause target in shred check).`
      : `Tight cuts: off; pauses up to ${p?.offMaxPauseMs ?? 800} ms are fine (the pause target in shred check).`,
  alternateSides: (p) =>
    on(p)
      ? 'Alternate sides: the speaker (and what sits beside them) switches side shot to shot.'
      : 'Alternate sides: off.',
  sfx: (p) =>
    on(p)
      ? `Sound effects: on, from ${p.source || 'the creator\u2019s library'}, peaking ${p.levelDb} dB below the voice's peak (clip volume ${p.levelDb} dB with the voice at 0 dB).`
      : 'Sound effects: none.',
  musicBed: (p) =>
    on(p)
      ? `Music bed: on, from ${p.source || 'the creator\u2019s library'}: ${p.levelDb} dB under the voice in gaps, ${p.levelDb + (p.duckDb ?? 0)} dB while the voice speaks. In Shreditor: the music clip's volume ${p.levelDb} dB (voice at 0 dB) and, on each voice/speaker clip, audioDucking { duckOthersDb: ${p.duckDb ?? 0}, targetTrackIds: [the music track] }.`
      : 'Music bed: none.',
  brandColors: (p) =>
    on(p) && p.colors?.length
      ? `Brand colours: ${p.colors.map((c) => `${c.hex}${c.job ? ` (${c.job})` : ''}`).join(', ')}.`
      : 'Brand colours: off.',
}

/** The kit's preferences as plain sentences, known ones first, others named. */
export function describePreferences(preferences = {}) {
  return Object.entries(preferences).map(([key, value]) =>
    PREFERENCE_TEXT[key] ? PREFERENCE_TEXT[key](value) : `${key}: ${JSON.stringify(value)}`,
  )
}

/**
 * Format targets the kit's preferences replace, by target key, in the
 * scorecard's target shape: tightCuts sets the longest pause in speech.
 */
export function kitTargetOverrides(kit) {
  const cuts = kit?.preferences?.tightCuts
  if (!cuts) return {}
  const ms = on(cuts) ? cuts.maxPauseMs : cuts.offMaxPauseMs
  if (typeof ms !== 'number') return {}
  return {
    pauseMaxSec: {
      max: ms / 1000,
      source: 'kit',
      note: `Video Style Kit tightCuts ${on(cuts) ? 'on' : 'off'}: ${ms} ms`,
    },
  }
}

/**
 * The kit's reference frames as a list: { format, name, path, placeholder }.
 * Takes both forms: a path string (placeholder unknown: null) and
 * { path, placeholder }; lists of either (greenscreen plates) are flattened.
 */
export function kitReferenceFrames(kit) {
  return Object.entries(kit?.referenceFrames ?? {})
    .filter(([format]) => format !== 'note')
    .flatMap(([format, value]) => framesOf(format, '', value))
}

const frameEntry = (format, name, path, placeholder) => ({ format, name, path, placeholder })

/** The frames one referenceFrames value holds: a path, { path, placeholder }, a list or a map. */
function framesOf(format, name, value) {
  if (typeof value === 'string') return [frameEntry(format, name, value, null)]
  if (!value || typeof value !== 'object') return []
  if (typeof value.path === 'string')
    return [frameEntry(format, name, value.path, value.placeholder ?? null)]
  if (Array.isArray(value))
    return value.flatMap((entry, index) => framesOf(format, `${name}[${index}]`, entry))
  return Object.entries(value).flatMap(([key, entry]) =>
    framesOf(format, name ? `${name}.${key}` : key, entry),
  )
}

/**
 * Reference frames in words: the real ones to compare against, placeholders
 * named as such. `folder` (the kit's) makes relative paths whole.
 */
export function describeReferenceFrames(kit, folder) {
  return kitReferenceFrames(kit).map((frame) => {
    const where = folder && !frame.path.startsWith('/') ? `${folder}/${frame.path}` : frame.path
    const label = `${frame.format}${frame.name ? ` ${frame.name}` : ''}: ${where}`
    if (frame.placeholder === true) return `${label} (placeholder: don't compare against it)`
    if (frame.placeholder === false)
      return `${label} (the creator's frame: compare your frames against it)`
    return `${label} (not marked; ask whether it is the creator's own before comparing)`
  })
}

/** The brand colours to offer as swatches, when the kit turns them on. */
export function kitBrandColors(kit) {
  const brand = kit?.preferences?.brandColors
  if (!on(brand) || !Array.isArray(brand.colors)) return []
  return brand.colors
    .filter((color) => /^#[0-9A-Fa-f]{6}$/.test(color?.hex ?? ''))
    .map((color) => ({ hex: color.hex, ...(color.job ? { job: String(color.job) } : {}) }))
}

const px = (value) => (typeof value === 'number' ? `${value}px` : '-')

function lookLine(style) {
  const box = style.box
    ? `, ${style.box.color} ${style.box.perLine ? 'bar behind each line' : 'box'} (pad ${style.box.padX}x${style.box.padY}, radius ${style.box.radius ?? 0})`
    : ''
  const outline = style.outline ? `, ${style.outline.width}px ${style.outline.color} outline` : ''
  return `${style.font} ${style.weight} ${px(style.size)} ${style.color}${box}${outline}`
}

function placementLine(placement) {
  const where = placement.positions
    ? Object.entries(placement.positions)
        .map(([name, pos]) => `${name} y=${pos.y}${name === placement.default ? ' (default)' : ''}`)
        .join(', ')
    : `y=${placement.y}`
  return `anchor ${placement.anchor}, x ${placement.x} width ${placement.width}, ${where}${placement.zone ? `, zone ${range(placement.zone)}` : ''}`
}

/** What became of each kit section: mapped to styles, or checked only, or not used. */
export function describeMapping(kit) {
  const specs = kitStyleSpecs(kit)
  const ids = (section) => specs.filter((s) => s.section === section).map((s) => s.id)
  const mapped = []
  for (const section of ['titles', 'captions', 'overlays']) {
    const s = kit[section]
    mapped.push(
      `${section}: ${lookLine(s.style)}; ${placementLine(s.placement)} -> ${ids(section).join(', ')}`,
    )
  }
  return { mapped, unmapped: unmappedNotes(kit) }
}

const isCut = (motion) =>
  !motion || ((motion.in ?? 'cut') === 'cut' && (motion.out ?? 'cut') === 'cut')

const TEXT_SECTIONS = ['titles', 'captions', 'overlays']

function sizeSmallNote(kit) {
  const title = kit.titles.style
  if (!title.sizeSmall) return []
  const over = title.sizeSmallWhen?.linesOver ?? '?'
  return [
    `titles.sizeSmall (${title.sizeSmall}px past ${over} lines): not automatic; noted in kit:title's description and the title.max-lines check. Set fontSize ${title.sizeSmall} on a long title.`,
  ]
}

function tiltNotes(kit) {
  return TEXT_SECTIONS.filter((section) => kit[section].style.tiltDeg).map(
    (section) =>
      `${section}.style.tiltDeg: a style has no tilt; rotate the item (${kit[section].style.tiltDeg} deg).`,
  )
}

function motionNotes(kit) {
  return TEXT_SECTIONS.filter((section) => !isCut(kit[section].motion)).map(
    (section) =>
      `${section}.motion: only cut in/out maps (styles get no text motion); add the animation by hand.`,
  )
}

/** `breakOn` values the caption rules map (phrase -> phrase, pause and words -> words). */
const KNOWN_BREAK_ON = new Set(['phrase', 'pause', 'words'])

function captionNotes(kit) {
  const chunking = kit.captions.chunking ?? {}
  const notes = []
  if (chunking.breakOn && !KNOWN_BREAK_ON.has(chunking.breakOn))
    notes.push(
      `captions.chunking.breakOn "${chunking.breakOn}": unknown; captions break by phrase (the kit can say "phrase", "pause" or "words").`,
    )
  if (chunking.highlightWords || kit.captions.style.highlightColor)
    notes.push('captions highlight words: not supported by caption styles; colour words by hand.')
  return notes
}

const nudgeNote = (kit) =>
  kit.overlays.placement?.nudgeToClearSubject
    ? [
        'overlays.nudgeToClearSubject: per shot, by you (look at the frame); the overlay.middle check reports how far each moved.',
      ]
    : []

function imageNote(kit) {
  const image = kit.images?.options?.[kit.images?.placement]
  if (!image?.rect) return []
  const { x, y, w, h } = image.rect
  const radius = image.radius ? `, radius ${image.radius}` : ''
  return [
    `images: not a text style. Placement "${kit.images.placement}" = rect ${x},${y} ${w}x${h}, ${image.fit}${radius}; set it with setTransform. shred check measures one placement per video.`,
  ]
}

const greenscreenNote = (kit) =>
  kit.greenscreen
    ? [
        'greenscreen: speaker scale/side and the plate key content are placed by you; shred check measures plates filling the canvas and hard cuts.',
      ]
    : []

function objectsNote(kit) {
  if (!kit.objects) return []
  const placement = kit.objects.placement ?? {}
  return [
    `objects: generated outside Shreditor with the "${kit.objects.style}" locked prompt; place them with setTransform (${range(placement.sizePx ?? '-', 'px')}, at most ${placement.maxOnScreen ?? '?'} on screen).`,
  ]
}

const framesNote = (kit) =>
  kit.referenceFrames
    ? [
        'referenceFrames: not used by Shreditor itself; compare your frames by eye against the real ones (never the placeholders), listed under Reference frames.',
      ]
    : []

const UNMAPPED = [
  sizeSmallNote,
  tiltNotes,
  motionNotes,
  captionNotes,
  nudgeNote,
  imageNote,
  greenscreenNote,
  objectsNote,
  framesNote,
]

function unmappedNotes(kit) {
  return UNMAPPED.flatMap((note) => note(kit))
}

/** A readable summary of a kit (shred kit show). */
export function summarizeKit(kit) {
  const lines = [
    `${kit.creator ?? 'Video Style Kit'} v${kit.kitVersion}  (schema ${kit.schemaVersion}, canvas ${kit.canvas.join('x')}${kit.updatedAt ? `, updated ${kit.updatedAt}` : ''})`,
    '',
    'Fonts',
    ...Object.entries(kit.fonts).map(
      ([name, font]) =>
        `  ${name}: ${font.stack.join(', ')}  (weights ${(font.weights ?? []).join('/')})`,
    ),
    '',
  ]
  for (const section of ['titles', 'captions', 'overlays']) {
    const s = kit[section]
    lines.push(`${section}: ${lookLine(s.style)}`, `  ${placementLine(s.placement)}`)
  }
  lines.push('', 'Rules (must)')
  for (const section of ['titles', 'captions', 'overlays', 'images', 'greenscreen', 'objects'])
    for (const rule of kit[section]?.must ?? [])
      lines.push(
        `  ${rule.id.padEnd(28)} ${rule.check.type}${rule.check.judgment ? ` (${rule.check.judgment})` : ''}  ${rule.text}`,
      )
  lines.push('', 'Preferences', ...describePreferences(kit.preferences).map((line) => `  ${line}`))
  const frames = describeReferenceFrames(kit)
  if (frames.length) lines.push('', 'Reference frames', ...frames.map((line) => `  ${line}`))
  const changes = (kit.changelog ?? []).slice(-3)
  if (changes.length)
    lines.push(
      '',
      'Latest changes',
      ...changes.map((c) => `  ${c.version} ${c.date}: ${c.change}${c.why ? ` (${c.why})` : ''}`),
    )
  return lines
}
