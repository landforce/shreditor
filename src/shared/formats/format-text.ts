import type { TFunction } from 'i18next'
import type {
  FormatDefinition,
  FormatRole,
  FormatVariant,
  Presence,
  ResolvedFormat,
} from '@formats/registry.mjs'
import type { ScorecardCheck } from '@formats/scorecard.mjs'

// Format content (taglines, variant names, check labels) is authored in
// English in formats/registry.mjs. English reads it from there (the keys
// below are absent from en), other languages from their formats.json.

type AnyFormat = Pick<FormatDefinition, 'id' | 'tagline' | 'useWhen'>

export const formatTagline = (t: TFunction, format: AnyFormat) =>
  t(`formats.catalog.${format.id}.tagline`, { defaultValue: format.tagline })

export const formatUseWhen = (t: TFunction, format: AnyFormat) =>
  t(`formats.catalog.${format.id}.useWhen`, { defaultValue: format.useWhen })

type VariantText = Pick<FormatVariant, 'id' | 'name' | 'description'>

export const variantName = (t: TFunction, formatId: string, variant: VariantText) =>
  t(`formats.variants.${formatId}.${variant.id}.name`, { defaultValue: variant.name })

export const variantDescription = (t: TFunction, formatId: string, variant: VariantText) =>
  t(`formats.variants.${formatId}.${variant.id}.description`, {
    defaultValue: variant.description,
  })

export const roleLabel = (t: TFunction, role: FormatRole) => t(`formats.roles.${role}`)

export function checkLabel(t: TFunction, check: Pick<ScorecardCheck, 'key' | 'label'>): string {
  const from = /from ([\d.]+) s/.exec(check.label)?.[1]
  return t(`formats.checks.${check.key}`, { defaultValue: check.label, from })
}

export interface RuleLine {
  key: string
  label: string
  value: string
}

function hookValue(t: TFunction, rule: ResolvedFormat['rules']['titleHook']): string {
  if (!rule.required) return t('formats.rules.presence.optional')
  const { min, max } = rule.holdSec
  const hold =
    min !== null && max !== null
      ? t('formats.rules.hookHoldRange', { min, max })
      : min !== null
        ? t('formats.rules.hookHoldMin', { min })
        : max !== null
          ? t('formats.rules.hookHoldMax', { max })
          : ''
  const parts = [t('formats.rules.hookFrom', { from: rule.fromSec }), hold]
  if (rule.allowFullHold) parts.push(t('formats.rules.hookOrAll'))
  return parts.filter(Boolean).join(', ')
}

const presence = (t: TFunction, value: Presence) => t(`formats.rules.presence.${value}`)

/** The format's rules in plain words: title hook, captions, voiceover, music, SFX, transitions. */
export function formatRuleLines(t: TFunction, format: ResolvedFormat): RuleLine[] {
  const { rules } = format
  return [
    { key: 'titleHook', label: t('formats.rules.titleHook'), value: hookValue(t, rules.titleHook) },
    { key: 'captions', label: t('formats.rules.captions'), value: presence(t, rules.captions) },
    { key: 'voiceover', label: t('formats.rules.voiceover'), value: presence(t, rules.voiceover) },
    { key: 'music', label: t('formats.rules.music'), value: presence(t, rules.music) },
    { key: 'sfx', label: t('formats.rules.sfx'), value: presence(t, rules.sfx) },
    {
      key: 'transitions',
      label: t('formats.rules.transitions'),
      value: t('formats.rules.transitionsNone'),
    },
  ]
}
