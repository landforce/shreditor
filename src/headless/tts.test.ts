import { describe, expect, it } from 'vitest'
import {
  MOSS_TTS_SUPPORTED_LANGUAGES,
  MOSS_TTS_VOICE_OPTIONS,
} from '@/features/editor/services/moss-tts-service'
import {
  SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS,
  SUPERTONIC_TTS_LANGUAGE_OPTIONS,
  SUPERTONIC_TTS_VOICE_OPTIONS,
} from '@/features/editor/services/supertonic-tts-service'
// @ts-expect-error untyped Node module shared with the agent service
import { TTS_ENGINES } from '../../headless/lib/tts-contract.mjs'

const asVoices = (options: ReadonlyArray<{ value: string; label: string }>) =>
  options.map((option) => ({ id: option.value, label: option.label }))

// The agent service validates requests and lists voices from its own catalogue
// (headless/lib/tts-contract.mjs) without a browser; it must match the engines.
describe('agent TTS catalogue', () => {
  it('lists the Supertonic voices, languages and tags the service offers', () => {
    expect(TTS_ENGINES.supertonic.voices).toEqual(asVoices(SUPERTONIC_TTS_VOICE_OPTIONS))
    expect(TTS_ENGINES.supertonic.languages).toEqual(
      SUPERTONIC_TTS_LANGUAGE_OPTIONS.map((option) => option.value),
    )
    expect(TTS_ENGINES.supertonic.expressiveTags).toEqual(
      SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS.map((tag) => tag.value),
    )
  })

  it('lists the MOSS voices and languages the service offers', () => {
    expect(TTS_ENGINES.moss.voices).toEqual(asVoices(MOSS_TTS_VOICE_OPTIONS))
    expect(TTS_ENGINES.moss.spokenLanguages).toEqual([...MOSS_TTS_SUPPORTED_LANGUAGES])
  })
})
