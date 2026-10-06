// The first assembly from a validated performance plan, as ONE op batch
// (`shred build`): the kept lines' speaker clips back to back on the Speaker
// track (their own audio kept, its timing following the video's), each visual
// with an asset on its track at its frames, on-screen text in the kit's or
// project's styles, one marker per kept line (`<role>: <first words>`) and a
// red marker for every visual still to source. Markers-only builds only the
// markers. The ops are build.mjs's, so both modes assemble alike.
import {
  clearingOps,
  clipOps,
  markerId,
  markerText,
  styleFinder,
  textOps,
  trackFinder,
} from '../build.mjs'

const TO_SOURCE_COLOR = '#EF4444'
const MARKER_WORDS = 6

/** The first words of a line, for its marker. */
export function firstWords(text, count = MARKER_WORDS) {
  const words = String(text ?? '')
    .split(/\s+/)
    .filter(Boolean)
  return `${words.slice(0, count).join(' ')}${words.length > count ? '…' : ''}`
}

const runBeat = (run) => ({
  id: run.id,
  start: run.start,
  end: run.end,
  source: { inSec: run.inSec },
  media: run.media,
})
const visualBeat = (visual) => ({
  id: visual.id,
  start: visual.start,
  end: visual.end,
  source: { inSec: visual.visual.in },
  media: visual.media,
})

/** The size that fills the canvas with the media (full bleed), or null when its size is unknown. */
function coverSize(media, canvas) {
  if (!(media.width > 0 && media.height > 0)) return null
  const scale = Math.max(canvas.width / media.width, canvas.height / media.height)
  return { width: Math.round(media.width * scale), height: Math.round(media.height * scale) }
}

function fitOps(visual, callerId, canvas) {
  const { fit } = visual.visual
  const transform =
    fit === 'cover' ? coverSize(visual.media, canvas) : typeof fit === 'object' ? fit : null
  if (!transform) return []
  return [
    {
      callerId: `${callerId}-fit`,
      op: 'setTransform',
      id: { $ref: `${callerId}#/detail/created/0/id` },
      transform,
    },
  ]
}

const trackEntry = (track) => ({ track: track.name, trackAdded: Boolean(track.added) })

function placeRuns(layout, tools) {
  return layout.runs.map((run, index) => {
    const track = tools.findTrack('speaker', 'video')
    const clip = clipOps(runBeat(run), `run${index}`, track, {
      fps: tools.fps,
      dropSyncSound: tools.format.rules.syncSound === 'none',
    })
    tools.ops.push(...clip.ops)
    return { run, ...trackEntry(track), syncSound: clip.syncSound }
  })
}

function placeVisuals(layout, tools) {
  return layout.visuals
    .filter((visual) => visual.media)
    .map((visual, index) => {
      const track = tools.findTrack(visual.trackRole, 'video')
      const callerId = `visual${index}`
      // A visual's own sound never plays over the speaker.
      const clip = clipOps(visualBeat(visual), callerId, track, {
        fps: tools.fps,
        dropSyncSound: true,
      })
      tools.ops.push(...clip.ops, ...fitOps(visual, callerId, tools.canvas))
      return { visual, ...trackEntry(track) }
    })
}

function placeTexts(layout, tools) {
  return layout.texts.map((text, index) => {
    const placed = textOps(text, `text${index}`, tools.findTrack, tools.styleFor)
    tools.ops.push(...placed.ops)
    return placed.placed
  })
}

function lineMarkers(layout, lines) {
  return lines
    .filter((line) => line.keep && layout.spans.has(line.id))
    .map((line, index) => ({
      callerId: `mark${index}`,
      op: 'addMarker',
      id: markerId(line.id),
      frame: layout.spans.get(line.id).start,
      label: markerText(`${line.role ?? 'line'}: ${firstWords(line.text) || line.id}`),
    }))
}

function sourceMarkers(layout) {
  return layout.visuals
    .filter((visual) => visual.toSource)
    .map((visual, index) => ({
      callerId: `source${index}`,
      op: 'addMarker',
      id: markerId(`src-${visual.id}`),
      frame: visual.start,
      color: TO_SOURCE_COLOR,
      label: markerText(`to source (${visual.trackRole}): ${visual.toSource}`),
    }))
}

/**
 * The op batch that builds a validated performance plan (`layout` and `lines`
 * from ./validate.mjs, speaker and visual media imported) on `project`.
 * Returns `{ ops, placed: { runs, visuals, texts, toSource } }`. Throws when
 * the project has items and neither `replace` nor `markersOnly` is set.
 */
export function buildPerformanceOps(
  plan,
  layout,
  lines,
  { project, format, replace = false, markersOnly = false },
) {
  const ops = clearingOps(project, { replace, markersOnly })
  const toSource = layout.visuals.filter((visual) => visual.toSource)
  let placed = { runs: [], visuals: [], texts: [], toSource }
  if (!markersOnly) {
    const tools = {
      ops,
      fps: plan.fps,
      format,
      findTrack: trackFinder(project, format, ops),
      styleFor: styleFinder(project),
      canvas: {
        width: project.metadata?.width || format.canvas.width,
        height: project.metadata?.height || format.canvas.height,
      },
    }
    placed = {
      runs: placeRuns(layout, tools),
      visuals: placeVisuals(layout, tools),
      texts: placeTexts(layout, tools),
      toSource,
    }
  }
  ops.push(...lineMarkers(layout, lines), ...sourceMarkers(layout))
  return { ops, placed }
}
