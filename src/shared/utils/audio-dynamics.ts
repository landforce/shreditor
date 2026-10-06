/**
 * Per-clip audio dynamics: noise reduction, compressor, de-esser and limiter.
 *
 * Every stage is an optional item field (`audioDenoise`, `audioCompressor`,
 * `audioDeEsser`, `audioLimiter`). Absent, `null` or `enabled: false` means the
 * stage is off, so projects that never touch these fields render exactly as
 * before. Preview and export resolve the same fields through this module and
 * run the same DSP (see `@/infrastructure/audio/clip-dynamics`).
 *
 * Chain order: noise reduction -> EQ -> compressor -> de-esser -> volume/fades -> limiter.
 */
import type {
  ResolvedAudioCompressorSettings,
  ResolvedAudioDeEsserSettings,
  ResolvedAudioDenoiseSettings,
  ResolvedAudioDynamics,
  ResolvedAudioLimiterSettings,
} from '@/types/audio'

interface AudioDynamicsFieldSpec {
  min: number
  max: number
  default: number
}

/** Ranges and defaults for every numeric setting, keyed by item field then setting. */
export const AUDIO_DYNAMICS_FIELD_SPECS = {
  audioDenoise: {
    amount: { min: 0, max: 100, default: 90 },
  },
  audioCompressor: {
    thresholdDb: { min: -60, max: 0, default: -18 },
    ratio: { min: 1, max: 20, default: 3 },
    attackMs: { min: 0.1, max: 200, default: 10 },
    releaseMs: { min: 10, max: 2000, default: 150 },
    makeupDb: { min: 0, max: 24, default: 0 },
    kneeDb: { min: 0, max: 24, default: 6 },
  },
  audioDeEsser: {
    frequencyHz: { min: 3000, max: 12000, default: 6000 },
    thresholdDb: { min: -60, max: 0, default: -30 },
    maxReductionDb: { min: 0, max: 24, default: 8 },
  },
  audioLimiter: {
    ceilingDb: { min: -24, max: 0, default: -1 },
    releaseMs: { min: 1, max: 1000, default: 60 },
  },
} as const satisfies Record<string, Record<string, AudioDynamicsFieldSpec>>

export type AudioDynamicsItemField = keyof typeof AUDIO_DYNAMICS_FIELD_SPECS

/** Anything carrying the four optional item fields (timeline items, project items). */
export type AudioDynamicsFieldSource = Partial<Record<AudioDynamicsItemField, unknown>>

type SettingsOf<F extends AudioDynamicsItemField> = {
  [K in keyof (typeof AUDIO_DYNAMICS_FIELD_SPECS)[F]]: number
}

function resolveStage<F extends AudioDynamicsItemField>(
  field: F,
  value: unknown,
): SettingsOf<F> | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.enabled !== true) return null
  const specs = AUDIO_DYNAMICS_FIELD_SPECS[field] as Record<string, AudioDynamicsFieldSpec>
  const resolved: Record<string, number> = {}
  for (const [key, spec] of Object.entries(specs)) {
    const raw = record[key]
    const numeric = typeof raw === 'number' && Number.isFinite(raw) ? raw : spec.default
    resolved[key] = Math.min(spec.max, Math.max(spec.min, numeric))
  }
  return resolved as SettingsOf<F>
}

/**
 * Resolve the clip dynamics chain for an item, filling defaults and clamping.
 * Returns `null` when no stage is enabled — the common case, which callers use
 * to skip the whole chain.
 */
export function resolveAudioDynamics(
  source: AudioDynamicsFieldSource | null | undefined,
): ResolvedAudioDynamics | null {
  if (!source) return null
  const dynamics: ResolvedAudioDynamics = {
    denoise: resolveStage(
      'audioDenoise',
      source.audioDenoise,
    ) as ResolvedAudioDenoiseSettings | null,
    compressor: resolveStage(
      'audioCompressor',
      source.audioCompressor,
    ) as ResolvedAudioCompressorSettings | null,
    deEsser: resolveStage(
      'audioDeEsser',
      source.audioDeEsser,
    ) as ResolvedAudioDeEsserSettings | null,
    limiter: resolveStage(
      'audioLimiter',
      source.audioLimiter,
    ) as ResolvedAudioLimiterSettings | null,
  }
  return Object.values(dynamics).some(Boolean) ? dynamics : null
}

function areStagesEqual(left: object | null, right: object | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const leftRecord = left as Record<string, number>
  const rightRecord = right as Record<string, number>
  return Object.keys(leftRecord).every((key) => leftRecord[key] === rightRecord[key])
}

export function areAudioDynamicsEqual(
  left: ResolvedAudioDynamics | null | undefined,
  right: ResolvedAudioDynamics | null | undefined,
): boolean {
  if (!left || !right) return !left && !right
  return (
    areStagesEqual(left.denoise, right.denoise) &&
    areStagesEqual(left.compressor, right.compressor) &&
    areStagesEqual(left.deEsser, right.deEsser) &&
    areStagesEqual(left.limiter, right.limiter)
  )
}

/** Whether any dynamics stage is enabled on the item. */
export function hasAudioDynamics(source: AudioDynamicsFieldSource | null | undefined): boolean {
  return resolveAudioDynamics(source) !== null
}

export type AudioDynamicsPresetId = 'voice-gentle' | 'voice-firm' | 'plosive-rumble'

/**
 * One-click starting points. Each is a plain item patch: the voice presets set
 * the compressor (and limiter), the plosive preset turns on the EQ high-pass
 * at 90 Hz, 18 dB/oct, rather than adding a processor of its own.
 */
export const AUDIO_DYNAMICS_PRESETS: ReadonlyArray<{
  id: AudioDynamicsPresetId
  patch: Record<string, unknown>
}> = Object.freeze([
  {
    id: 'voice-gentle',
    patch: {
      audioCompressor: {
        enabled: true,
        thresholdDb: -18,
        ratio: 2,
        attackMs: 15,
        releaseMs: 150,
        makeupDb: 3,
        kneeDb: 6,
      },
    },
  },
  {
    id: 'voice-firm',
    patch: {
      audioCompressor: {
        enabled: true,
        thresholdDb: -26,
        ratio: 4,
        attackMs: 5,
        releaseMs: 100,
        makeupDb: 7,
        kneeDb: 6,
      },
      audioLimiter: { enabled: true, ceilingDb: -1, releaseMs: 60 },
    },
  },
  {
    id: 'plosive-rumble',
    patch: {
      audioEqEnabled: true,
      audioEqBand1Enabled: true,
      audioEqBand1Type: 'high-pass',
      audioEqBand1FrequencyHz: 90,
      audioEqBand1SlopeDbPerOct: 18,
      audioEqLowCutEnabled: true,
      audioEqLowCutFrequencyHz: 90,
      audioEqLowCutSlopeDbPerOct: 18,
    },
  },
])
