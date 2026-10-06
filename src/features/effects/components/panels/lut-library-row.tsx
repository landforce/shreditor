import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { WorkspaceLut } from '@/infrastructure/storage'
import { PropertyRow } from '@/shared/ui/property-controls'

interface LutLibraryRowProps {
  luts: readonly WorkspaceLut[]
  disabled: boolean
  /** Called with the picked file name in `luts/`. */
  onPick: (name: string) => Promise<void>
  /** Re-read the library when the picker opens, so new files show up. */
  onOpen: () => Promise<void>
}

/** "Library" picker for the gpu-lut panel: the `.cube` files in the workspace's `luts/`. */
export const LutLibraryRow = memo(function LutLibraryRow({
  luts,
  disabled,
  onPick,
  onOpen,
}: LutLibraryRowProps) {
  const { t } = useTranslation()
  const empty = luts.length === 0

  return (
    <PropertyRow label={t('effects.lut.library')} className={disabled ? 'opacity-50' : undefined}>
      <Select
        value=""
        onValueChange={(name) => void onPick(name)}
        onOpenChange={(open) => {
          if (open) void onOpen()
        }}
        disabled={disabled}
      >
        <SelectTrigger
          className="h-6 text-xs flex-1 min-w-0"
          aria-label={t('effects.lut.library')}
          title={t('effects.lut.libraryTooltip')}
        >
          <SelectValue
            placeholder={
              empty ? t('effects.lut.libraryEmpty') : t('effects.lut.libraryPlaceholder')
            }
          />
        </SelectTrigger>
        <SelectContent>
          {luts.map((lut) => (
            <SelectItem key={lut.name} value={lut.name} className="text-xs">
              <span className="truncate">{lut.name}</span>
              {lut.title ? (
                <span className="ml-2 truncate text-muted-foreground">{lut.title}</span>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PropertyRow>
  )
})
