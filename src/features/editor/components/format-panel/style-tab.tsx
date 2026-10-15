import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  readProjectKit,
  saveOpenEditorNow,
  setProjectKitValues,
  type ProjectKitInfo,
  type ProjectKitRecord,
} from '@/infrastructure/storage/bridge-fs/bridge-agent-commands'
import { ColorPicker, NumberInput, PropertyRow } from '../properties-sidebar/components'
import { kitFieldGroups, kitValueText, type KitField, type KitFieldGroup } from './style-kit-fields'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function FieldControl({
  field,
  value,
  label,
  disabled,
  onChange,
}: {
  field: KitField
  value: unknown
  label: string
  disabled: boolean
  onChange: (value: unknown) => void
}) {
  switch (field.kind) {
    case 'color':
      return <ColorPicker color={String(value)} onChange={onChange} disabled={disabled} />
    case 'number':
      return (
        <NumberInput
          value={Number(value)}
          onChange={onChange}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={disabled}
        />
      )
    case 'toggle':
      return (
        <Switch
          checked={Boolean(value)}
          onCheckedChange={onChange}
          aria-label={label}
          disabled={disabled}
        />
      )
    case 'select':
      return (
        <select
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
          aria-label={label}
          disabled={disabled}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    default:
      return (
        <Input
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 text-xs"
          aria-label={label}
          disabled={disabled}
        />
      )
  }
}

function KitHeader({ info }: { info: ProjectKitInfo & { record: ProjectKitRecord } }) {
  const { t } = useTranslation()
  const creator = typeof info.kit?.creator === 'string' ? info.kit.creator : t('formats.style.kit')
  const file = info.path ?? info.record.path
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-semibold">
        {creator}
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
          v{String(info.kit?.kitVersion ?? info.record.kitVersion)}
        </span>
      </p>
      <p className="truncate text-[11px] text-muted-foreground" title={file}>
        {file}
      </p>
    </div>
  )
}

/** Why the kit can't be edited here: its file is unreadable, or changed since apply. */
function KitWarning({ error }: { error?: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <span>{error ? t('formats.style.unreadable', { error }) : t('formats.style.drift')}</span>
    </div>
  )
}

function KitGroupFields({
  group,
  draft,
  disabled,
  onChange,
}: {
  group: KitFieldGroup
  draft: Record<string, unknown>
  disabled: boolean
  onChange: (path: string, value: unknown) => void
}) {
  const { t } = useTranslation()
  return (
    <section className="space-y-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t(`formats.style.groups.${group.titleKey}`, { defaultValue: group.title })}
      </h3>
      {group.fields.map((field) => {
        const label = field.labelKey
          ? t(`formats.style.fields.${field.labelKey}`, { defaultValue: field.label })
          : field.label
        return (
          <PropertyRow
            key={field.path}
            label={label}
            className="[&>span:first-child]:w-28 [&>span:first-child]:shrink-0"
          >
            <div className="min-w-0 flex-1">
              <FieldControl
                field={field}
                label={label}
                value={draft[field.path] ?? field.value}
                disabled={disabled}
                onChange={(value) => onChange(field.path, value)}
              />
            </div>
          </PropertyRow>
        )
      })}
    </section>
  )
}

function SaveBar({
  changed,
  saving,
  locked,
  onSave,
  onRevert,
}: {
  changed: boolean
  saving: boolean
  locked: boolean
  onSave: () => void
  onRevert: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        disabled={!changed || saving || locked}
        onClick={onSave}
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {saving ? t('formats.style.saving') : t('formats.style.save')}
      </Button>
      {changed && !saving && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={onRevert}
        >
          {t('formats.style.revert')}
        </Button>
      )}
    </div>
  )
}

const hint = (text: string) => <p className="text-xs leading-snug text-muted-foreground">{text}</p>

/** The kit's fields with a draft of changes, saved together through `shred kit set`. */
function KitEditor({
  projectId,
  info,
  onSaved,
}: {
  projectId: string
  info: ProjectKitInfo & { record: ProjectKitRecord }
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const groups = useMemo(() => (info.kit ? kitFieldGroups(info.kit) : []), [info.kit])
  const changes = useMemo(() => {
    const valueAt = new Map(groups.flatMap((g) => g.fields.map((f) => [f.path, f.value])))
    return Object.entries(draft).filter(
      ([path, value]) => valueAt.has(path) && !same(valueAt.get(path), value),
    )
  }, [draft, groups])
  const locked = Boolean(info.drift || info.error)

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      if (!(await saveOpenEditorNow(projectId))) throw new Error(t('formats.style.unsaved'))
      await setProjectKitValues(
        projectId,
        Object.fromEntries(changes.map(([path, value]) => [path, kitValueText(value)])),
      )
      setDraft({})
      await onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <KitHeader info={info} />
      {locked && <KitWarning error={info.error} />}
      {groups.map((group) => (
        <KitGroupFields
          key={group.id}
          group={group}
          draft={draft}
          disabled={locked || saving}
          onChange={(path, value) => setDraft((prev) => ({ ...prev, [path]: value }))}
        />
      ))}
      <SaveBar
        changed={changes.length > 0}
        saving={saving}
        locked={locked}
        onSave={() => void save()}
        onRevert={() => setDraft({})}
      />
      {error && (
        <p role="alert" className="whitespace-pre-wrap text-[11px] text-destructive">
          {error}
        </p>
      )}
      {hint(t('formats.style.hint'))}
    </div>
  )
}

/**
 * The project's Video Style Kit: fonts, the look of titles, captions and
 * overlays, and the editing preferences. Saving writes kit.json through the
 * same `shred kit set` Claude uses (checked, logged in the kit's changelog),
 * and the project's kit styles follow.
 */
export function StyleTab() {
  const { t } = useTranslation()
  const projectId = useProjectStore((s) => s.currentProject?.id ?? null)
  const [info, setInfo] = useState<ProjectKitInfo | null | undefined>(undefined)

  const load = useCallback(async () => {
    if (projectId) setInfo(await readProjectKit(projectId))
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  if (info === undefined || !projectId) return null
  if (info === null) return hint(t('formats.style.noBridge'))
  const { record } = info
  if (!record) return hint(t('formats.style.noKit'))
  return <KitEditor projectId={projectId} info={{ ...info, record }} onSaved={load} />
}
