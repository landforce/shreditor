import { describe, expect, it } from 'vitest'
import { AUDIO_DYNAMICS_FIELD_SPECS, AUDIO_DYNAMICS_PRESETS } from '@/shared/utils/audio-dynamics'
import { timelineItemProblem } from './project-schema'

const baseItem = { id: 'a', type: 'audio', trackId: 't', from: 0, durationInFrames: 30, label: 'a' }

describe('clip dynamics item validation (timelineItemSchema)', () => {
  it('accepts every default, every range edge, null and absent', () => {
    for (const [field, specs] of Object.entries(AUDIO_DYNAMICS_FIELD_SPECS)) {
      const min = Object.fromEntries(Object.entries(specs).map(([k, s]) => [k, s.min]))
      const max = Object.fromEntries(Object.entries(specs).map(([k, s]) => [k, s.max]))
      const defaults = Object.fromEntries(Object.entries(specs).map(([k, s]) => [k, s.default]))
      for (const settings of [min, max, defaults, {}]) {
        expect(timelineItemProblem({ ...baseItem, [field]: { enabled: true, ...settings } })).toBe(
          null,
        )
      }
      expect(timelineItemProblem({ ...baseItem, [field]: null })).toBe(null)
    }
    expect(timelineItemProblem(baseItem)).toBe(null)
  })

  it('rejects out-of-range values, unknown settings and a missing enabled flag', () => {
    expect(
      timelineItemProblem({ ...baseItem, audioCompressor: { enabled: true, ratio: 0.5 } }),
    ).toMatch(/^audioCompressor\.ratio: /)
    expect(
      timelineItemProblem({ ...baseItem, audioDenoise: { enabled: true, amount: 101 } }),
    ).toMatch(/^audioDenoise\.amount: /)
    expect(
      timelineItemProblem({ ...baseItem, audioLimiter: { enabled: true, lookaheadMs: 5 } }),
    ).toMatch(/^audioLimiter: /)
    expect(timelineItemProblem({ ...baseItem, audioDeEsser: { frequencyHz: 6000 } })).toMatch(
      /^audioDeEsser\.enabled: /,
    )
  })

  it('ships presets that validate', () => {
    for (const preset of AUDIO_DYNAMICS_PRESETS) {
      expect(timelineItemProblem({ ...baseItem, ...preset.patch }), preset.id).toBe(null)
    }
  })
})
