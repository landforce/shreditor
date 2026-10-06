import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { embedCubeLut } from '@/infrastructure/gpu-effects/lut/cube-lut'
import { readWorkspaceLut, saveWorkspaceLut } from '@/infrastructure/storage'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import { createLogger } from '@/shared/logging/logger'
import { getEffectDefinitionName } from '@/features/effects/utils/effect-i18n'
import { EffectPanelHeaderRow } from './effect-panel-header-actions'
import { ParamResetButton } from './param-reset-button'
import { LutLibraryRow } from './lut-library-row'
import { useWorkspaceLuts } from '@/features/effects/hooks/use-workspace-luts'
import type { GpuKeyframePanelProps, GpuParamUpdates } from './panel-props'

const logger = createLogger('GpuLutPanel')

/** Keep a copy of a LUT picked from disk in the workspace library (luts/). */
async function saveToLibrary(fileName: string, text: string): Promise<void> {
  try {
    await saveWorkspaceLut(fileName, text)
  } catch (error) {
    logger.warn('Could not save the imported LUT to the library:', error)
  }
}

interface GpuLutPanelProps extends GpuKeyframePanelProps {
  onParamsBatchChange: (effectId: string, updates: GpuParamUpdates) => void
}

/**
 * Panel for the gpu-lut effect: picks a LUT from the workspace library or
 * imports a .cube file (and saves a copy into the library), embeds the
 * (resampled) LUT into the effect params, and exposes an intensity slider.
 */
export const GpuLutPanel = memo(function GpuLutPanel({
  itemIds,
  effect,
  gpuEffect,
  definition,
  getKeyframeProperty,
  onParamChange,
  onParamLiveChange,
  onParamsBatchChange,
  onReset,
  onToggle,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: GpuLutPanelProps) {
  const { t } = useTranslation()
  const [importError, setImportError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const { luts: libraryLuts, refresh: refreshLibrary } = useWorkspaceLuts()

  const lutName = typeof gpuEffect.params.lutName === 'string' ? gpuEffect.params.lutName : ''
  const hasLut = typeof gpuEffect.params.lutData === 'string' && gpuEffect.params.lutData.length > 0
  const intensityParam = definition.params.intensity
  const intensityDefault = typeof intensityParam?.default === 'number' ? intensityParam.default : 1
  const intensity =
    typeof gpuEffect.params.intensity === 'number' ? gpuEffect.params.intensity : intensityDefault
  const lutParamKeys = ['lutName', 'lutSize', 'lutData'] as const
  const lutIsDefault = lutParamKeys.every(
    (key) =>
      (gpuEffect.params[key] ?? definition.params[key]?.default) ===
      definition.params[key]?.default,
  )
  const isDefault = lutIsDefault && intensity === intensityDefault
  const fileLabel = t('effects.lut.file')
  const resetFileLabel = `${t('effects.panel.resetToDefaults')}: ${fileLabel}`

  const handleImport = useCallback(async () => {
    if (typeof window.showOpenFilePicker !== 'function') {
      setImportError(t('effects.lut.unsupportedBrowser'))
      return
    }

    let handles: FileSystemFileHandle[]
    try {
      handles = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: '3D LUT',
            accept: { 'application/octet-stream': ['.cube'] },
          },
        ],
      })
    } catch {
      return // user cancelled the picker
    }

    const handle = handles[0]
    if (!handle) return

    try {
      const file = await handle.getFile()
      const text = await file.text()
      onParamsBatchChange(effect.id, embedCubeLut(text, file.name))
      setImportError(null)
      await saveToLibrary(file.name, text)
      await refreshLibrary()
    } catch (error) {
      logger.warn('Failed to import .cube LUT:', error)
      setImportError(t('effects.lut.importFailed'))
    }
  }, [effect.id, onParamsBatchChange, t, refreshLibrary])

  const handlePickFromLibrary = useCallback(
    async (name: string) => {
      try {
        const text = await readWorkspaceLut(name)
        if (text === null) throw new Error(`luts/${name} is gone`)
        onParamsBatchChange(effect.id, embedCubeLut(text, name))
        setImportError(null)
      } catch (error) {
        logger.warn('Failed to load a LUT from the library:', error)
        setImportError(t('effects.lut.libraryReadFailed'))
        void refreshLibrary()
      }
    },
    [effect.id, onParamsBatchChange, t, refreshLibrary],
  )

  const keyframeProperty = getKeyframeProperty(effect.id, 'intensity')

  return (
    <div className="space-y-0">
      <EffectPanelHeaderRow
        label={getEffectDefinitionName(definition)}
        effectId={effect.id}
        enabled={effect.enabled}
        isDefault={isDefault}
        onReset={onReset}
        onToggle={onToggle}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
      />

      {collapsed ? null : (
        <div className="space-y-0">
          <LutLibraryRow
            luts={libraryLuts}
            disabled={!effect.enabled}
            onPick={handlePickFromLibrary}
            onOpen={refreshLibrary}
          />
          <PropertyRow
            label={t('effects.lut.file')}
            className={!effect.enabled ? 'opacity-50' : undefined}
          >
            <div className="flex items-center gap-1 min-w-0 w-full">
              <Button
                variant="outline"
                size="sm"
                className="h-6 flex-1 min-w-0 justify-start gap-1.5 text-xs"
                onClick={() => void handleImport()}
                disabled={!effect.enabled}
                title={t('effects.lut.importTooltip')}
              >
                <FileUp className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">
                  {hasLut && lutName ? lutName : t('effects.lut.import')}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  onParamsBatchChange(effect.id, {
                    lutName: definition.params.lutName?.default ?? '',
                    lutSize: definition.params.lutSize?.default ?? '0',
                    lutData: definition.params.lutData?.default ?? '',
                  })
                }
                title={resetFileLabel}
                aria-label={resetFileLabel}
                disabled={lutIsDefault}
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </PropertyRow>
          {importError && (
            <div className="px-2 pb-1 text-[11px] text-destructive">{importError}</div>
          )}

          <PropertyRow
            label={t('effects.lut.intensity')}
            className={!effect.enabled ? 'opacity-50' : undefined}
          >
            <SliderInput
              value={intensity}
              onChange={(v) => onParamChange(effect.id, 'intensity', v)}
              onLiveChange={(v) => onParamLiveChange(effect.id, 'intensity', v)}
              min={0}
              max={1}
              step={0.01}
              disabled={!effect.enabled}
              className="flex-1 min-w-0"
            />
            {keyframeProperty ? (
              <KeyframeToggle
                itemIds={itemIds}
                property={keyframeProperty}
                currentValue={intensity}
                disabled={!effect.enabled}
              />
            ) : null}
            {intensityParam ? (
              <ParamResetButton
                effectId={effect.id}
                paramKey="intensity"
                label={t('effects.lut.intensity')}
                value={intensity}
                defaultValue={intensityParam.default}
                onParamChange={onParamChange}
              />
            ) : null}
          </PropertyRow>
        </div>
      )}
    </div>
  )
})
