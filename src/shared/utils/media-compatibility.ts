import type { MediaMetadata, MediaStreamsDescription } from '@/types/storage'

type WithCompatibility = Pick<MediaMetadata, 'compatibility'>

/**
 * True while the media has no usable decode source yet: the workspace bridge is
 * still making its working copy, or couldn't. Such media can't be placed.
 */
export function isMediaPreparationBlocked(media: WithCompatibility | undefined): boolean {
  const status = media?.compatibility?.status
  return status === 'preparing' || status === 'failed'
}

/** Whole-number percent of a working copy in progress. */
export function mediaPreparationPercent(media: WithCompatibility): number {
  return Math.max(0, Math.min(100, Math.round((media.compatibility?.progress ?? 0) * 100)))
}

const CODEC_LABELS: Record<string, string> = {
  prores: 'ProRes',
  h264: 'H.264',
  hevc: 'HEVC',
  vp9: 'VP9',
  av1: 'AV1',
  png: 'PNG',
  qtrle: 'QuickTime Animation',
  dnxhd: 'DNxHD/DNxHR',
  mjpeg: 'Motion JPEG',
  mpeg4: 'MPEG-4 Part 2',
  mpeg2video: 'MPEG-2',
}

function describeStreams(streams: MediaStreamsDescription | undefined): string | null {
  const video = streams?.video
  if (!video) return null
  const parts = [
    CODEC_LABELS[video.codec] ?? video.codec,
    video.codec === 'prores' ? video.profile : undefined,
    video.bitDepth ? `${video.bitDepth}-bit` : undefined,
    video.pixFmt ? `(${video.pixFmt})` : undefined,
    streams?.audio ? `+ ${streams.audio.codec}` : undefined,
  ]
  return parts.filter(Boolean).join(' ')
}

/**
 * One line saying what the working copy was made from and into, for the
 * badge tooltip; null when the media plays from its original.
 */
export function describeWorkingCopy(media: WithCompatibility): string | null {
  const c = media.compatibility
  if (c?.status !== 'ready' || !c.derivative) return null
  const from = describeStreams(c.original) ?? c.originalMimeType ?? 'original'
  const to = describeStreams(c.derivative) ?? 'working copy'
  const how = c.action === 'rewrap' ? 'rewrapped, video copied bit for bit' : c.settings
  const notes = c.notes?.length ? ` ${c.notes.join('; ')}.` : ''
  return `Working copy: ${from} → ${to}${how ? ` (${how})` : ''}.${notes} The original is untouched.`
}
