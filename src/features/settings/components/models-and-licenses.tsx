import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import {
  readNativeTranscriptionEngine,
  type NativeTranscriptionEngine,
} from '@/infrastructure/storage/bridge-fs/bridge-transcription'

/** What runs transcription and media decoding, and under which license. Mirrors THIRD_PARTY_NOTICES.md. */
const COMPONENTS = [
  { name: 'whisper.cpp', license: 'MIT', noteKey: 'settings.models.whisperCpp' },
  { name: 'OpenAI Whisper weights', license: 'MIT', noteKey: 'settings.models.whisperWeights' },
  {
    name: 'NVIDIA Parakeet TDT 0.6B v3',
    license: 'CC-BY-4.0',
    noteKey: 'settings.models.parakeet',
  },
  { name: 'Transformers.js', license: 'Apache-2.0', noteKey: 'settings.models.transformers' },
  { name: 'ONNX Runtime Web', license: 'MIT', noteKey: 'settings.models.onnx' },
  {
    name: 'MODNet portrait matting',
    license: 'Apache-2.0',
    noteKey: 'settings.models.cutoutModnet',
  },
  { name: 'BiRefNet lite', license: 'MIT', noteKey: 'settings.models.cutoutBirefnet' },
  {
    name: 'Mediabunny, @mediabunny/prores',
    license: 'MPL-2.0',
    noteKey: 'settings.models.mediabunny',
  },
  { name: 'FFmpeg', license: 'LGPL/GPL', noteKey: 'settings.models.ffmpeg' },
] as const

export function ModelsAndLicenses() {
  const { t } = useTranslation()
  const [engine, setEngine] = useState<NativeTranscriptionEngine | null>(null)

  useEffect(() => {
    let live = true
    void readNativeTranscriptionEngine().then((info) => live && setEngine(info))
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <Label className="text-sm">{t('settings.models.title')}</Label>
        <p className="text-xs text-muted-foreground">{t('settings.models.local')}</p>
        {engine && (
          <p className="text-xs text-muted-foreground">
            {engine.available
              ? t('settings.models.nativeReady', {
                  version: engine.version ?? '',
                  model: engine.modelName,
                })
              : t('settings.models.nativeMissing', { hint: engine.hint ?? '' })}
          </p>
        )}
      </div>
      <ul className="space-y-1 text-xs">
        {COMPONENTS.map((item) => (
          <li key={item.name} className="flex gap-2">
            <span className="w-24 shrink-0 font-mono text-[11px] text-muted-foreground">
              {item.license}
            </span>
            <span>
              <span className="text-foreground">{item.name}</span>
              <span className="text-muted-foreground"> · {t(item.noteKey)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
