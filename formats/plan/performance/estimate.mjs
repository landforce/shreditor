// What the format's scorecard would say about the cut a performance plan
// makes: its speaker clips, visuals (a visual still to source counts as the
// still it will be) and on-screen text laid out as beats and scored like a
// story plan (../estimate.mjs), speech rate and pauses from the transcripts.
import { planEstimates } from '../estimate.mjs'

const placeholder = (visual, fps) => ({
  mediaId: null,
  fileName: `to-source-${visual.id}`,
  kind: 'image',
  duration: 0,
  sourceFps: fps,
  audioCodec: null,
  category: null,
})

/** The cut as story-plan beats (../validate.mjs ResolvedBeat shape). */
function performanceBeats(layout, fps) {
  const runs = layout.runs.map((run) => ({
    id: run.id,
    start: run.start,
    end: run.end,
    source: { mediaId: run.mediaId, inSec: run.inSec },
    media: run.media,
    trackRole: 'speaker',
    text: null,
  }))
  const visuals = layout.visuals.map((visual) => ({
    id: visual.id,
    start: visual.start,
    end: visual.end,
    source: { inSec: visual.visual.in },
    media: visual.media ?? placeholder(visual, fps),
    trackRole: visual.trackRole,
    text: null,
  }))
  const texts = layout.texts.map((text) => ({
    id: text.id,
    start: text.start,
    end: text.end,
    media: null,
    trackRole: null,
    text,
  }))
  return [...runs, ...visuals, ...texts]
}

/** Scorecard checks for the planned cut (../estimate.mjs planEstimates). */
export function performanceEstimates(plan, layout, format, options) {
  return planEstimates(plan, performanceBeats(layout, plan.fps), format, options)
}
