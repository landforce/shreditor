import { Link2, Link2Off } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { TextItem } from '@/types/timeline'
import type { ItemPropertiesPreview } from '@/features/editor/deps/preview'
import { KeyframeToggle } from '@/features/editor/deps/keyframes'
import { NumberInput, PropertyRow } from '../components'

const DEFAULT_PADDING = 16

type PaddingField = 'textPadding' | 'textPaddingX' | 'textPaddingY'

/** The padding a field resolves to on an item (X and Y fall back to the one value). */
function paddingOf(item: TextItem, field: PaddingField): number {
  const one = item.textPadding ?? DEFAULT_PADDING
  if (field === 'textPadding') return one
  return item[field] ?? one
}

/** The value every item shares, else 'mixed'. */
function sharedPadding(items: readonly TextItem[], field: PaddingField): number | 'mixed' {
  const first = items[0] ? paddingOf(items[0], field) : DEFAULT_PADDING
  return items.every((item) => paddingOf(item, field) === first) ? first : 'mixed'
}

/** Whether any item pads left/right differently from top/bottom (its own X or Y). */
function hasSplitPadding(items: readonly TextItem[]): boolean {
  return items.some((item) => item.textPaddingX !== undefined || item.textPaddingY !== undefined)
}

interface TextPaddingControlProps {
  items: readonly TextItem[]
  itemIds: string[]
  onChange: (updates: Partial<TextItem>) => void
  onLiveChange: (preview: ItemPropertiesPreview) => void
}

/**
 * Text box padding: one value (keyframable), or split into left/right and
 * top/bottom (`textPaddingX` / `textPaddingY`, as a creator kit's title box
 * has). The link button splits or joins them.
 */
export function TextPaddingControl({
  items,
  itemIds,
  onChange,
  onLiveChange,
}: TextPaddingControlProps) {
  const { t } = useTranslation()
  const split = hasSplitPadding(items)
  const join = () => {
    const vertical = sharedPadding(items, 'textPaddingY')
    onChange({
      textPaddingX: undefined,
      textPaddingY: undefined,
      ...(vertical === 'mixed' ? {} : { textPadding: vertical }),
    })
  }
  const splitApart = () => {
    const one = sharedPadding(items, 'textPadding')
    const value = one === 'mixed' ? DEFAULT_PADDING : one
    onChange({ textPaddingX: value, textPaddingY: value })
  }
  const field = (name: PaddingField, label?: string) => (
    <NumberInput
      value={sharedPadding(items, name)}
      onChange={(value) => onChange({ [name]: value })}
      onLiveChange={(value) => onLiveChange({ [name]: value })}
      min={0}
      max={160}
      step={1}
      unit="px"
      label={label}
      className="flex-1 min-w-0"
    />
  )
  return (
    <PropertyRow label={t('editor.textSection.padding')}>
      <div className="flex items-center gap-1 min-w-0 w-full">
        {split ? (
          <>
            {field('textPaddingX', t('editor.textSection.paddingHorizontalShort'))}
            {field('textPaddingY', t('editor.textSection.paddingVerticalShort'))}
          </>
        ) : (
          <>
            {field('textPadding')}
            <KeyframeToggle
              itemIds={itemIds}
              property="textPadding"
              currentValue={items[0]?.textPadding ?? DEFAULT_PADDING}
            />
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={split ? join : splitApart}
          title={split ? t('editor.textSection.joinPadding') : t('editor.textSection.splitPadding')}
        >
          {split ? <Link2Off className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </PropertyRow>
  )
}
