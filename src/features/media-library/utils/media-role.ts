import type { MediaMetadata, MediaTranscriptSegment } from '@/types/storage'
import type { MediaTranscriptStatus } from '../types'

/**
 * Automatic category suggestions for video, from transcript + visual analysis.
 * Only these two categories are ever suggested; everything else (graphics,
 * overlays, music vs SFX vs voiceover) needs a person or the agent to say so.
 *
 * Audio files are left alone on purpose: speech alone can't tell a voiceover
 * from a song with vocals. Images are not guessed either (photo or graphic).
 */
export type VideoCategoryVerdict = 'speaker' | 'b-roll' | 'pending'

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

/** Native (bridge) transcription is still to finish for this media. */
function nativeInProgress(media: Pick<MediaMetadata, 'transcription'>): boolean {
  const status = media.transcription?.status
  return status === 'queued' || status === 'running'
}

/**
 * - `speaker`: someone talking for most of the clip (A-roll / talking head)
 * - `b-roll`: no audio, no speech, little speech, or speech over footage with
 *   no one in frame (voiceover over b-roll; the clip itself is b-roll footage)
 * - `pending`: a transcript is still coming (bridge or background pass)
 * - undefined: nothing to go on and nothing coming (analysis off, or the
 *   in-app transcription failed until the next project open)
 */
export function suggestVideoCategory(input: {
  media: Pick<MediaMetadata, 'aiCaptions' | 'audioCodec' | 'transcription'>
  transcriptStatus: MediaTranscriptStatus | undefined
  /** Undefined while the transcript is still being read. */
  speechCoverage: number | undefined
  /** The background pass is on, so a missing transcript will be made. */
  analysisEnabled: boolean
}): VideoCategoryVerdict | undefined {
  const { media, transcriptStatus, speechCoverage, analysisEnabled } = input
  if (!hasAudioTrack(media)) return 'b-roll'
  // The bridge's native transcriber found no speech (silent, music, typing...)
  if (media.transcription?.status === 'none') return 'b-roll'
  if (transcriptStatus === 'ready') {
    if (speechCoverage === undefined) return 'pending'
    if (speechCoverage < SPEAKER_SPEECH_COVERAGE) return 'b-roll'
    // Speech over footage where no one is ever in frame reads as voiceover b-roll.
    return captionsShowPerson(media) === false ? 'b-roll' : 'speaker'
  }
  if (transcriptStatus === 'queued' || transcriptStatus === 'transcribing') return 'pending'
  if (nativeInProgress(media)) return 'pending'
  if (transcriptStatus === 'error') return undefined
  return analysisEnabled ? 'pending' : undefined
}
