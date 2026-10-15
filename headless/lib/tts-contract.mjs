// Text to speech on the agent service (POST /v1/tts): the engines, their
// preset voices and options, and the request schema.
//
// The engines are the editor's own (src/features/editor/services/
// supertonic-tts-service.ts and moss-tts-service.ts), run in the headless
// harness page (src/headless/tts.ts). This catalogue is what Node needs to
// validate a request and answer `shred tts voices` without a browser; it
// mirrors the services' exported option lists, and src/headless/tts.test.ts
// fails when the two drift apart.
import { z } from 'zod'

/** Most characters one request synthesizes; `shred tts` splits longer scripts by sentence. */
export const TTS_MAX_TEXT_CHARS = 5000

const SUPERTONIC_LANGUAGES = [
  ['en', 'English'],
  ['ko', 'Korean'],
  ['ja', 'Japanese'],
  ['ar', 'Arabic'],
  ['bg', 'Bulgarian'],
  ['cs', 'Czech'],
  ['da', 'Danish'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['es', 'Spanish'],
  ['et', 'Estonian'],
  ['fi', 'Finnish'],
  ['fr', 'French'],
  ['hi', 'Hindi'],
  ['hr', 'Croatian'],
  ['hu', 'Hungarian'],
  ['id', 'Indonesian'],
  ['it', 'Italian'],
  ['lt', 'Lithuanian'],
  ['lv', 'Latvian'],
  ['nl', 'Dutch'],
  ['pl', 'Polish'],
  ['pt', 'Portuguese'],
  ['ro', 'Romanian'],
  ['ru', 'Russian'],
  ['sk', 'Slovak'],
  ['sl', 'Slovenian'],
  ['sv', 'Swedish'],
  ['tr', 'Turkish'],
  ['uk', 'Ukrainian'],
  ['vi', 'Vietnamese'],
]

/**
 * engine id -> what it is, its preset voices (id + the dialog's label), its
 * options and roughly what the first run downloads. Preset voices only: neither
 * engine clones a voice.
 */
export const TTS_ENGINES = {
  supertonic: {
    label: 'Supertonic 3',
    model: 'supertonic-3',
    defaultVoice: 'M3',
    voices: [
      { id: 'F1', label: 'Sarah (F)' },
      { id: 'F2', label: 'Lily (F)' },
      { id: 'F3', label: 'Jessica (F)' },
      { id: 'F4', label: 'Olivia (F)' },
      { id: 'F5', label: 'Emily (F)' },
      { id: 'M1', label: 'Alex (M)' },
      { id: 'M2', label: 'James (M)' },
      { id: 'M3', label: 'Robert (M)' },
      { id: 'M4', label: 'Sam (M)' },
      { id: 'M5', label: 'Daniel (M)' },
    ],
    // 'auto' detects the language from the text (English when it can't tell).
    languages: ['auto', ...SUPERTONIC_LANGUAGES.map(([code]) => code)],
    languageNames: Object.fromEntries(SUPERTONIC_LANGUAGES),
    speed: { min: 0.8, max: 1.3, default: 1 },
    // Inline in the text, where the sound should happen.
    expressiveTags: ['<laugh>', '<breath>', '<sigh>'],
    backends: ['webgpu', 'wasm'],
    downloadBytes: 398_000_000,
  },
  moss: {
    label: 'MOSS Nano (multilingual)',
    model: 'nano-zh',
    defaultVoice: 'Ava',
    voices: [
      { id: 'Junhao', label: 'Junhao (ZH, M)' },
      { id: 'Zhiming', label: 'Zhiming (ZH, M)' },
      { id: 'Weiguo', label: 'Weiguo (ZH, M)' },
      { id: 'Xiaoyu', label: 'Xiaoyu (ZH, F)' },
      { id: 'Yuewen', label: 'Yuewen (ZH, F)' },
      { id: 'Lingyu', label: 'Lingyu (ZH, F)' },
      { id: 'Trump', label: 'Trump (EN, M)' },
      { id: 'Ava', label: 'Ava (EN, F)' },
      { id: 'Bella', label: 'Bella (EN, F)' },
      { id: 'Adam', label: 'Adam (EN, M)' },
      { id: 'Nathan', label: 'Nathan (EN, M)' },
      { id: 'Soyo', label: 'Soyo (JA, F)' },
      { id: 'Saki', label: 'Saki (JA, F)' },
      { id: 'Mortis', label: 'Mortis (JA, F)' },
      { id: 'Umiri', label: 'Umiri (JA, F)' },
      { id: 'Mei', label: 'Mei (JA, F)' },
      { id: 'Anon', label: 'Anon (JA, F)' },
      { id: 'Arisa', label: 'Arisa (JA, F)' },
    ],
    // The language follows the text; there is no language option.
    languages: [],
    spokenLanguages: [
      'Chinese',
      'English',
      'Japanese',
      'Korean',
      'Spanish',
      'French',
      'German',
      'Italian',
      'Hungarian',
      'Russian',
      'Persian',
      'Arabic',
      'Polish',
      'Portuguese',
      'Czech',
      'Danish',
      'Swedish',
      'Greek',
      'Turkish',
    ],
    // Applied after synthesis by resampling (pitch moves with it).
    speed: { min: 0.5, max: 2, default: 1 },
    expressiveTags: [],
    backends: ['wasm'],
    downloadBytes: 785_000_000,
  },
}

export const TTS_ENGINE_IDS = /** @type {['supertonic', 'moss']} */ (Object.keys(TTS_ENGINES))
export const DEFAULT_TTS_ENGINE = 'supertonic'

const voiceProblem = (engine, voice) =>
  voice !== undefined && !engine.voices.some((v) => v.id === voice)
    ? `voice must be one of ${engine.voices.map((v) => v.id).join(', ')}`
    : null

const languageProblem = (engine, language) => {
  if (language === undefined || engine.languages.includes(language)) return null
  return engine.languages.length
    ? `language must be one of ${engine.languages.join(', ')}`
    : `${engine.label} takes its language from the text: leave language out`
}

const speedProblem = (engine, speed) =>
  speed !== undefined && (speed < engine.speed.min || speed > engine.speed.max)
    ? `speed must be between ${engine.speed.min} and ${engine.speed.max}`
    : null

export const ttsRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(TTS_MAX_TEXT_CHARS),
    engine: z.enum(TTS_ENGINE_IDS).optional(),
    voice: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    speed: z.number().finite().optional(),
  })
  .strict()
  // Voice, language and speed depend on the engine.
  .superRefine((value, ctx) => {
    const engine = TTS_ENGINES[value.engine ?? DEFAULT_TTS_ENGINE]
    const problems = {
      voice: voiceProblem(engine, value.voice),
      language: languageProblem(engine, value.language),
      speed: speedProblem(engine, value.speed),
    }
    for (const [path, message] of Object.entries(problems))
      if (message) ctx.addIssue({ code: 'custom', path: [path], message })
  })

/** A validated request with every default filled in: what the harness page is asked for. */
export function resolveTtsRequest(body) {
  const engine = body.engine ?? DEFAULT_TTS_ENGINE
  const spec = TTS_ENGINES[engine]
  return {
    text: body.text,
    engine,
    voice: body.voice ?? spec.defaultVoice,
    ...(spec.languages.length ? { language: body.language ?? 'auto' } : {}),
    speed: body.speed ?? spec.speed.default,
  }
}

/**
 * The `tts` block of GET /v1/capabilities: compact (voice ids, language codes),
 * since an agent reads capabilities whole; `shred tts voices` has the labels.
 */
export function ttsCapabilities() {
  return {
    // Answers audio/wav; the X-Freecut-Tts header is { engine, voice, backend, durationSeconds, ... }.
    route: 'POST /v1/tts',
    defaultEngine: DEFAULT_TTS_ENGINE,
    maxTextChars: TTS_MAX_TEXT_CHARS,
    voiceCloning: false,
    engines: Object.fromEntries(
      Object.entries(TTS_ENGINES).map(([id, spec]) => [
        id,
        {
          voices: spec.voices.map((voice) => voice.id),
          defaultVoice: spec.defaultVoice,
          languages: spec.languages,
          speed: spec.speed,
          expressiveTags: spec.expressiveTags,
          backends: spec.backends,
        },
      ]),
    ),
  }
}
