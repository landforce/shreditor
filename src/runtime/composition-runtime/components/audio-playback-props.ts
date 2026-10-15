import type { AudioClipFadeSpan } from '@/shared/utils/audio-fade-curve'
import type { ResolvedAudioDynamics, ResolvedAudioEqSettings } from '@/types/audio'
import type { SpeedRampKey } from '@/shared/timeline/speed-ramp.mjs'

/**
 * Shared clip-level playback controls used by all preview audio backends.
 * Transport-specific components add source identifiers on top of this shape.
 */
export interface AudioPlaybackProps {
  itemId: string
  liveGainItemIds?: string[]
  trimBefore?: number
  sourceFps?: number
  volume?: number
  playbackRate?: number
  /**
   * A speed ramp in Sequence-local frames (replaces playbackRate). Preview plays
   * it on the native element, pitch kept, with the rate set every frame.
   */
  speedRamp?: readonly SpeedRampKey[]
  isReversed?: boolean
  reverseSourceEnd?: number
  muted?: boolean
  durationInFrames: number
  audioFadeIn?: number
  audioFadeOut?: number
  audioFadeInCurve?: number
  audioFadeOutCurve?: number
  audioFadeInCurveX?: number
  audioFadeOutCurveX?: number
  /** Pitch offset in whole semitones (-12 to +12), set per-clip by the user */
  audioPitchSemitones?: number
  /** Fine pitch adjustment in cents (-100 to +100), applied additively after semitones */
  audioPitchCents?: number
  /** Pre-computed total pitch shift in semitones (semitones + cents/100 + parent composition shift) */
  audioPitchShiftSemitones?: number
  audioEqStages?: ResolvedAudioEqSettings[]
  /** Clip noise reduction / compressor / de-esser / limiter; null = all off. */
  audioDynamics?: ResolvedAudioDynamics | null
  clipFadeSpans?: AudioClipFadeSpan[]
  contentStartOffsetFrames?: number
  contentEndOffsetFrames?: number
  fadeInDelayFrames?: number
  fadeOutLeadFrames?: number
  crossfadeFadeIn?: number
  crossfadeFadeOut?: number
  volumeMultiplier?: number
}
