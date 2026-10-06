import type { MediaMetadata, MediaTranscriptSegment } from '@/types/storage'
import type { MediaTranscriptStatus } from '../types'

/**
 * What a video clip is for in the edit, derived from transcript + visual analysis:
 * - `speaker`: someone talking for most of the clip (A-roll / talking head)
 * - `broll`: little or no speech, or speech over footage with no one in frame
 * - `pending`: not analyzed yet
 */
export type MediaRole = 'speaker' | 'broll' | 'pending'

/** Share of the clip that must be speech before it counts as a speaker clip. */
const SPEAKER_SPEECH_COVERAGE = 0.3

const PERSON_PATTERN =
  /\b(man|men|woman|women|person|people|guy|girl|boy|presenter|speaker|host|vlogger|face|someone|he|she)\b/i

/** Fraction (0–1) of the media's duration covered by transcript segments. */
export function computeSpeechCoverage(
  segments: readonly Pick<MediaTranscriptSegment, 'start' | 'end'>[],
  durationSec: number,
): number {
  if (!(durationSec > 0) || segments.length === 0) return 0
  const spans = segments
    .map((s) => [Math.max(0, s.start), Math.min(durationSec, s.end)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])

  // Union of spans, so overlapping segments are not double-counted
  let covered = 0
  let runStart = -1
  let runEnd = -1
  for (const [start, end] of spans) {
    if (start > runEnd) {
      if (runEnd > runStart) covered += runEnd - runStart
      runStart = start
      runEnd = end
    } else if (end > runEnd) {
      runEnd = end
    }
  }
  if (runEnd > runStart) covered += runEnd - runStart
  return Math.min(1, covered / durationSec)
}

/** Whether visual analysis saw a person in any sampled frame. Undefined when not analyzed. */
function captionsShowPerson(media: Pick<MediaMetadata, 'aiCaptions'>): boolean | undefined {
  const captions = media.aiCaptions
  if (!captions || captions.length === 0) return undefined
  return captions.some((caption) => {
    const text = [caption.text, caption.sceneData?.caption, ...(caption.sceneData?.subjects ?? [])]
      .filter(Boolean)
      .join(' ')
    return PERSON_PATTERN.test(text)
  })
}

/** Videos imported without an audio track can't contain speech. */
export function hasAudioTrack(media: Pick<MediaMetadata, 'audioCodec'>): boolean {
  return Boolean(media.audioCodec)
}

export function classifyMediaRole(input: {
  media: Pick<MediaMetadata, 'aiCaptions' | 'audioCodec'>
  transcriptStatus: MediaTranscriptStatus | undefined
  /** Undefined while the transcript is still being read. */
  speechCoverage: number | undefined
}): MediaRole {
  const { media, transcriptStatus, speechCoverage } = input
  if (!hasAudioTrack(media)) return 'broll'
  // Not transcribed yet, or transcription failed (e.g. model download) - unknown
  if (transcriptStatus !== 'ready' || speechCoverage === undefined) return 'pending'
  if (speechCoverage < SPEAKER_SPEECH_COVERAGE) return 'broll'
  // Speech over footage where no one is ever in frame reads as voiceover b-roll.
  return captionsShowPerson(media) === false ? 'broll' : 'speaker'
}
