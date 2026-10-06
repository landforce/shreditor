import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TimelineItem } from '@/types/timeline'
import { executeTimelineCommand, useTimelineStore } from '@/features/editor/deps/timeline-store'
import {
  AUDIO_DYNAMICS_FIELD_SPECS,
  AUDIO_DYNAMICS_PRESETS,
  type AudioDynamicsItemField,
  type AudioDynamicsPresetId,
} from '@/shared/utils/audio-dynamics'
import { PropertyRow, PropertySection, SliderInput } from '../components'
import { getMixedValue } from '../utils'
import { getAudioSectionItems, type AudioCapableItem } from './audio-section-utils'

type DynamicsLabelKey =
  | 'editor.audioSection.noiseReduction'
  | 'editor.audioSection.compressor'
  | 'editor.audioSection.deEsser'
  | 'editor.audioSection.limiter'
  | 'editor.audioSection.amount'
  | 'editor.audioSection.threshold'
  | 'editor.audioSection.ratio'
  | 'editor.audioSection.attack'
  | 'editor.audioSection.release'
  | 'editor.audioSection.makeup'
  | 'editor.audioSection.knee'
  | 'editor.audioSection.frequency'
  | 'editor.audioSection.maxReduction'
  | 'editor.audioSection.ceiling'
  | 'editor.audioSection.presetVoiceGentle'
  | 'editor.audioSection.presetVoiceFirm'
  | 'editor.audioSection.presetPlosiveRumble'

interface DynamicsControl {
  key: string
  labelKey: DynamicsLabelKey
  step: number
  unit: string
}

interface DynamicsStageControls {
  field: AudioDynamicsItemField
  titleKey: DynamicsLabelKey
  controls: DynamicsControl[]
}

/** One block per stage, in chain order. Ranges and defaults come from the field specs. */
const DYNAMICS_STAGES: DynamicsStageControls[] = [
  {
    field: 'audioDenoise',
    titleKey: 'editor.audioSection.noiseReduction',
    controls: [{ key: 'amount', labelKey: 'editor.audioSection.amount', step: 1, unit: '%' }],
  },
  {
    field: 'audioCompressor',
    titleKey: 'editor.audioSection.compressor',
    controls: [
      { key: 'thresholdDb', labelKey: 'editor.audioSection.threshold', step: 0.5, unit: 'dB' },
      { key: 'ratio', labelKey: 'editor.audioSection.ratio', step: 0.1, unit: ':1' },
      { key: 'attackMs', labelKey: 'editor.audioSection.attack', step: 0.1, unit: 'ms' },
      { key: 'releaseMs', labelKey: 'editor.audioSection.release', step: 1, unit: 'ms' },
      { key: 'makeupDb', labelKey: 'editor.audioSection.makeup', step: 0.5, unit: 'dB' },
      { key: 'kneeDb', labelKey: 'editor.audioSection.knee', step: 0.5, unit: 'dB' },
    ],
  },
  {
    field: 'audioDeEsser',
    titleKey: 'editor.audioSection.deEsser',
    controls: [
      { key: 'frequencyHz', labelKey: 'editor.audioSection.frequency', step: 100, unit: 'Hz' },
      { key: 'thresholdDb', labelKey: 'editor.audioSection.threshold', step: 0.5, unit: 'dB' },
      {
        key: 'maxReductionDb',
        labelKey: 'editor.audioSection.maxReduction',
        step: 0.5,
        unit: 'dB',
      },
    ],
  },
  {
    field: 'audioLimiter',
    titleKey: 'editor.audioSection.limiter',
    controls: [
      { key: 'ceilingDb', labelKey: 'editor.audioSection.ceiling', step: 0.1, unit: 'dB' },
      { key: 'releaseMs', labelKey: 'editor.audioSection.release', step: 1, unit: 'ms' },
    ],
  },
]

const PRESET_LABEL_KEYS: Record<AudioDynamicsPresetId, DynamicsLabelKey> = {
  'voice-gentle': 'editor.audioSection.presetVoiceGentle',
  'voice-firm': 'editor.audioSection.presetVoiceFirm',
  'plosive-rumble': 'editor.audioSection.presetPlosiveRumble',
}

type StageRecord = Record<string, unknown> & { enabled?: boolean }

function readStage(item: AudioCapableItem, field: AudioDynamicsItemField): StageRecord {
  return (item[field] as StageRecord | null | undefined) ?? {}
}

function getSpec(field: AudioDynamicsItemField, key: string) {
  return (
    AUDIO_DYNAMICS_FIELD_SPECS[field] as Record<
      string,
      { min: number; max: number; default: number }
    >
  )[key]!
}

function StageBlock({
  stage,
  items,
  onPatch,
}: {
  stage: DynamicsStageControls
  items: AudioCapableItem[]
  onPatch: (field: AudioDynamicsItemField, patch: StageRecord) => void
}) {
  const { t } = useTranslation()
  const enabled = items.every((item) => readStage(item, stage.field).enabled === true)
  const title = t(stage.titleKey)

  return (
    <div className="border-t border-border/50 pt-1 first:border-t-0 first:pt-0">
      <PropertyRow label={title}>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onPatch(stage.field, { enabled: checked })}
          aria-label={title}
        />
      </PropertyRow>
      {enabled &&
        stage.controls.map((control) => {
          const spec = getSpec(stage.field, control.key)
          const value = getMixedValue(
            items,
            (item) => readStage(item, stage.field)[control.key] as number | undefined,
            spec.default,
          )
          return (
            <PropertyRow key={control.key} label={t(control.labelKey)}>
              <SliderInput
                value={value}
                onChange={(next) => onPatch(stage.field, { [control.key]: next })}
                onLiveChange={() => {}}
                min={spec.min}
                max={spec.max}
                step={control.step}
                unit={control.unit}
                className="flex-1 min-w-0"
              />
            </PropertyRow>
          )
        })}
    </div>
  )
}

/**
 * Noise reduction, compressor, de-esser and limiter for the selected clips.
 * Nothing here is automatic: every stage stays off until switched on.
 */
export function AudioDynamicsSection({ items }: { items: TimelineItem[] }) {
  const { t } = useTranslation()
  const updateItem = useTimelineStore((s) => s.updateItem)
  const audioItems = useMemo(() => getAudioSectionItems(items), [items])

  const handlePatch = useCallback(
    (field: AudioDynamicsItemField, patch: StageRecord) => {
      // A clip and its own audio (or several clips) change in one undo step.
      executeTimelineCommand('SET_AUDIO_DYNAMICS', () => {
        for (const item of audioItems) {
          const current = readStage(item, field)
          const next = { ...current, enabled: current.enabled === true, ...patch }
          updateItem(item.id, { [field]: next } as Partial<TimelineItem>)
        }
      })
    },
    [audioItems, updateItem],
  )

  const handlePreset = useCallback(
    (presetId: string) => {
      const preset = AUDIO_DYNAMICS_PRESETS.find((entry) => entry.id === presetId)
      if (!preset) return
      executeTimelineCommand('SET_AUDIO_DYNAMICS', () => {
        for (const item of audioItems) updateItem(item.id, preset.patch as Partial<TimelineItem>)
      })
    },
    [audioItems, updateItem],
  )

  if (audioItems.length === 0) return null

  return (
    <PropertySection title={t('editor.audioSection.dynamics')} icon={Activity} defaultOpen={false}>
      <PropertyRow label={t('editor.audioSection.preset')}>
        <Select value="" onValueChange={handlePreset}>
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
            <SelectValue placeholder={t('editor.audioSection.applyPreset')} />
          </SelectTrigger>
          <SelectContent>
            {AUDIO_DYNAMICS_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id} className="text-xs">
                {t(PRESET_LABEL_KEYS[preset.id])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>
      {DYNAMICS_STAGES.map((stage) => (
        <StageBlock key={stage.field} stage={stage} items={audioItems} onPatch={handlePatch} />
      ))}
    </PropertySection>
  )
}
