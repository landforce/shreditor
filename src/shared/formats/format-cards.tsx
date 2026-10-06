import { useTranslation } from 'react-i18next'
import { AudioLines, Check } from 'lucide-react'
import { FORMATS, type FormatDefinition, type FormatId } from '@formats/registry.mjs'
import { cn } from '@/shared/ui/cn'
import { FormatLayoutCue } from './format-layout-cue'
import {
  formatTagline,
  formatUseWhen,
  roleLabel,
  variantDescription,
  variantName,
} from './format-text'

/** A format and variant choice (variant null: the format's pooled targets). */
export interface FormatSelection {
  id: FormatId
  variant: string | null
}

function VariantChips({
  format,
  value,
  onSelect,
}: {
  format: FormatDefinition
  value: string | null | undefined
  onSelect: (variant: string | null) => void
}) {
  const { t } = useTranslation()
  if (format.variants.length === 0) return null
  const options = [
    ...(format.defaultVariant
      ? []
      : [
          {
            id: null,
            name: t('formats.picker.anyVariant'),
            title: t('formats.picker.anyVariantHint'),
          },
        ]),
    ...format.variants.map((variant) => ({
      id: variant.id as string | null,
      name: variantName(t, format.id, variant),
      title: variantDescription(t, format.id, variant),
    })),
  ]
  return (
    <div
      role="radiogroup"
      aria-label={t('formats.picker.variant')}
      className="flex flex-wrap gap-1.5"
    >
      {options.map((option) => {
        const checked = value !== undefined && option.id === value
        return (
          <button
            key={option.id ?? 'any'}
            type="button"
            role="radio"
            aria-checked={checked}
            title={option.title}
            onClick={() => onSelect(option.id)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              checked
                ? 'border-primary bg-primary-soft text-primary-text'
                : 'border-border bg-card text-secondary-foreground hover:border-primary/50',
            )}
          >
            {option.name}
          </button>
        )
      })}
    </div>
  )
}

function TrackPills({ format }: { format: FormatDefinition }) {
  const { t } = useTranslation()
  return (
    <p className="mt-auto flex flex-wrap gap-1 pt-1">
      {format.tracks.map((entry) => (
        <span
          key={`${entry.kind}-${entry.name}`}
          className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {entry.kind === 'audio' && <AudioLines className="h-2.5 w-2.5" aria-hidden="true" />}
          {roleLabel(t, entry.role)}
        </span>
      ))}
    </p>
  )
}

function CardHeading({
  format,
  selected,
  compact,
}: {
  format: FormatDefinition
  selected: boolean
  compact: boolean
}) {
  const { t } = useTranslation()
  return (
    <>
      <FormatLayoutCue id={format.id} className={compact ? 'h-24 w-[54px]' : 'h-32 w-[72px]'} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <span className="font-display text-lg font-extrabold tracking-tight text-foreground">
            {format.name}
          </span>
          {selected && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="text-sm text-secondary-foreground">{formatTagline(t, format)}</span>
        {!compact && (
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{t('formats.picker.useWhen')}</span>{' '}
            {formatUseWhen(t, format)}
          </span>
        )}
      </span>
    </>
  )
}

function FormatCard({
  format,
  selected,
  variant,
  compact,
  onSelect,
}: {
  format: FormatDefinition
  selected: boolean
  variant: string | null | undefined
  compact: boolean
  onSelect: (variant: string | null) => void
}) {
  const { t } = useTranslation()
  const chosen = selected && !compact ? format.variants.find((v) => v.id === variant) : undefined
  return (
    <div
      data-testid={`format-card-${format.id}`}
      className={cn(
        'group flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-[border-color,box-shadow,transform]',
        selected
          ? 'border-primary ring-2 ring-primary/25 shadow-float'
          : 'border-border hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-float',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(selected ? (variant ?? null) : format.defaultVariant)}
        className="flex gap-4 text-left focus-visible:outline-none"
      >
        <CardHeading format={format} selected={selected} compact={compact} />
      </button>
      <VariantChips format={format} value={selected ? variant : undefined} onSelect={onSelect} />
      {chosen && (
        <p className="text-xs text-muted-foreground">{variantDescription(t, format.id, chosen)}</p>
      )}
      {!compact && <TrackPills format={format} />}
    </div>
  )
}

/**
 * The four formats as large cards: name, tagline, when to use it, a picture of
 * the layout and its variants (the default preselected).
 */
export function FormatCards({
  value,
  onChange,
  compact = false,
  className,
}: {
  value: FormatSelection | null
  onChange: (value: FormatSelection) => void
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid gap-4',
        compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 2xl:grid-cols-4',
        className,
      )}
    >
      {FORMATS.map((format) => (
        <FormatCard
          key={format.id}
          format={format}
          compact={compact}
          selected={value?.id === format.id}
          variant={value?.id === format.id ? value.variant : undefined}
          onSelect={(variant) => onChange({ id: format.id, variant })}
        />
      ))}
    </div>
  )
}
