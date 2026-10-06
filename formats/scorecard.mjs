// Format scorecard: how a project's timeline measures against its format's
// rules and targets (./registry.mjs). Pure and deterministic, fast enough to run
// on every timeline change; the caller supplies media metadata and transcripts.
//
//   scoreProject(project, { mediaById, transcripts, format, variant })
//     -> { format, variant, durationSec, checks: [{ key, label, status, value,
//          target, detail, ranges: [{ startFrame, endFrame }] }], summary }
//
// Item roles resolve in this order: item.formatRole (and the editor's caption
// markers), the media's category (via the format's categoryRoles), the track's
// role (track.formatRole, or a track named like the format layout), then type
// heuristics (text at the start, long enough and high enough is the title).
import { FORMAT_ROLES, getFormat, resolveFormat } from './registry.mjs'

const PICTURE_ROLES = new Set(['speaker', 'images', 'plates', 'broll', 'shots'])
const TEXT_ROLES = new Set(['title', 'captions', 'labels'])
const AUDIO_ROLES = new Set(['voice', 'music', 'sfx', 'speaker'])
const SHOT_ROLES = new Set(['broll', 'shots', 'speaker'])
const SPEECH_ROLES = new Set(['voice', 'speaker'])
const VALID_ROLES = new Set(FORMAT_ROLES)
const PICTURE_TYPES = new Set(['video', 'image', 'composition', 'lottie'])
const TEXT_TYPES = new Set(['text', 'subtitle'])
const SILENT_DB = -60
const MAX_RANGES = 20
const EPSILON = 1e-6

const itemKind = (item) => {
  if (TEXT_TYPES.has(item.type)) return 'text'
  if (PICTURE_TYPES.has(item.type)) return 'picture'
  if (item.type === 'audio') return 'audio'
  return 'other'
}

// Roles a category, track or heuristic may give an item of each kind. An
// explicit item.formatRole is trusted as is.
const ALLOWED = {
  text: TEXT_ROLES,
  picture: new Set([...PICTURE_ROLES, ...TEXT_ROLES]),
  audio: new Set([...AUDIO_ROLES, ...PICTURE_ROLES]),
  other: new Set(),
}

/** A track's role: its formatRole, else the layout role of the same-named format track. */
export function trackRole(track, format) {
  if (VALID_ROLES.has(track?.formatRole)) return track.formatRole
  const name = String(track?.name ?? '')
    .trim()
    .toLowerCase()
  const entry = format?.tracks.find((candidate) => candidate.name.toLowerCase() === name)
  return entry && (!track.kind || track.kind === entry.kind) ? entry.role : null
}

// The editor's own caption markers are as explicit as a formatRole.
const isCaption = (item) =>
  item.type === 'subtitle' || item.textRole === 'caption' || Boolean(item.captionSource)

/** Text from the hook start, at least 2 s long, top or middle of frame. */
function looksLikeTitle(item, format, canvasHeight, fps) {
  const atStart = item.from <= Math.round((format.rules.titleHook?.fromSec ?? 0) * fps)
  const upper = (item.transform?.y ?? 0) <= canvasHeight * 0.1
  return atStart && upper && item.durationInFrames >= 2 * fps
}

function heuristicRole(item, kind, format, canvasHeight, fps) {
  if (kind === 'text') return looksLikeTitle(item, format, canvasHeight, fps) ? 'title' : 'labels'
  if (kind === 'audio') return format.defaultRoles.audio
  if (kind !== 'picture') return null
  return item.type === 'image' ? format.defaultRoles.image : format.defaultRoles.video
}

/**
 * Map of item id -> { role, source } for the top-level timeline, where source is
 * 'formatRole' | 'textRole' | 'category' | 'track' | 'heuristic'. The editor's
 * caption markers (textRole 'caption', subtitle items, captionSource) count as
 * explicit, right after formatRole. Items with no role (shapes, adjustment
 * layers) are left out.
 */
export function resolveItemRoles(project, { mediaById = {}, format, variant } = {}) {
  const resolved = resolveScoringFormat(project, { format, variant })
  const timeline = project?.timeline ?? { tracks: [], items: [] }
  const scope = {
    format: resolved,
    mediaById,
    fps: project?.metadata?.fps || 30,
    height: project?.metadata?.height || resolved.canvas.height,
    tracks: new Map(timeline.tracks.map((track) => [track.id, track])),
  }
  const roles = new Map()
  for (const item of timeline.items) {
    const hit = itemRole(item, scope)
    if (hit) roles.set(item.id, hit)
  }
  return roles
}

function itemRole(item, scope) {
  const kind = itemKind(item)
  const category = mediaLookup(scope.mediaById, item.mediaId)?.category
  const candidates = [
    [VALID_ROLES.has(item.formatRole) ? item.formatRole : null, 'formatRole'],
    [isCaption(item) ? 'captions' : null, 'textRole'],
    [scope.format.categoryRoles[category] ?? null, 'category'],
    [trackRole(scope.tracks.get(item.trackId), scope.format), 'track'],
    [heuristicRole(item, kind, scope.format, scope.height, scope.fps), 'heuristic'],
  ]
  const hit = candidates.find(
    ([role, source]) => role && (source === 'formatRole' || ALLOWED[kind].has(role)),
  )
  return hit ? { role: hit[0], source: hit[1] } : null
}

const mediaLookup = (mediaById, id) => {
  if (!id || !mediaById) return undefined
  return mediaById instanceof Map ? mediaById.get(id) : mediaById[id]
}

// ---------------------------------------------------------------------------
// Timeline context
// ---------------------------------------------------------------------------

const audible = (item, track) => !track?.muted && (item.volume ?? 0) > SILENT_DB

function carriesAudio(item, context) {
  if (item.type === 'audio') return true
  if (item.type !== 'video' || item.embeddedAudioMuted) return false
  if (item.linkedGroupId && context.linkedAudioGroups.has(item.linkedGroupId)) return false
  return Boolean(mediaLookup(context.mediaById, item.mediaId)?.audioCodec)
}

function buildContext(project, format, { mediaById = {}, transcripts }) {
  const timeline = project?.timeline ?? { tracks: [], items: [], transitions: [] }
  const fps = project?.metadata?.fps || format.canvas.fps
  const tracks = new Map(timeline.tracks.map((track) => [track.id, track]))
  const roles = resolveItemRoles(project, { mediaById, format })
  const context = {
    fps,
    format,
    mediaById,
    transcripts,
    transitions: timeline.transitions ?? [],
    linkedAudioGroups: new Set(
      timeline.items
        .filter((i) => i.type === 'audio' && i.linkedGroupId)
        .map((i) => i.linkedGroupId),
    ),
    roleOf: (item) => roles.get(item.id)?.role ?? null,
    items: [],
  }
  context.items = timeline.items.filter((item) => {
    const track = tracks.get(item.trackId)
    if (itemKind(item) === 'audio') return audible(item, track)
    return track?.visible !== false
  })
  context.sounding = context.items.filter(
    (item) => carriesAudio(item, context) && audible(item, tracks.get(item.trackId)),
  )
  context.end = Math.max(0, ...context.items.map((item) => item.from + item.durationInFrames))
  context.durationSec = context.end / fps
  return context
}

const withRole = (items, context, roles) =>
  items.filter((item) => roles.has(context.roleOf(item))).sort((a, b) => a.from - b.from)
const pictures = (context, roles) =>
  withRole(
    context.items.filter((item) => itemKind(item) === 'picture'),
    context,
    roles,
  )
const texts = (context, roles) =>
  withRole(
    context.items.filter((item) => itemKind(item) !== 'audio'),
    context,
    roles,
  )
const sounding = (context, roles) => withRole(context.sounding, context, roles)

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

const round = (value, places = 2) => (value === null ? null : Number(value.toFixed(places)))
const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const range = (startFrame, endFrame) => ({ startFrame, endFrame })
const itemRange = (item) => range(item.from, item.from + item.durationInFrames)
const uniqueSorted = (frames) => [...new Set(frames)].sort((a, b) => a - b)
const perMinute = (count, context) =>
  context.durationSec > 0 ? count / (context.durationSec / 60) : null

/** Consecutive [start, end) segments between sorted boundary frames, ending at the timeline end. */
function segments(boundaries, end) {
  return boundaries
    .map((start, index) => range(start, boundaries[index + 1] ?? end))
    .filter((segment) => segment.endFrame > segment.startFrame)
}

/** Union of item ranges, merged. */
function coverage(items) {
  const merged = []
  for (const r of items.map(itemRange).sort((a, b) => a.startFrame - b.startFrame)) {
    const last = merged.at(-1)
    if (last && r.startFrame <= last.endFrame) last.endFrame = Math.max(last.endFrame, r.endFrame)
    else merged.push({ ...r })
  }
  return merged
}

function uncovered(covered, end) {
  const holes = []
  let cursor = 0
  for (const r of covered) {
    if (r.startFrame > cursor) holes.push(range(cursor, r.startFrame))
    cursor = Math.max(cursor, r.endFrame)
  }
  if (cursor < end) holes.push(range(cursor, end))
  return holes
}

const seconds = (frames, context) => frames / context.fps
const longer = (ranges, limitSec, context) =>
  ranges.filter((r) => seconds(r.endFrame - r.startFrame, context) > limitSec + EPSILON)
const longest = (ranges, count = 3) =>
  [...ranges]
    .sort((a, b) => b.endFrame - b.startFrame - (a.endFrame - a.startFrame))
    .slice(0, count)

// ---------------------------------------------------------------------------
// Speech, from transcripts mapped through each clip's source window
// ---------------------------------------------------------------------------

function transcriptWords(transcript) {
  const data = transcript?.data ?? transcript
  if (Array.isArray(data?.words)) return data.words
  const segs = Array.isArray(data?.segments) ? data.segments : []
  return segs.flatMap((segment) => (segment.words?.length ? segment.words : [segment]))
}

/** Words of one clip in timeline seconds ({ start, end, text }), clipped to its source window. */
export function mapClipWords(item, transcript, { fps, mediaFps } = {}) {
  const srcFps = item.sourceFps || (mediaFps > 0 ? mediaFps : fps)
  const speed = item.speed || 1
  const windowStart = (item.sourceStart ?? 0) / srcFps
  const windowEnd =
    item.sourceEnd !== undefined
      ? item.sourceEnd / srcFps
      : windowStart + (item.durationInFrames / fps) * speed
  const clipStart = item.from / fps
  const clipEnd = (item.from + item.durationInFrames) / fps
  const toTimeline = (sourceSec) => clipStart + (sourceSec - windowStart) / speed
  return transcriptWords(transcript)
    .filter((word) => word.end > windowStart && word.start < windowEnd)
    .map((word) => ({
      start: Math.max(clipStart, toTimeline(Math.max(word.start, windowStart))),
      end: Math.min(clipEnd, toTimeline(Math.min(word.end, windowEnd))),
      text: word.text ?? word.word ?? '',
    }))
    .filter((word) => word.end > word.start)
}

const transcriptFor = (transcripts, id) =>
  transcripts instanceof Map ? transcripts.get(id) : transcripts?.[id]

function speechWords(context) {
  if (context.speech) return context.speech
  const clips = sounding(context, SPEECH_ROLES)
  const words = []
  let mapped = 0
  for (const item of clips) {
    const transcript = item.isReversed ? null : transcriptFor(context.transcripts, item.mediaId)
    if (!transcript) continue
    mapped += 1
    const mediaFps = mediaLookup(context.mediaById, item.mediaId)?.fps
    words.push(...mapClipWords(item, transcript, { fps: context.fps, mediaFps }))
  }
  words.sort((a, b) => a.start - b.start)
  context.speech = { clips: clips.length, mapped, words }
  return context.speech
}

function speechGaps(words, context) {
  const gaps = []
  let cursor = 0
  for (const word of words) {
    if (word.start > cursor) gaps.push([cursor, word.start])
    cursor = Math.max(cursor, word.end)
  }
  return gaps
    .filter(([from, to]) => to - from > EPSILON)
    .map(([from, to]) => range(Math.round(from * context.fps), Math.round(to * context.fps)))
}

// ---------------------------------------------------------------------------
// Metrics: (context, target) -> { value, detail?, ranges?, missing? }
// value null with missing: true counts as a miss; null without it is 'na'.
// ---------------------------------------------------------------------------

const none = (detail) => ({ value: null, detail })
const missing = (detail, ranges = []) => ({ value: null, missing: true, detail, ranges })

function gapStretches(starts, context) {
  const points = uniqueSorted([0, ...starts, context.end])
  return points.slice(0, -1).map((start, index) => range(start, points[index + 1]))
}

function shotSegments(context) {
  const shots = pictures(context, SHOT_ROLES)
  return segments(uniqueSorted(shots.map((item) => item.from)), context.end)
}

function changeSegments(context) {
  const items = pictures(context, PICTURE_ROLES)
  const edges = items.flatMap((item) => [item.from, item.from + item.durationInFrames])
  const changes = uniqueSorted(edges.filter((frame) => frame > 0 && frame < context.end))
  return { changes, parts: segments([0, ...changes], context.end) }
}

const lengthOf = (r, context) => seconds(r.endFrame - r.startFrame, context)

function rateBelow(starts, target, context, what) {
  const count = starts.length
  const value = perMinute(count, context)
  if (value === null) return none('empty timeline')
  // Too slow: the stretches slower than the target pace. Too fast: the whole video.
  const slow = target.min !== null && value < target.min
  const ranges = slow
    ? longer(gapStretches(starts, context), 60 / target.min, context)
    : [range(0, context.end)]
  return { value, detail: `${count} ${what} in ${round(context.durationSec, 1)} s`, ranges }
}

const imageStarts = (context) => pictures(context, new Set(['images'])).map((item) => item.from)

function plateStarts(context) {
  return uniqueSorted(pictures(context, new Set(['plates'])).map((item) => item.from))
}

function shotMetric(context, pickSegment, label) {
  const parts = shotSegments(context)
  if (!parts.length) return missing('no shots')
  const segment = pickSegment(parts)
  return { value: lengthOf(segment, context), detail: label(parts), ranges: [segment] }
}

function ratioMetric(context, pickSegment, what) {
  const parts = shotSegments(context)
  const mid = median(parts.map((part) => lengthOf(part, context)))
  if (!mid || parts.length < 2) return none('fewer than 2 shots')
  const segment = pickSegment(parts)
  return {
    value: lengthOf(segment, context) / mid,
    detail: `${what} ${round(lengthOf(segment, context))} s vs median ${round(mid)} s`,
    ranges: [segment],
  }
}

function titleText(context) {
  const fromFrame = Math.round((context.format.rules.titleHook?.fromSec ?? 0) * context.fps)
  return texts(context, new Set(['title']))
    .filter((item) => item.from <= fromFrame && TEXT_TYPES.has(item.type))
    .map((item) => item.text ?? '')
    .join(' ')
    .trim()
}

function countRole(context, role, what) {
  const items = texts(context, new Set([role]))
  return { value: items.length, detail: `${items.length} ${what}`, ranges: items.map(itemRange) }
}

const METRICS = {
  lengthSec: (context) =>
    context.end
      ? { value: context.durationSec, ranges: [range(0, context.end)] }
      : none('empty timeline'),

  imagesPerMin: (context, target) => rateBelow(imageStarts(context), target, context, 'images'),

  imageOnScreenSec(context, target) {
    const images = pictures(context, new Set(['images']))
    if (!images.length) return missing('no images')
    const lengths = images.map((item) => seconds(item.durationInFrames, context))
    const off = images.filter((_, i) => isOutside(lengths[i], target))
    return { value: median(lengths), detail: `${images.length} images`, ranges: off.map(itemRange) }
  },

  imageGapSec(context, target) {
    const starts = uniqueSorted(imageStarts(context))
    if (starts.length < 2) return none('fewer than 2 images')
    const gaps = starts.slice(1).map((start, i) => range(starts[i], start))
    const off = gaps.filter((gap) => isOutside(lengthOf(gap, context), target))
    return { value: median(gaps.map((gap) => lengthOf(gap, context))), ranges: off }
  },

  firstImageSec(context) {
    const starts = imageStarts(context)
    if (!starts.length) return missing('no images', [range(0, context.end)])
    const first = Math.min(...starts)
    return { value: seconds(first, context), ranges: [range(0, first)] }
  },

  longestNoNewImageSec(context, target) {
    const stretches = gapStretches(imageStarts(context), context)
    if (!context.end) return none('empty timeline')
    const top = Math.max(...stretches.map((r) => lengthOf(r, context)))
    const ranges =
      target.max !== null ? longer(stretches, target.max, context) : longest(stretches, 1)
    return { value: top, ranges }
  },

  plateChangesPerMin(context, target) {
    const starts = plateStarts(context)
    const changes = starts.filter((frame) => frame > (starts[0] ?? 0))
    return rateBelow(changes, target, context, 'plate changes')
  },

  firstPlateSec(context) {
    const starts = plateStarts(context)
    if (!starts.length) return missing('no plates', [range(0, context.end)])
    return { value: seconds(starts[0], context), ranges: [range(0, starts[0])] }
  },

  firstPlateChangeSec(context) {
    const starts = plateStarts(context)
    if (starts.length < 2) return missing('the background never changes', [range(0, context.end)])
    return {
      value: seconds(starts[1], context),
      detail: 'hook plate held until the first change',
      ranges: [range(starts[0], starts[1])],
    }
  },

  plateCoveragePct(context) {
    if (!context.end) return none('empty timeline')
    const covered = coverage(pictures(context, new Set(['plates'])))
    const frames = covered.reduce(
      (sum, r) => sum + Math.min(r.endFrame, context.end) - r.startFrame,
      0,
    )
    return { value: (100 * frames) / context.end, ranges: uncovered(covered, context.end) }
  },

  visualChangesPerMin(context, target) {
    const { changes } = changeSegments(context)
    return rateBelow(changes, target, context, 'visual changes')
  },

  medianChangeGapSec(context) {
    const { parts } = changeSegments(context)
    if (parts.length < 2) return none('no visual changes')
    return { value: median(parts.map((part) => lengthOf(part, context))), ranges: longest(parts) }
  },

  longestNoChangeSec(context, target) {
    const { parts } = changeSegments(context)
    if (!parts.length) return none('empty timeline')
    const top = Math.max(...parts.map((part) => lengthOf(part, context)))
    const ranges = target.max !== null ? longer(parts, target.max, context) : longest(parts, 1)
    return { value: top, ranges }
  },

  shotCount(context) {
    const parts = shotSegments(context)
    return {
      value: parts.length,
      detail: `${parts.length} shots`,
      ranges: parts.length ? [] : [range(0, context.end)],
    }
  },

  cutsPerMin(context) {
    const parts = shotSegments(context)
    return parts.length
      ? { value: perMinute(parts.length - 1, context), detail: `${parts.length - 1} cuts` }
      : missing('no shots')
  },

  medianShotSec(context) {
    const parts = shotSegments(context)
    return parts.length
      ? { value: median(parts.map((part) => lengthOf(part, context))) }
      : missing('no shots')
  },

  longestShotSec: (context) =>
    shotMetric(
      context,
      (parts) => longest(parts, 1)[0],
      (parts) => `of ${parts.length} shots`,
    ),
  finalShotSec: (context) =>
    shotMetric(
      context,
      (parts) => parts.at(-1),
      () => 'the last shot',
    ),

  firstCutSec(context) {
    const parts = shotSegments(context)
    if (parts.length < 2) return missing('no cut', [range(0, context.end)])
    return { value: seconds(parts[1].startFrame, context), ranges: [range(0, parts[1].startFrame)] }
  },

  openerRatio: (context) => ratioMetric(context, (parts) => parts[0], 'opener'),
  finalShotRatio: (context) => ratioMetric(context, (parts) => parts.at(-1), 'final shot'),

  titleWords(context) {
    const text = titleText(context)
    if (!text) return none('no text title at the start')
    return { value: text.split(/\s+/).filter(Boolean).length, detail: JSON.stringify(text) }
  },

  labelCount: (context) => countRole(context, 'labels', 'labels'),
  graphicsCount: (context) => {
    const items = pictures(context, new Set(['images']))
    return { value: items.length, detail: `${items.length} graphics`, ranges: items.map(itemRange) }
  },

  speechWpm(context) {
    const speech = speechWords(context)
    if (!speech.clips) return none('no speech')
    if (!speech.mapped) return none('no transcript for the speech clips')
    return {
      value: perMinute(speech.words.length, context),
      detail: `${speech.words.length} words`,
    }
  },

  pauseMaxSec(context, target) {
    const speech = speechWords(context)
    if (!speech.clips) return none('no speech')
    if (!speech.mapped) return none('no transcript for the speech clips')
    const gaps = speechGaps(speech.words, context)
    const top = gaps.length ? Math.max(...gaps.map((gap) => lengthOf(gap, context))) : 0
    const partial =
      speech.mapped < speech.clips
        ? ` (${speech.clips - speech.mapped} clip(s) without transcript)`
        : ''
    return {
      value: top,
      detail: `${gaps.filter((g) => isOutside(lengthOf(g, context), target)).length} pause(s) over the limit${partial}`,
      ranges: longer(gaps, target.max ?? Infinity, context),
    }
  },

  voStartSec(context) {
    const vo = sounding(context, new Set(['voice']))
    if (!vo.length) return missing('no voiceover')
    const speech = speechWords(context)
    const first = speech.words[0]?.start ?? seconds(vo[0].from, context)
    return { value: first, ranges: [range(0, Math.round(first * context.fps))] }
  },

  voCoveragePct(context) {
    if (!context.end) return none('empty timeline')
    const covered = coverage(sounding(context, new Set(['voice'])))
    const frames = covered.reduce((sum, r) => sum + r.endFrame - r.startFrame, 0)
    return {
      value: (100 * frames) / context.end,
      ranges: longest(uncovered(covered, context.end), 5),
    }
  },
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function isOutside(value, target) {
  if (value === null || value === undefined) return false
  return (
    (target.min !== null && value < target.min - EPSILON) ||
    (target.max !== null && value > target.max + EPSILON)
  )
}

const unitText = (unit) => (unit ? ` ${unit}` : '')

export function describeTarget(target) {
  const { min, max, ideal, unit } = target
  if (min !== null && max !== null) return `${min}-${max}${unitText(unit)}`
  if (max !== null) return `<= ${max}${unitText(unit)}`
  if (min !== null) return `>= ${min}${unitText(unit)}`
  return ideal !== null ? `~${ideal}${unitText(unit)}` : 'measured only'
}

function evaluate(target, result) {
  const hasBand = target.min !== null || target.max !== null
  if (result.value === null) return result.missing && hasBand ? target.severity : 'na'
  if (!hasBand) return 'info'
  return isOutside(result.value, target) ? target.severity : 'pass'
}

function targetCheck(target, context) {
  const metric = METRICS[target.metric ?? target.key]
  if (!metric) {
    return {
      key: target.key,
      label: target.label,
      status: 'na',
      value: null,
      target: describeTarget(target),
      detail: 'not measurable yet',
      ranges: [],
    }
  }
  const result = metric(context, target)
  const status = evaluate(target, result)
  const notes = [
    result.detail,
    target.ideal !== null && hasBandOf(target)
      ? `ideal ~${target.ideal}${unitText(target.unit)}`
      : null,
    target.note,
  ]
  return {
    key: target.key,
    label: target.label,
    status,
    value: typeof result.value === 'number' ? round(result.value) : result.value,
    target: describeTarget(target),
    detail: notes.filter(Boolean).join('; '),
    ranges: status === 'pass' || status === 'na' ? [] : (result.ranges ?? []).slice(0, MAX_RANGES),
    severity: target.severity,
    source: target.source,
  }
}

const hasBandOf = (target) => target.min !== null || target.max !== null

// Rule checks: presence rules ('required' | 'default' | 'optional' | 'none').
// Status when the thing is [absent, present].
const PRESENCE_STATUS = {
  required: ['fail', 'pass'],
  default: ['warn', 'pass'],
  optional: ['info', 'info'],
  none: ['pass', 'fail'],
}

function presenceCheck(key, label, rule, items, missRanges = []) {
  const statuses = PRESENCE_STATUS[rule]
  if (!statuses) return null
  const present = items.length > 0
  const status = statuses[Number(present)]
  const flagged = status === 'fail' || status === 'warn'
  return {
    key,
    label,
    status,
    value: present,
    target: rule,
    detail: present ? `${items.length} item(s)` : 'none on the timeline',
    ranges: !flagged ? [] : present ? items.map(itemRange).slice(0, MAX_RANGES) : missRanges,
  }
}

function hookDetail(opening, titles, context) {
  if (opening.length) return titleText(context) || `${opening.length} title item(s)`
  if (titles.length) return `title starts at ${round(seconds(titles[0].from, context))} s`
  return 'no title on the timeline'
}

function hookCheck(rule, opening, titles, context) {
  const missing = !opening.length && rule.required
  return {
    key: 'titleHook',
    label: `Title hook from ${rule.fromSec} s`,
    status: missing ? 'fail' : 'pass',
    value: opening.length > 0,
    target: rule.required ? 'required' : 'optional',
    detail: hookDetail(opening, titles, context),
    ranges: missing ? [range(0, Math.min(context.end || 3 * context.fps, 3 * context.fps))] : [],
  }
}

const holdBand = (rule) => ({
  min: rule.holdSec?.min ?? null,
  max: rule.holdSec?.max ?? null,
  ideal: null,
  unit: 's',
})
const holdTarget = (rule) =>
  `${describeTarget(holdBand(rule))}${rule.allowFullHold ? ' or all video' : ''}`

function holdCheck(rule, titles, fromFrame, context) {
  const held = coverage(titles).find((r) => r.startFrame <= fromFrame)
  const holdSec = seconds(held.endFrame - held.startFrame, context)
  const fullHold = rule.allowFullHold && held.endFrame >= context.end
  const ok = fullHold || !isOutside(holdSec, holdBand(rule))
  return {
    key: 'titleHold',
    label: 'Title hook hold',
    status: ok ? 'pass' : 'warn',
    value: round(holdSec),
    target: holdTarget(rule),
    detail: fullHold ? 'held all video' : '',
    ranges: ok ? [] : [range(held.startFrame, held.endFrame)],
  }
}

function titleChecks(context) {
  const rule = context.format.rules.titleHook
  if (!rule) return []
  const fromFrame = Math.round(rule.fromSec * context.fps)
  const titles = texts(context, new Set(['title']))
  const opening = titles.filter((item) => item.from <= fromFrame)
  const hook = hookCheck(rule, opening, titles, context)
  return opening.length ? [hook, holdCheck(rule, titles, fromFrame, context)] : [hook]
}

function captionItems(context) {
  const captions = texts(context, new Set(['captions']))
  const burned = context.items.filter((item) => item.transcriptCaptions?.enabled)
  return [...captions, ...burned]
}

function transitionCheck(context) {
  if (context.format.rules.transitions !== 'none') return null
  const count = context.transitions.length
  const ranges = context.transitions.map((transition) => {
    const at = context.items.find((item) => item.id === transition.rightClipId)?.from ?? 0
    const half = Math.ceil(transition.durationInFrames / 2)
    return range(Math.max(0, at - half), at + half)
  })
  return {
    key: 'transitions',
    label: 'Transitions',
    status: count ? 'fail' : 'pass',
    value: count,
    target: 'none',
    detail: count ? `${count} transition(s); hard cuts only` : 'hard cuts only',
    ranges: ranges.slice(0, MAX_RANGES),
  }
}

const SYNC_ROLES = new Set(['broll', 'shots', 'images', 'plates'])

function ruleChecks(context) {
  const { rules } = context.format
  const whole = [range(0, context.end)]
  const heard = (roles) => sounding(context, roles)
  return [
    ...titleChecks(context),
    presenceCheck('captions', 'Captions', rules.captions, captionItems(context), whole),
    presenceCheck('speech', 'Speech', rules.speech, heard(SPEECH_ROLES), whole),
    presenceCheck('voiceover', 'Voiceover', rules.voiceover, heard(new Set(['voice'])), whole),
    presenceCheck('music', 'Music', rules.music, heard(new Set(['music'])), whole),
    presenceCheck('sfx', 'SFX', rules.sfx, heard(new Set(['sfx']))),
    presenceCheck('syncSound', 'Sync sound from b-roll', rules.syncSound, heard(SYNC_ROLES)),
    transitionCheck(context),
  ].filter(Boolean)
}

/**
 * Score a project against a format. `format` is a format id or a resolved
 * format (resolveFormat); it defaults to the project's own `format`, as does
 * `variant`. `mediaById` (id -> media metadata: category, audioCodec, fps) and
 * `transcripts` (id -> stored transcript envelope or { segments } / { words },
 * in source seconds) are optional; without transcripts the speech checks say 'na'.
 * `targetOverrides` patches targets by key (see withTargetOverrides).
 */
export function scoreProject(project, options = {}) {
  const format = withTargetOverrides(
    resolveScoringFormat(project, options),
    options.targetOverrides,
  )
  const context = buildContext(project, format, options)
  const checks = [
    ...ruleChecks(context),
    ...format.targets.map((target) => targetCheck(target, context)),
  ]
  const summary = { pass: 0, warn: 0, fail: 0 }
  for (const check of checks) if (check.status in summary) summary[check.status] += 1
  return {
    format: format.id,
    variant: format.variant?.id ?? null,
    durationSec: round(context.durationSec),
    checks,
    summary,
  }
}

/**
 * Targets patched by key (a creator kit's preferences replace the format's
 * pause target, for one): `{ pauseMaxSec: { max: 0.3, source: 'kit', note } }`.
 */
function withTargetOverrides(format, overrides) {
  if (!overrides) return format
  const targets = format.targets.map((target) =>
    overrides[target.key] ? { ...target, ...overrides[target.key] } : target,
  )
  return { ...format, targets }
}

const isResolved = (format) =>
  Boolean(format) &&
  typeof format === 'object' &&
  Array.isArray(format.targets) &&
  'variant' in format
const formatIdOf = (format) => (typeof format === 'string' ? format : format?.id)
// The project's own variant applies only when scoring against its own format.
const ownVariant = (recorded, definition) =>
  getFormat(recorded?.id)?.id === definition.id ? recorded.variant : undefined

function resolveScoringFormat(project, { format, variant }) {
  if (isResolved(format)) return format
  const id = formatIdOf(format) ?? project?.format?.id
  const definition = getFormat(id)
  if (!definition) {
    throw new Error(id ? `Unknown format "${id}"` : 'The project has no format; choose one first')
  }
  return resolveFormat(definition.id, variant ?? ownVariant(project?.format, definition))
}
