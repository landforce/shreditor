// Native export planner: decides, per timeline item, what the system ffmpeg can
// render faithfully from the ORIGINAL media and what the browser renderer must
// draw as a transparent overlay, then builds the ffmpeg command that
// composites both. Pure (no I/O): every input is passed in, so the rules are
// unit-tested in headless/native-plan.test.mjs.
//
// The semantics mirrored here (each rule cites the code it follows):
// - Paint order: tracks sorted by `order` descending, so the lowest order is on
//   top (timeline-to-composition.ts, scene-assembly resolveTrackRenderState).
// - Visibility: any solo track hides every non-solo track; otherwise
//   `visible !== false`. Layer groups pass hide/solo/mute to their children.
// - Duration: max item end over ALL items, at least one second of frames.
// - Source frame for timeline frame f (resolveVideoRenderSourceTimeSeconds):
//   t = sourceStart / sourceFps + (f - from) / fps * speed, nudged by 1e-4 of a
//   source frame when it lands on a frame boundary; the decoder shows the
//   frame whose timestamp is <= t.
// - Geometry (transform-resolver.ts, media-draw.ts, media-crop.ts): the item box
//   is transform width/height or the source contain-fitted into the canvas,
//   x/y offset from the canvas centre; the decoded frame is contain-fitted
//   inside the box; crop cuts inside that rect.
// - Audio (canvas-audio.ts processAudio): per segment gain 10^(dB/20) with
//   track gain added in dB, linear fades of floor(seconds * rate) samples at the
//   clip's start and end, 48 kHz stereo (mono duplicated), summed, then tanh soft
//   clip of samples above 1.0, then master bus gain.
//
// Complexity is scored without coverage data; every function in this file is
// covered by headless/native-plan.test.mjs.
// fallow-ignore-file complexity

const NATIVE_CODECS = ['h264', 'hevc', 'prores']

const QUALITY_CRF = {
  h264: { low: 23, medium: 20, high: 17, ultra: 14 },
  hevc: { low: 26, medium: 23, high: 20, ultra: 16 },
}
const AAC_BITRATE = { low: '160k', medium: '192k', high: '256k', ultra: '320k' }
const OUTPUT_RATE = 48_000
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])
const WIDE_PRIMARIES = new Set(['bt2020'])
const SDR_TRANSFERS = new Set([
  undefined,
  'unknown',
  'bt709',
  'smpte170m',
  'bt470bg',
  'bt470m',
  'iec61966-2-1',
  'gamma22',
  'bt601',
])

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

const gcd = (a, b) => {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) [x, y] = [y, x % y]
  return x || 1
}

/** A frame rate as an exact rational ({num, den}); NTSC rates from their decimals. */
export function rateToRational(value) {
  if (typeof value === 'string' && value.includes('/')) {
    const [n, d] = value.split('/').map(Number)
    if (Number.isInteger(n) && Number.isInteger(d) && n > 0 && d > 0) {
      const g = gcd(n, d)
      return { num: n / g, den: d / g }
    }
    return null
  }
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return null
  if (Number.isInteger(v)) return { num: v, den: 1 }
  for (const base of [24, 30, 48, 60, 120, 240]) {
    if (Math.abs(v - (base * 1000) / 1001) < 0.006) return { num: base * 1000, den: 1001 }
  }
  for (const den of [2, 4, 5, 8, 10, 100, 1000]) {
    const num = Math.round(v * den)
    if (Math.abs(num / den - v) < 1e-9) {
      const g = gcd(num, den)
      return { num: num / g, den: den / g }
    }
  }
  return null
}

/** Playback speed as an exact rational, or null when it has more than 4 decimals. */
function speedToRational(speed) {
  const den = 10_000
  const num = Math.round(speed * den)
  if (num <= 0 || Math.abs(num / den - speed) > 1e-12) return null
  const g = gcd(num, den)
  return { num: num / g, den: den / g }
}

const rationalValue = (r) => r.num / r.den
const ratioString = (r) => `${r.num}/${r.den}`

function parseHexColor(color) {
  if (typeof color !== 'string') return color === undefined ? '000000' : null
  const named = { black: '000000', white: 'ffffff' }[color.trim().toLowerCase()]
  if (named) return named
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return hex.toLowerCase()
}

// ---------------------------------------------------------------------------
// Timeline facts
// ---------------------------------------------------------------------------

/** Layer groups pass hide/mute/solo to their child tracks (group-utils resolveEffectiveTrackStates). */
function effectiveTracks(tracks) {
  const groups = new Map(tracks.filter((t) => t.isGroup).map((t) => [t.id, t]))
  return tracks
    .filter((t) => !t.isGroup)
    .map((t) => {
      const g = t.parentTrackId ? groups.get(t.parentTrackId) : undefined
      if (!g) return t
      return {
        ...t,
        muted: t.muted || g.muted,
        visible: t.visible !== false && g.visible !== false,
        solo: t.solo || g.solo,
      }
    })
}

function projectDurationFrames(items, fps) {
  const maxEnd = items.length ? Math.max(...items.map((i) => i.from + i.durationInFrames)) : fps * 10
  return Math.max(maxEnd, fps)
}

const keyframedIds = (keyframes) =>
  new Set(
    (keyframes ?? [])
      .filter((k) => (k.properties ?? []).some((p) => (p.keyframes ?? []).length > 0))
      .map((k) => k.itemId),
  )

const isTranscriptSubtitle = (item) => item.type === 'subtitle' && item.source?.type === 'transcript'

/**
 * Project-wide reasons every visual item must be drawn by the browser: these
 * features read pixels across layers, so a layer cannot be rendered alone.
 */
function globalVisualReasons(items, visibleTrackIds) {
  const visible = items.filter((i) => visibleTrackIds.has(i.trackId))
  const reasons = []
  if (visible.some((i) => i.type === 'shape' && i.isMask))
    reasons.push('a mask shape clips the layers below it')
  if (visible.some((i) => i.type === 'adjustment'))
    reasons.push('an adjustment layer applies effects across layers')
  if (visible.some((i) => i.blendMode && i.blendMode !== 'normal'))
    reasons.push('a blend mode reads the layers below it')
  if (items.some((i) => i.transformParent?.parentItemId))
    reasons.push('transform parenting links layers')
  if (items.some((i) => i.transcriptCaptions?.enabled))
    reasons.push('transcript captions add a generated caption track')
  return reasons
}

// ---------------------------------------------------------------------------
// Media facts (ffprobe JSON of the ORIGINAL file)
// ---------------------------------------------------------------------------

function videoStream(probe) {
  return probe?.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
}

function audioStream(probe) {
  return probe?.streams?.find((s) => s.codec_type === 'audio')
}

const streamRotation = (stream) =>
  Number(
    stream?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
      stream?.tags?.rotate ??
      0,
  )

const PIX_ALPHA = /^(yuva|gbrap|rgba|bgra|argb|abgr|ya\d)/

function pixBitDepth(stream) {
  const raw = Number(stream?.bits_per_raw_sample)
  if (Number.isFinite(raw) && raw > 0) return raw
  const m = /p(\d+)(le|be)$/.exec(stream?.pix_fmt ?? '')
  return m ? Number(m[1]) : 8
}

const MATRIX_BY_SPACE = {
  bt709: 'bt709',
  bt470bg: 'bt601',
  smpte170m: 'bt601',
  bt2020nc: 'bt2020',
  bt2020c: 'bt2020',
}

/** Colour handling for one source: the matrix/range ffmpeg converts from. */
function sourceColor(stream) {
  const { color_transfer: transfer, color_primaries: primaries, color_space: space } = stream
  const pixFmt = stream.pix_fmt ?? ''
  const matrix = MATRIX_BY_SPACE[space] ?? (stream.height >= 720 ? 'bt709' : 'bt601')
  return {
    // A BT.2020 matrix with no transfer tag is as likely HLG/PQ as SDR: refuse it too.
    hdr: HDR_TRANSFERS.has(transfer) || WIDE_PRIMARIES.has(primaries) || matrix === 'bt2020',
    sdrKnown: SDR_TRANSFERS.has(transfer),
    matrix,
    range: stream.color_range === 'pc' || /^yuvj/.test(pixFmt) ? 'full' : 'limited',
    rgb: /^(gbr|rgb|bgr|argb|abgr)/.test(pixFmt),
    tags: { primaries, transfer, space, range: stream.color_range },
  }
}

/** CFR facts the frame mapping relies on, or a reason it cannot. */
function cfrFacts(stream) {
  const r = rateToRational(stream?.r_frame_rate)
  const avg = rateToRational(stream?.avg_frame_rate)
  if (!r) return { reason: 'the source has no usable frame rate' }
  if (!avg || r.num * avg.den !== avg.num * r.den)
    return { reason: `variable frame rate (r ${stream.r_frame_rate}, avg ${stream.avg_frame_rate})` }
  const start = Number(stream.start_time ?? 0)
  if (Math.abs(start) > 0.0005) return { reason: `video starts at ${start}s, not 0` }
  const nb = Number(stream.nb_frames)
  const duration = Number(stream.duration)
  const frames = Number.isFinite(nb) && nb > 0 ? nb : Math.round(duration * rationalValue(r))
  if (!(frames > 0)) return { reason: 'the source frame count is unknown' }
  return { rate: r, frames }
}

// ---------------------------------------------------------------------------
// Frame mapping (mirrors render-span.ts resolveVideoRenderSourceTimeSeconds)
// ---------------------------------------------------------------------------

/** Source frame indices the browser shows for each clip frame (float math as in the browser). */
export function browserSourceFrames(item, fps, rate, sourceFrames) {
  const sourceFps = item.sourceFps ?? fps
  const speed = item.speed ?? 1
  const sourceStart = item.sourceStart ?? item.trimStart ?? item.offset ?? 0
  const frameTime = (i) => (i * rate.den) / rate.num
  const out = new Array(item.durationInFrames)
  for (let k = 0; k < item.durationInFrames; k++) {
    let t = Math.max(0, sourceStart / sourceFps + (k / fps) * speed)
    if (Number.isFinite(item.sourceDuration) && item.sourceDuration > 0)
      t = Math.min(t, (Math.max(0, item.sourceDuration - 1) + 1e-4) / sourceFps)
    const snapped = Math.round(t * sourceFps)
    if (Math.abs(t * sourceFps - snapped) < 1e-6) t = (snapped + 1e-4) / sourceFps
    let i = Math.floor((t * rate.num) / rate.den)
    while (i + 1 < sourceFrames + 1 && frameTime(i + 1) <= t) i++
    while (i > 0 && frameTime(i) > t) i--
    out[k] = i
  }
  return out
}

/**
 * The exact rational ratio R so that frame k shows source frame first + floor(k * R),
 * or null when the browser's sequence does not follow it.
 */
export function frameRatio(sequence, item, fps, rate) {
  const speed = speedToRational(item.speed ?? 1)
  const project = rateToRational(fps)
  if (!speed || !project) return null
  let num = speed.num * rate.num * project.den
  let den = speed.den * rate.den * project.num
  const g = gcd(num, den)
  num /= g
  den /= g
  const first = sequence[0]
  for (let k = 0; k < sequence.length; k++) {
    if (sequence[k] - first !== Math.floor((k * num) / den)) return null
  }
  return { num, den, first }
}

// ---------------------------------------------------------------------------
// Geometry (mirrors transform-resolver.ts + media-draw.ts + media-crop.ts)
// ---------------------------------------------------------------------------

function contained(sw, sh, cw, ch) {
  const s = Math.min(cw / sw, ch / sh)
  return { x: (cw - sw * s) / 2, y: (ch - sh * s) / 2, width: sw * s, height: sh * s }
}

function resolveCrop(crop) {
  const c01 = (v) => (Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0)
  const pair = (a, b) => {
    const total = a + b
    return total <= 0.999 ? [a, b] : [(a * 0.999) / total, (b * 0.999) / total]
  }
  const [left, right] = pair(c01(crop?.left), c01(crop?.right))
  const [top, bottom] = pair(c01(crop?.top), c01(crop?.bottom))
  return { left, right, top, bottom, softness: Number(crop?.softness ?? 0) || 0 }
}

/**
 * Where the browser draws a video item, in canvas pixels: the media rect (float),
 * the clip viewport (integers), and the same rects snapped to whole pixels for ffmpeg.
 */
export function videoGeometry(item, canvas, source) {
  const t = item.transform ?? {}
  const boxSourceW = item.sourceWidth || source.width
  const boxSourceH = item.sourceHeight || source.height
  const fit = contained(boxSourceW, boxSourceH, canvas.width, canvas.height)
  const box = {
    width: t.width ?? fit.width,
    height: t.height ?? fit.height,
    x: t.x ?? 0,
    y: t.y ?? 0,
  }
  const left = canvas.width / 2 + box.x - box.width / 2
  const top = canvas.height / 2 + box.y - box.height / 2
  const crop = resolveCrop(item.crop)
  let media
  if (item.crop?.refit === true) {
    const rw = Math.max(1e-6, 1 - crop.left - crop.right)
    const rh = Math.max(1e-6, 1 - crop.top - crop.bottom)
    const fitted = contained(source.width * rw, source.height * rh, box.width, box.height)
    const s = fitted.width / (source.width * rw)
    media = {
      x: fitted.x - source.width * crop.left * s,
      y: fitted.y - source.height * crop.top * s,
      width: source.width * s,
      height: source.height * s,
    }
  } else {
    media = contained(source.width, source.height, box.width, box.height)
  }
  media = { ...media, x: media.x + left, y: media.y + top }
  const view = {
    x: media.x + media.width * crop.left,
    y: media.y + media.height * crop.top,
    width: Math.max(0, media.width * (1 - crop.left - crop.right)),
    height: Math.max(0, media.height * (1 - crop.top - crop.bottom)),
  }
  const viewport = {
    x: Math.floor(view.x),
    y: Math.floor(view.y),
    width: Math.ceil(view.x + view.width) - Math.floor(view.x),
    height: Math.ceil(view.y + view.height) - Math.floor(view.y),
  }
  const snapped = {
    x: Math.round(media.x),
    y: Math.round(media.y),
    width: Math.max(1, Math.round(media.width)),
    height: Math.max(1, Math.round(media.height)),
  }
  const snapError = Math.max(
    Math.abs(snapped.x - media.x),
    Math.abs(snapped.y - media.y),
    Math.abs(snapped.x + snapped.width - (media.x + media.width)),
    Math.abs(snapped.y + snapped.height - (media.y + media.height)),
  )
  // Visible part of the snapped media: the viewport clip, then the canvas.
  const vx0 = Math.max(snapped.x, viewport.x, 0)
  const vy0 = Math.max(snapped.y, viewport.y, 0)
  const vx1 = Math.min(snapped.x + snapped.width, viewport.x + viewport.width, canvas.width)
  const vy1 = Math.min(snapped.y + snapped.height, viewport.y + viewport.height, canvas.height)
  const visible =
    vx1 > vx0 && vy1 > vy0 ? { x: vx0, y: vy0, width: vx1 - vx0, height: vy1 - vy0 } : null
  return { box, media, viewport, snapped, snapError, visible, crop }
}

// ---------------------------------------------------------------------------
// Classification. Each rule is [test, reason]; an item goes native only when no
// rule matches. Anything not provably equivalent is drawn by the browser.
// ---------------------------------------------------------------------------

const ruleReasons = (rules, subject, ctx) =>
  rules.filter(([test]) => test(subject, ctx)).map(([, r]) => (typeof r === 'function' ? r(subject) : r))

const tf = (item) => item.transform ?? {}
const isKeyframed = (item, ctx) =>
  ctx.keyframed.has(item.id) || Boolean(item.originId && ctx.keyframed.has(item.originId))
const isFlipped = (item) => Boolean(tf(item).flipHorizontal || tf(item).flipVertical)
const hasCrop = (item) => {
  const c = resolveCrop(item.crop)
  return c.left + c.right + c.top + c.bottom > 0
}

/** Item features ffmpeg does not reproduce here (the browser draws these). */
const VIDEO_ITEM_RULES = [
  [(i) => i.effects?.some((e) => e.enabled), 'effects'],
  [isKeyframed, 'keyframes'],
  [(i) => i.motionModifiers?.length || i.motionLayers?.length, 'motion modifiers'],
  [(i) => i.cornerPin, 'corner pin'],
  [(i) => i.blendMode && i.blendMode !== 'normal', (i) => `blend mode ${i.blendMode}`],
  [(i, c) => c.transitionIds.has(i.id), 'in a transition'],
  [(i, c) => c.parentIds.has(i.id) || i.transformParent?.parentItemId, 'transform parenting'],
  [(i) => (i.fadeIn ?? 0) > 0 || (i.fadeOut ?? 0) > 0, 'video fade'],
  [(i) => i.isReversed, 'reversed'],
  [(i) => (tf(i).rotation ?? 0) !== 0, 'rotation'],
  [(i) => (tf(i).cornerRadius ?? 0) > 0, 'corner radius'],
  [(i) => isFlipped(i) && (tf(i).anchorX ?? tf(i).anchorY) !== undefined, 'flip around a custom anchor'],
  [(i) => resolveCrop(i.crop).softness !== 0, 'soft crop'],
  [(i) => isFlipped(i) && hasCrop(i), 'flip with crop'],
  [(i) => !((tf(i).opacity ?? 1) >= 0 && (tf(i).opacity ?? 1) <= 1), 'opacity out of range'],
]

const sarValue = (s) => {
  const [n, d] = String(s.sample_aspect_ratio ?? '1:1').split(':').map(Number)
  return n > 0 && d > 0 ? n / d : 1
}

/** Source properties the frame and pixel mapping does not handle. */
const VIDEO_STREAM_RULES = [
  [(s) => streamRotation(s) % 360 !== 0, (s) => `source rotation metadata (${streamRotation(s)})`],
  // Some encoders write a SAR a hair off 1:1 (e.g. 3133440:3133231); under
  // 0.1% it moves no pixel at these sizes, so it counts as square.
  [(s) => Math.abs(sarValue(s) - 1) > 0.001, (s) => `non-square pixels (${s.sample_aspect_ratio})`],
  [
    (s) => s.field_order && !['progressive', 'unknown'].includes(s.field_order),
    (s) => `interlaced (${s.field_order})`,
  ],
]

function videoNativeReasons(item, ctx) {
  const reasons = ruleReasons(VIDEO_ITEM_RULES, item, ctx)
  const stream = videoStream(ctx.mediaInfo?.probe)
  if (!stream)
    return { reasons: [...reasons, ctx.mediaInfo ? 'no video stream in the original' : 'media not found'] }
  reasons.push(...ruleReasons(VIDEO_STREAM_RULES, stream))
  const cfr = cfrFacts(stream)
  if (cfr.reason) return { reasons: [...reasons, cfr.reason] }
  const sequence = browserSourceFrames(item, ctx.fps, cfr.rate, cfr.frames)
  const ratio = frameRatio(sequence, item, ctx.fps, cfr.rate)
  if (!ratio) reasons.push('source frame mapping is not a constant ratio')
  if (sequence.at(-1) >= cfr.frames) reasons.push('needs frames past the end of the source')
  return {
    reasons,
    stream,
    rate: cfr.rate,
    ratio,
    color: sourceColor(stream),
    alpha: PIX_ALPHA.test(stream.pix_fmt ?? ''),
    bitDepth: pixBitDepth(stream),
  }
}

const sourceAnchor = (i) => i.sourceStart ?? i.trimStart ?? i.offset ?? null
const sameWindow = (a, b) =>
  a.from === b.from &&
  a.durationInFrames === b.durationInFrames &&
  sourceAnchor(a) === sourceAnchor(b) &&
  (a.sourceEnd ?? null) === (b.sourceEnd ?? null) &&
  (a.speed ?? 1) === (b.speed ?? 1)
const unlinked = (a, b) => !a.linkedGroupId && !b.linkedGroupId && !a.originId && !b.originId

/** canvas-audio getLinkedAudioCompanionForExport: linked group, or a legacy identical pair. */
function linkedAudioCompanion(items, video) {
  return items.find(
    (c) =>
      c.type === 'audio' &&
      (video.linkedGroupId
        ? c.linkedGroupId === video.linkedGroupId
        : unlinked(video, c) && Boolean(video.mediaId) && c.mediaId === video.mediaId && sameWindow(c, video)),
  )
}

const EQ_FIELD = /^audioEq/
const hasItemEq = (item) =>
  Object.keys(item).some((k) => EQ_FIELD.test(k) && item[k] !== undefined && item[k] !== false)

/** Clip dynamics (src/shared/utils/audio-dynamics.ts): a stage counts when `enabled: true`. */
const DYNAMICS_FIELDS = ['audioDenoise', 'audioCompressor', 'audioDeEsser', 'audioLimiter']
const hasItemDynamics = (item) => DYNAMICS_FIELDS.some((k) => item[k]?.enabled === true)

/** Project-level audio features the native mix does not reproduce. */
const AUDIO_PROJECT_RULES = [
  [(p) => p.tracks.some((t) => t.solo), 'a solo track'],
  [(p) => (p.timeline.transitions ?? []).length > 0, 'transitions (crossfaded audio)'],
  [(p) => p.timeline.busAudioEq, 'bus EQ'],
]

/** Per clip: `a` is { item, track, stream, ctx }. */
const AUDIO_CLIP_RULES = [
  [(a) => a.item.audioDucking, 'ducking'],
  [(a) => (a.item.speed ?? 1) !== 1, 'speed'],
  [(a) => a.item.isReversed, 'reversed'],
  [(a) => a.item.audioPitchSemitones || a.item.audioPitchCents, 'pitch'],
  [(a) => hasItemEq(a.item) || a.track.audioEq, 'EQ'],
  [(a) => hasItemDynamics(a.item), 'noise reduction / compressor / de-esser / limiter'],
  [(a) => isKeyframed(a.item, a.ctx), 'keyframes'],
  [(a) => (a.item.audioFadeInCurve ?? 0) !== 0 || (a.item.audioFadeOutCurve ?? 0) !== 0, 'curved fades'],
  [(a) => Number(a.stream.channels) > 2, (a) => `${a.stream.channels}-channel source`],
  [(a) => Math.abs(Number(a.stream.start_time ?? 0)) > 0.0005, (a) => `audio starts at ${a.stream.start_time}s`],
  [(a) => !(Number(a.stream.sample_rate) > 0), 'unknown sample rate'],
]

/** Whether the browser mix would play this item's audio at all (extractAudioSegments). */
function isAudible(item, items) {
  if (item.type === 'audio') return Boolean(item.mediaId)
  if (item.type !== 'video') return false
  return Boolean(item.mediaId) && !item.embeddedAudioMuted && !linkedAudioCompanion(items, item)
}

function audioSegment(item, track, stream, ctx) {
  const rate = Number(stream.sample_rate)
  const sourceFps = item.sourceFps ?? ctx.fps
  const startSample = Math.floor((item.from / ctx.fps) * OUTPUT_RATE)
  const endSample = Math.floor(((item.from + item.durationInFrames) / ctx.fps) * OUTPUT_RATE)
  return {
    itemId: item.id,
    mediaId: item.mediaId,
    path: ctx.media[item.mediaId].original,
    streamIndex: stream.index,
    sourceRate: rate,
    channels: Number(stream.channels),
    // First source sample, at the source rate (exact: sourceStart / sourceFps seconds).
    sourceStartSample: Math.round(((item.sourceStart ?? item.trimStart ?? 0) / sourceFps) * rate),
    startSample,
    lengthSamples: endSample - startSample,
    gainDb: (item.volume ?? 0) + (track.volume ?? 0),
    fadeInSamples: Math.floor((item.audioFadeIn ?? 0) * OUTPUT_RATE),
    fadeOutSamples: Math.floor((item.audioFadeOut ?? 0) * OUTPUT_RATE),
  }
}

/** One clip's contribution: nothing, a reason it can't be mirrored, or a segment. */
function classifyAudioClip(item, track, ctx, items) {
  if (!track || track.visible === false) return {}
  if (item.type === 'composition' || (item.type === 'audio' && item.compositionId))
    return { reason: `compound clip audio (${item.label ?? item.id})` }
  if (!isAudible(item, items)) return {}
  const stream = audioStream(ctx.media[item.mediaId]?.probe)
  // The browser mix skips items whose file has no audio track.
  if (!stream)
    return item.type === 'audio' ? { reason: `audio item without an audio stream (${item.id})` } : {}
  if (track.muted) return {}
  const why = ruleReasons(AUDIO_CLIP_RULES, { item, track, stream, ctx })
  if (why.length) return { reason: `${item.label ?? item.id}: ${why.join(', ')}` }
  return { segment: audioSegment(item, track, stream, ctx) }
}

/** Audio segments as the browser mix builds them, or the reasons it cannot be mirrored. */
function planAudio(timeline, tracks, items, ctx) {
  const reasons = ruleReasons(AUDIO_PROJECT_RULES, { timeline, tracks })
  const segments = []
  const trackById = new Map(tracks.map((t) => [t.id, t]))
  for (const item of items) {
    const result = classifyAudioClip(item, trackById.get(item.trackId), ctx, items)
    if (result.reason) reasons.push(result.reason)
    if (result.segment) segments.push(result.segment)
  }
  const route = reasons.length ? 'browser' : segments.length ? 'native' : 'none'
  return { route, reasons, segments }
}

/**
 * Stack layers bottom to top: overlay items join the open overlay group; a
 * native item closes it. Items on one track never overlap in time, so a
 * track's overlay items may share a group below that track's native items.
 */
function stackLayers(tracksBottomUp, routeOf) {
  const layers = []
  let open = null
  for (const track of tracksBottomUp) {
    const ordered = [...track.items].sort((a, b) => a.from - b.from)
    for (const item of ordered.filter((i) => routeOf.get(i.id) === 'overlay')) {
      if (!open) {
        open = { kind: 'overlay', itemIds: [] }
        layers.push(open)
      }
      open.itemIds.push(item.id)
    }
    for (const item of ordered.filter((i) => routeOf.get(i.id) === 'native')) {
      layers.push({ kind: 'native', itemId: item.id })
      open = null
    }
  }
  return layers
}

function mergeSpans(ranges, total) {
  const sorted = ranges
    .map(([s, e]) => [Math.max(0, s), Math.min(total, e)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])
  const out = []
  for (const [s, e] of sorted) {
    const last = out.at(-1)
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

/** Project-wide reasons native export cannot run at all. */
function planRefusals({ codec, fps, background, meta, width, height }) {
  return ruleReasons(
    [
      [() => !NATIVE_CODECS.includes(codec), `codec ${codec} has no native encoder here`],
      [() => !rateToRational(fps), `project fps ${fps} is not a supported rate`],
      [() => !background, `background colour ${meta.backgroundColor} is not an opaque hex colour`],
      [() => width % 2 || height % 2, `odd canvas size ${width}x${height}`],
    ],
    null,
  )
}

const hdrRefusal = (item, color) => {
  const t = color.tags
  return (
    `${item.label ?? item.id} is HDR/wide gamut (transfer ${t.transfer ?? 'untagged'}, ` +
    `primaries ${t.primaries ?? 'untagged'}, matrix ${t.space ?? 'untagged'}); native export never ` +
    "tone-maps to SDR. Supply an SDR copy, or pass --browser to accept the browser's own conversion."
  )
}

/** Route of an item that is not a video, or null to classify it as a video. */
function nonVideoRoute(item, tl) {
  if (item.type === 'audio') return { route: 'audio' }
  if (!tl.visibleTrackIds.has(item.trackId)) return { route: 'hidden' }
  const drawn = item.type !== 'controller' && !isTranscriptSubtitle(item)
  if (!drawn || item.from >= tl.total || item.durationInFrames <= 0) return { route: 'not drawn' }
  if (item.type !== 'video') return { route: 'overlay', reasons: [`${item.type} is drawn by the browser renderer`] }
  return null
}

/** Decide one item's route; video items carry their native facts. */
function classifyItem(item, tl) {
  const decision = { id: item.id, type: item.type, label: item.label ?? item.type, reasons: [] }
  const simple = nonVideoRoute(item, tl)
  if (simple) return { decision: { ...decision, ...simple, reasons: simple.reasons ?? [] } }
  const info = videoNativeReasons(item, { ...tl.ctx, mediaInfo: tl.ctx.media[item.mediaId] })
  const result = { decision, info }
  if (info.color?.hdr) result.refusal = hdrRefusal(item, info.color)
  else if (info.stream && !info.color.sdrKnown)
    info.reasons.push(`unrecognised transfer ${info.color.tags.transfer}`)
  decision.reasons.push(...tl.allOverlay, ...info.reasons)
  decision.route = decision.reasons.length ? 'overlay' : 'native'
  if (decision.route !== 'native') return result
  const geometry = videoGeometry(item, tl.canvas, info.stream)
  if (!geometry.visible) decision.route = 'not drawn'
  else result.native = { ...info, geometry }
  return result
}

/** Timeline facts every item decision reads. */
function timelineFacts(project, media) {
  const meta = project.metadata ?? {}
  const timeline = project.timeline ?? {}
  const fps = meta.fps ?? 30
  const tracks = effectiveTracks(timeline.tracks ?? [])
  const items = timeline.items ?? []
  const anySolo = tracks.some((t) => t.solo)
  const visibleTrackIds = new Set(
    tracks.filter((t) => (anySolo ? t.solo === true : t.visible !== false)).map((t) => t.id),
  )
  return {
    meta,
    timeline,
    fps,
    canvas: { width: meta.width ?? 1920, height: meta.height ?? 1080 },
    tracks,
    items,
    total: projectDurationFrames(items, fps),
    visibleTrackIds,
    allOverlay: globalVisualReasons(items, visibleTrackIds),
    ctx: {
      media,
      fps,
      keyframed: keyframedIds(timeline.keyframes),
      transitionIds: new Set(
        (timeline.transitions ?? []).flatMap((t) => [t.leftClipId, t.rightClipId]),
      ),
      parentIds: new Set(items.map((i) => i.transformParent?.parentItemId).filter(Boolean)),
    },
  }
}

function nativeLayer(item, info, tl) {
  const t = tf(item)
  return {
    kind: 'native',
    itemId: item.id,
    label: item.label,
    mediaId: item.mediaId,
    path: tl.ctx.media[item.mediaId].original,
    streamIndex: info.stream.index,
    from: item.from,
    frames: Math.min(item.durationInFrames, tl.total - item.from),
    firstSourceFrame: info.ratio.first,
    rate: info.rate,
    ratio: { num: info.ratio.num, den: info.ratio.den },
    geometry: info.geometry,
    opacity: t.opacity ?? 1,
    flipH: Boolean(t.flipHorizontal),
    flipV: Boolean(t.flipVertical),
    color: info.color,
    alpha: info.alpha,
  }
}

/** Layers bottom to top: native clips and the overlay groups between them. */
function buildLayers(tl, routeOf, nativeInfo) {
  const tracksBottomUp = [...tl.tracks]
    .filter((t) => tl.visibleTrackIds.has(t.id))
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
    .map((t) => ({ ...t, items: tl.items.filter((i) => i.trackId === t.id) }))
  const itemById = new Map(tl.items.map((i) => [i.id, i]))
  return stackLayers(tracksBottomUp, routeOf).map((layer, index) => {
    if (layer.kind === 'native')
      return nativeLayer(itemById.get(layer.itemId), nativeInfo.get(layer.itemId), tl)
    const ranges = layer.itemIds.map((id) => {
      const i = itemById.get(id)
      return [i.from, i.from + i.durationInFrames]
    })
    return { kind: 'overlay', id: `overlay-${index}`, itemIds: layer.itemIds, spans: mergeSpans(ranges, tl.total) }
  })
}

const sourceSummary = (usedSources) =>
  [...usedSources.entries()].map(([mediaId, i]) => ({
    mediaId,
    codec: i.stream.codec_name,
    pixFmt: i.stream.pix_fmt,
    bitDepth: i.bitDepth,
    matrix: i.color.matrix,
    range: i.color.range,
  }))

/**
 * Plan a native export. `media` maps mediaId to `{ original, probe }` (ffprobe
 * JSON of the original). Returns `{ ok, refusals, ... }`; when `ok` is false the
 * caller falls back to the browser render (never for HDR) and shows the refusals.
 */
export function planNativeExport({ project, media, options = {} }) {
  const tl = timelineFacts(project, media)
  const { width, height } = tl.canvas
  const codec = options.codec ?? 'h264'
  const background = parseHexColor(tl.meta.backgroundColor)
  const refusals = planRefusals({ codec, fps: tl.fps, background, meta: tl.meta, width, height })
  const decisions = []
  const routeOf = new Map()
  const nativeInfo = new Map()
  const usedSources = new Map()
  const hdrItems = []
  for (const item of tl.items) {
    const result = classifyItem(item, tl)
    decisions.push(result.decision)
    routeOf.set(item.id, result.decision.route)
    if (result.info?.stream) usedSources.set(item.mediaId, result.info)
    if (result.native) nativeInfo.set(item.id, result.native)
    if (result.refusal) {
      hdrItems.push(item.id)
      refusals.push(result.refusal)
    }
  }
  const audio = planAudio(tl.timeline, tl.tracks, tl.items, tl.ctx)
  const tenBit = [...nativeInfo.values()].some((i) => i.bitDepth >= 10)
  return {
    ok: refusals.length === 0,
    refusals,
    // HDR never falls back automatically: the browser render would be an SDR
    // conversion nobody asked for. Only an explicit browser export makes one.
    hdrItems,
    width,
    height,
    fps: tl.fps,
    fpsRational: rateToRational(tl.fps),
    totalFrames: tl.total,
    background,
    layers: buildLayers(tl, routeOf, nativeInfo),
    decisions,
    audio: {
      ...audio,
      totalSamples: Math.ceil((tl.total / tl.fps) * OUTPUT_RATE),
      masterGainDb: tl.timeline.masterBusDb ?? 0,
    },
    output: outputFormat(codec, options.quality ?? 'high', tenBit),
    sources: sourceSummary(usedSources),
  }
}

function outputFormat(codec, quality, tenBit) {
  if (codec === 'prores')
    return {
      codec,
      container: 'mov',
      pixFmt: 'yuv422p10le',
      bitDepth: 10,
      videoArgs: ['-c:v', 'prores_ks', '-profile:v', quality === 'ultra' ? '4' : '3', '-vendor', 'apl0'],
      audioArgs: ['-c:a', 'pcm_s24le'],
      pixFmtForEncoder: quality === 'ultra' ? 'yuv444p10le' : 'yuv422p10le',
    }
  if (codec === 'hevc')
    return {
      codec,
      container: 'mp4',
      pixFmt: tenBit ? 'yuv420p10le' : 'yuv420p',
      bitDepth: tenBit ? 10 : 8,
      videoArgs: [
        '-c:v',
        'libx265',
        '-preset',
        'medium',
        '-crf',
        String(QUALITY_CRF.hevc[quality] ?? 20),
        '-tag:v',
        'hvc1',
        '-x265-params',
        'log-level=error',
        ...(tenBit ? ['-profile:v', 'main10'] : []),
      ],
      audioArgs: ['-c:a', 'aac', '-b:a', AAC_BITRATE[quality] ?? '256k'],
    }
  return {
    codec: 'h264',
    container: 'mp4',
    pixFmt: 'yuv420p',
    bitDepth: 8,
    videoArgs: [
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      String(QUALITY_CRF.h264[quality] ?? 17),
      '-profile:v',
      'high',
    ],
    audioArgs: ['-c:a', 'aac', '-b:a', AAC_BITRATE[quality] ?? '256k'],
  }
}

// ---------------------------------------------------------------------------
// ffmpeg command
// ---------------------------------------------------------------------------

const WORK = 'yuv444p10le'
const WORK_ALPHA = 'yuva444p10le'
const fmt = (n) => Number(n.toFixed(6)).toString()

/** Filter chain that turns one native layer's decoded frames into placed, timed frames. */
function nativeLayerFilter(layer, plan) {
  const F = plan.fpsRational
  const g = layer.geometry
  const c = layer.color
  const scale = [
    `scale=${g.snapped.width}:${g.snapped.height}`,
    'flags=lanczos+accurate_rnd+full_chroma_int',
    ...(c.rgb ? [] : [`in_color_matrix=${c.matrix}`, `in_range=${c.range}`]),
    'out_color_matrix=bt709',
    'out_range=limited',
  ].join(':')
  const parts = [
    // Timeline frame k shows source frame first + floor(k * R): number the
    // decoded frames from the seek point, give frame j the first output slot
    // that uses it, and let fps duplicate (or drop) to fill every slot.
    `settb=expr=${F.den}/${F.num}`,
    `setpts='ceil(N*${layer.ratio.den}/${layer.ratio.num})'`,
    `fps=fps=${ratioString(F)}`,
    'tpad=stop_mode=clone:stop=-1',
    `trim=end_frame=${layer.frames}`,
    scale,
    'setsar=1',
    `format=${WORK_ALPHA}`,
  ]
  if (layer.flipH) parts.push('hflip')
  if (layer.flipV) parts.push('vflip')
  const vis = g.visible
  if (
    vis.x !== g.snapped.x ||
    vis.y !== g.snapped.y ||
    vis.width !== g.snapped.width ||
    vis.height !== g.snapped.height
  )
    parts.push(`crop=${vis.width}:${vis.height}:${vis.x - g.snapped.x}:${vis.y - g.snapped.y}`)
  if (layer.opacity < 1) parts.push(`lut=a='val*${fmt(layer.opacity)}'`)
  parts.push(`setpts=PTS+${layer.from}`)
  return { chain: parts.join(','), x: vis.x, y: vis.y }
}

/** Seconds to seek so the first decoded frame is `frame` (half a frame early). */
const seekSeconds = (frame, rate) => (frame <= 0 ? 0 : ((frame - 0.5) * rate.den) / rate.num)

/**
 * ffmpeg argv for the final composite. `overlays` maps an overlay layer id to
 * `[{ start, end, pattern }]` (frame spans the browser rendered: an RGBA PNG
 * sequence per span, `%07d` = project frame);
 * `browserAudio` is a WAV from the browser mix when the plan's audio route is
 * 'browser'.
 */
export function buildFfmpegArgs(plan, { overlays = {}, browserAudio = null, outPath }) {
  const F = plan.fpsRational
  const inputs = []
  const filters = []
  const addInput = (args) => {
    inputs.push(...args)
    return inputs.filter((a) => a === '-i').length - 1
  }
  const total = plan.totalFrames
  filters.push(
    `color=c=0x${plan.background}:s=${plan.width}x${plan.height}:r=${ratioString(F)},format=gbrp,` +
      `trim=end_frame=${total},settb=expr=${F.den}/${F.num},setpts=N,` +
      `scale=out_color_matrix=bt709:out_range=limited,format=${WORK}[base0]`,
  )
  let base = 'base0'
  let n = 0
  const overlayOnto = (label, x, y, from, to) => {
    const next = `base${++n}`
    filters.push(
      `[${base}][${label}]overlay=x=${x}:y=${y}:format=yuv444p10:eof_action=pass:` +
        `enable='between(n,${from},${to - 1})'[${next}]`,
    )
    base = next
  }
  for (const layer of plan.layers) {
    if (layer.kind === 'native') {
      const ss = seekSeconds(layer.firstSourceFrame, layer.rate)
      const idx = addInput([...(ss > 0 ? ['-ss', fmt(ss)] : []), '-i', layer.path])
      const { chain, x, y } = nativeLayerFilter(layer, plan)
      const label = `v${idx}`
      filters.push(`[${idx}:${layer.streamIndex}]${chain}[${label}]`)
      overlayOnto(label, x, y, layer.from, layer.from + layer.frames)
      continue
    }
    for (const span of overlays[layer.id] ?? []) {
      const idx = addInput([
        '-framerate',
        ratioString(F),
        '-start_number',
        String(span.start),
        '-i',
        span.pattern,
      ])
      const label = `o${idx}`
      filters.push(
        `[${idx}:v]settb=expr=${F.den}/${F.num},setpts=N+${span.start},` +
          `scale=out_color_matrix=bt709:out_range=limited,format=${WORK_ALPHA}[${label}]`,
      )
      overlayOnto(label, 0, 0, span.start, span.end)
    }
  }
  filters.push(
    `[${base}]format=${plan.output.pixFmtForEncoder ?? plan.output.pixFmt},` +
      'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited[vout]',
  )

  const maps = ['-map', '[vout]']
  const audio = plan.audio
  if (audio.route === 'native' && audio.segments.length) {
    const labels = audio.segments.map((seg, i) => {
      const ss = seg.sourceStartSample > 0 ? (seg.sourceStartSample - 0.5) / seg.sourceRate : 0
      const idx = addInput([...(ss > 0 ? ['-ss', fmt(ss)] : []), '-i', seg.path])
      const label = `a${i}`
      const chain = [
        `asetpts=N/SR/TB`,
        `aresample=${OUTPUT_RATE}`,
        'aformat=sample_fmts=fltp',
        `atrim=end_sample=${seg.lengthSamples}`,
        'asetpts=N/SR/TB',
        ...(seg.gainDb !== 0 ? [`volume=${fmt(seg.gainDb)}dB:precision=double`] : []),
        ...(seg.fadeInSamples > 0
          ? [`afade=t=in:ss=0:ns=${Math.min(seg.fadeInSamples, seg.lengthSamples)}:curve=tri`]
          : []),
        ...(seg.fadeOutSamples > 0
          ? [
              `afade=t=out:ss=${Math.max(0, seg.lengthSamples - seg.fadeOutSamples)}:ns=${Math.min(seg.fadeOutSamples, seg.lengthSamples)}:curve=tri`,
            ]
          : []),
        seg.channels === 1 ? 'pan=stereo|c0=c0|c1=c0' : 'aformat=channel_layouts=stereo',
        ...(seg.startSample > 0 ? [`adelay=delays=${seg.startSample}S:all=1`] : []),
        `apad=whole_len=${audio.totalSamples}`,
        `atrim=end_sample=${audio.totalSamples}`,
      ]
      filters.push(`[${idx}:${seg.streamIndex}]${chain.join(',')}[${label}]`)
      return `[${label}]`
    })
    const clip = (ch) => `if(gt(abs(val(${ch})),1),tanh(val(${ch})),val(${ch}))`
    filters.push(
      `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0,` +
        `atrim=end_sample=${audio.totalSamples},` +
        `aeval=exprs='${clip(0)}|${clip(1)}':channel_layout=stereo` +
        (audio.masterGainDb ? `,volume=${fmt(audio.masterGainDb)}dB:precision=double` : '') +
        '[aout]',
    )
    maps.push('-map', '[aout]')
  } else if (audio.route === 'browser' && browserAudio) {
    const idx = addInput(['-i', browserAudio])
    filters.push(
      `[${idx}:a]aresample=${OUTPUT_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad=whole_len=${audio.totalSamples},atrim=end_sample=${audio.totalSamples}[aout]`,
    )
    maps.push('-map', '[aout]')
  }
  const hasAudio = maps.includes('[aout]')
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-v',
    'error',
    ...inputs,
    '-filter_complex',
    filters.join(';\n'),
    ...maps,
    ...plan.output.videoArgs,
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-color_range',
    'tv',
    '-fps_mode',
    'passthrough',
    ...(hasAudio ? [...plan.output.audioArgs, '-ar', String(OUTPUT_RATE), '-ac', '2'] : ['-an']),
    ...(plan.output.container === 'mp4' ? ['-movflags', '+faststart'] : []),
    outPath,
  ]
}

/** One line per item for the CLI: what went native, what the browser drew, and why. */
export function describePlan(plan) {
  const lines = []
  for (const d of plan.decisions) {
    if (d.route === 'audio') continue
    const why = d.reasons.length ? ` (${[...new Set(d.reasons)].join('; ')})` : ''
    lines.push(`${d.route.padEnd(9)} ${d.type.padEnd(6)} ${d.label}${why}`)
  }
  const a = plan.audio
  lines.push(
    a.route === 'native'
      ? `audio     native mix of ${a.segments.length} clip(s) from the originals`
      : a.route === 'browser'
        ? `audio     browser mix (${[...new Set(a.reasons)].join('; ')})`
        : 'audio     none',
  )
  return lines
}
