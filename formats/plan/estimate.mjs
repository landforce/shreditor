// What the format's scorecard would say about the edit a plan builds, before
// anything is built: the plan laid out as a timeline (each beat's clip on its
// track, planned text, linked audio unless the format drops sync sound) and
// scored with ../scorecard.mjs. Only the title hook and the numeric targets are
// kept: captions, music and the rest are added in the edit, not the plan.
import { scoreProject } from '../scorecard.mjs'

const mediaKey = (media) => media.mediaId ?? `asset:${media.fileName}`

function clipItems(beat, fps, keepSyncSound) {
  const { media } = beat
  const base = {
    id: beat.id,
    trackId: `plan-${beat.trackRole}`,
    from: beat.start,
    durationInFrames: beat.end - beat.start,
    mediaId: mediaKey(media),
    volume: 0,
  }
  if (media.kind === 'image') return [{ ...base, type: 'image' }]
  const sourceFps = media.sourceFps || fps
  const sourceStart = Math.round(beat.source.inSec * sourceFps)
  const window = {
    sourceFps,
    sourceStart,
    sourceEnd: sourceStart + Math.round((base.durationInFrames / fps) * sourceFps),
  }
  if (media.kind === 'audio') return [{ ...base, ...window, type: 'audio' }]
  const video = { ...base, ...window, type: 'video', linkedGroupId: beat.id }
  if (!media.audioCodec || !keepSyncSound) return [{ ...video, embeddedAudioMuted: true }]
  return [video, { ...video, id: `${beat.id}-audio`, type: 'audio', trackId: 'plan-audio' }]
}

const textItem = (beat, height) => ({
  id: `${beat.id}-text`,
  type: 'text',
  trackId: `plan-text-${beat.text.role}`,
  formatRole: beat.text.role,
  from: beat.text.start,
  durationInFrames: beat.text.end - beat.text.start,
  text: beat.text.text,
  transform: { y: beat.text.role === 'title' ? -height / 4 : height / 4 },
})

/** The timeline the plan's beats make, as a project the scorecard reads. */
function planProject(plan, beats, format) {
  const keep = format.rules.syncSound !== 'none'
  const placed = beats.filter((beat) => beat.media && beat.trackRole)
  const items = [
    ...placed.flatMap((beat) => clipItems(beat, plan.fps, keep)),
    ...beats.filter((beat) => beat.text).map((beat) => textItem(beat, format.canvas.height)),
  ]
  const trackIds = [...new Set(items.map((item) => item.trackId))]
  return {
    metadata: { fps: plan.fps, height: format.canvas.height },
    format: { id: format.id, ...(format.variant ? { variant: format.variant.id } : {}) },
    timeline: {
      tracks: trackIds.map((id, order) => {
        const role = id.replace(/^plan-(text-)?/, '')
        return { id, name: id, order, visible: true, ...(role !== 'audio' && { formatRole: role }) }
      }),
      items,
    },
  }
}

/**
 * Scorecard checks for the planned edit: the title hook, its hold and every
 * numeric target the plan can be measured on (`na` ones dropped). `transcripts`
 * (by media id) lets speech rate and pauses be estimated too.
 */
export function planEstimates(plan, beats, format, { transcripts } = {}) {
  const mediaById = Object.fromEntries(
    beats.filter((beat) => beat.media).map((beat) => [mediaKey(beat.media), beat.media]),
  )
  const card = scoreProject(planProject(plan, beats, format), {
    format,
    mediaById,
    transcripts,
  })
  const targets = new Set(['titleHook', 'titleHold', ...format.targets.map((t) => t.key)])
  return card.checks.filter((check) => targets.has(check.key) && check.status !== 'na')
}
