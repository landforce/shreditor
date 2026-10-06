export type AudioEqCutSlopeDbPerOct = 6 | 12 | 18 | 24
export type AudioEqBand1Type = 'low-shelf' | 'peaking' | 'high-shelf' | 'high-pass'
export type AudioEqInnerBandType = 'low-shelf' | 'peaking' | 'high-shelf' | 'notch'
export type AudioEqBand6Type = 'low-pass' | 'low-shelf' | 'peaking' | 'high-shelf'

export interface AudioEqSettings {
  enabled?: boolean
  outputGainDb?: number
  band1Enabled?: boolean
  band1Type?: AudioEqBand1Type
  band1FrequencyHz?: number
  band1GainDb?: number
  band1Q?: number
  band1SlopeDbPerOct?: AudioEqCutSlopeDbPerOct
  lowCutEnabled?: boolean
  lowCutFrequencyHz?: number
  lowCutSlopeDbPerOct?: AudioEqCutSlopeDbPerOct
  lowEnabled?: boolean
  lowType?: AudioEqInnerBandType
  lowGainDb?: number
  lowFrequencyHz?: number
  lowQ?: number
  lowMidEnabled?: boolean
  lowMidType?: AudioEqInnerBandType
  lowMidGainDb?: number
  lowMidFrequencyHz?: number
  lowMidQ?: number
  midGainDb?: number // Legacy center band retained for backward compatibility
  highMidEnabled?: boolean
  highMidType?: AudioEqInnerBandType
  highMidGainDb?: number
  highMidFrequencyHz?: number
  highMidQ?: number
  highEnabled?: boolean
  highType?: AudioEqInnerBandType
  highGainDb?: number
  highFrequencyHz?: number
  highQ?: number
  band6Enabled?: boolean
  band6Type?: AudioEqBand6Type
  band6FrequencyHz?: number
  band6GainDb?: number
  band6Q?: number
  band6SlopeDbPerOct?: AudioEqCutSlopeDbPerOct
  highCutEnabled?: boolean
  highCutFrequencyHz?: number
  highCutSlopeDbPerOct?: AudioEqCutSlopeDbPerOct
}

export interface ResolvedAudioEqSettings {
  outputGainDb: number
  band1Enabled: boolean
  band1Type: AudioEqBand1Type
  band1FrequencyHz: number
  band1GainDb: number
  band1Q: number
  band1SlopeDbPerOct: AudioEqCutSlopeDbPerOct
  lowCutEnabled: boolean
  lowCutFrequencyHz: number
  lowCutSlopeDbPerOct: AudioEqCutSlopeDbPerOct
  lowEnabled: boolean
  lowType: AudioEqInnerBandType
  lowGainDb: number
  lowFrequencyHz: number
  lowQ: number
  lowMidEnabled: boolean
  lowMidType: AudioEqInnerBandType
  lowMidGainDb: number
  lowMidFrequencyHz: number
  lowMidQ: number
  midGainDb: number
  highMidEnabled: boolean
  highMidType: AudioEqInnerBandType
  highMidGainDb: number
  highMidFrequencyHz: number
  highMidQ: number
  highEnabled: boolean
  highType: AudioEqInnerBandType
  highGainDb: number
  highFrequencyHz: number
  highQ: number
  band6Enabled: boolean
  band6Type: AudioEqBand6Type
  band6FrequencyHz: number
  band6GainDb: number
  band6Q: number
  band6SlopeDbPerOct: AudioEqCutSlopeDbPerOct
  highCutEnabled: boolean
  highCutFrequencyHz: number
  highCutSlopeDbPerOct: AudioEqCutSlopeDbPerOct
}

/**
 * Per-clip noise reduction (RNNoise). Absent or `enabled: false` = off.
 * `amount` is the wet/dry mix in percent (0..100).
 */
export interface AudioDenoiseSettings {
  enabled: boolean
  amount?: number
}

/** Per-clip feed-forward compressor, applied after the EQ and before volume/fades. */
export interface AudioCompressorSettings {
  enabled: boolean
  thresholdDb?: number
  ratio?: number
  attackMs?: number
  releaseMs?: number
  makeupDb?: number
  kneeDb?: number
}

/** Per-clip split-band de-esser: compresses only the band above `frequencyHz`. */
export interface AudioDeEsserSettings {
  enabled: boolean
  frequencyHz?: number
  thresholdDb?: number
  maxReductionDb?: number
}

/** Per-clip lookahead peak limiter, applied after volume and fades. */
export interface AudioLimiterSettings {
  enabled: boolean
  ceilingDb?: number
  releaseMs?: number
}

export interface ResolvedAudioDenoiseSettings {
  amount: number
}

export interface ResolvedAudioCompressorSettings {
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  makeupDb: number
  kneeDb: number
}

export interface ResolvedAudioDeEsserSettings {
  frequencyHz: number
  thresholdDb: number
  maxReductionDb: number
}

export interface ResolvedAudioLimiterSettings {
  ceilingDb: number
  releaseMs: number
}

/** The clip dynamics chain with every stage resolved; `null` = stage off. */
export interface ResolvedAudioDynamics {
  denoise: ResolvedAudioDenoiseSettings | null
  compressor: ResolvedAudioCompressorSettings | null
  deEsser: ResolvedAudioDeEsserSettings | null
  limiter: ResolvedAudioLimiterSettings | null
}
