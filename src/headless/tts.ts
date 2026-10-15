/**
 * Text to speech in the headless harness: the editor's own Supertonic and MOSS
 * services (the AI panel's TTS dialog uses the same ones), driven by the agent
 * service's POST /v1/tts. The WAV leaves the page as a download, like a frame
 * grab; the summary says which backend ran (WebGPU when Supertonic can use it,
 * else wasm; MOSS is wasm only).
 *
 * The services load lazily, so a harness that never speaks never pulls in
 * onnxruntime-web. Model weights come from Hugging Face; the agent service
 * answers those requests from its on-disk model cache
 * (headless/lib/tts-model-cache.mjs), so only the first run downloads.
 */
import type { MossTtsVoice } from '@/features/editor/services/moss-tts-service'
import type {
  SupertonicTtsLanguageSelection,
  SupertonicTtsVoice,
} from '@/features/editor/services/supertonic-tts-service'

export interface HeadlessTtsInput {
  text: string
  engine: 'supertonic' | 'moss'
  voice: string
  language?: string
  speed: number
  /** Download name for the WAV (the driver saves it where it wants). */
  fileName?: string
}

export interface HeadlessTtsSummary {
  ok: true
  engine: 'supertonic' | 'moss'
  voice: string
  language?: string
  speed: number
  backend: 'webgpu' | 'wasm'
  durationSeconds: number
  fileName: string
  fileSize: number
  generationMs: number
  progress: string[]
}

async function synthesize(input: HeadlessTtsInput, onProgress: (stage: string) => void) {
  if (input.engine === 'moss') {
    const { mossTtsService } = await import('@/features/editor/services/moss-tts-service')
    return mossTtsService.generateSpeechFile({
      text: input.text,
      voice: input.voice as MossTtsVoice,
      speed: input.speed,
      onProgress,
    })
  }
  const { supertonicTtsService } = await import('@/features/editor/services/supertonic-tts-service')
  return supertonicTtsService.generateSpeechFile({
    text: input.text,
    voice: input.voice as SupertonicTtsVoice,
    language: (input.language ?? 'auto') as SupertonicTtsLanguageSelection,
    speed: input.speed,
    onProgress,
  })
}

/**
 * Speak `text` with one engine and voice; the WAV leaves through `download`
 * (the harness's own download trigger), the summary is returned.
 */
export async function generateSpeech(
  input: HeadlessTtsInput,
  download: (blob: Blob, fileName: string) => void,
): Promise<HeadlessTtsSummary> {
  const t0 = performance.now()
  const progress: string[] = []
  const result = await synthesize(input, (stage) => {
    if (progress.at(-1) !== stage) progress.push(stage)
  })
  const fileName = input.fileName ?? result.file.name
  download(result.blob, fileName)
  return {
    ok: true,
    engine: input.engine,
    voice: input.voice,
    ...(input.language ? { language: input.language } : {}),
    speed: input.speed,
    backend: result.backend,
    durationSeconds: result.duration,
    fileName,
    fileSize: result.blob.size,
    generationMs: Math.round(performance.now() - t0),
    progress,
  }
}
