import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brush } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TextItem, TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { TEXT_STYLE_ROLES, type TextStyleDefinition, type TextStyleRole } from '@/types/text-style'
import { useLibraryTextStylesStore, useProjectTextStylesStore } from '@/shared/state/text-styles'
import { textStyleDifferences } from '@/shared/typography/text-styles/text-style-resolve'
import {
  applyTextStyleToItems,
  detachItemsFromTextStyle,
  resetItemsToTextStyle,
  saveTextStyleFromItems,
  upsertProjectTextStyle,
  useItemsStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { PropertySection } from '../components'
import { TEXT_STYLE_PRESETS, buildTextStylePresetTemplate } from './text-style-presets'
import {
  buildTextStylePickerGroups,
  libraryStateOf,
  newTextStyleFromItem,
  roleLabelKey,
  textStyleUpdatedFromItem,
} from './text-style-picker-model'
import { TextStylesManagerDialog } from './text-styles-manager-dialog'

interface TextStylesSectionProps {
  items: TimelineItem[]
  canvas: CanvasSettings
}

const MIXED = '__mixed__'

/** Pick, save, reset and manage the text style of the selected text items. */
export function TextStylesSection({ items, canvas }: TextStylesSectionProps) {
  const { t } = useTranslation()
  const textItems = useMemo(
    () => items.filter((item): item is TextItem => item.type === 'text'),
    [items],
  )
  const projectStyles = useProjectTextStylesStore((s) => s.styles)
  const libraryStyles = useLibraryTextStylesStore((s) => s.styles)
  const tracks = useItemsStore((s) => s.tracks)
  const [managing, setManaging] = useState(false)
  const first = textItems[0]
  const ids = useMemo(() => textItems.map((item) => item.id), [textItems])

  const sharedStyleId = textItems.every((item) => item.textStyleId === first?.textStyleId)
    ? (first?.textStyleId ?? '')
    : MIXED
  const style = projectStyles.find((entry) => entry.id === sharedStyleId)
  const formatRole =
    first?.formatRole ?? tracks.find((track) => track.id === first?.trackId)?.formatRole
  const groups = useMemo(
    () => buildTextStylePickerGroups(projectStyles, libraryStyles, formatRole),
    [formatRole, libraryStyles, projectStyles],
  )

  const pick = useCallback(
    (value: string) => {
      const [kind, id] = value.split(':') as [string, string]
      if (kind === 'preset') {
        // A built-in preset is a starting point: the items leave their style.
        detachItemsFromTextStyle(ids, canvas)
        const { updateItem } = useTimelineStore.getState()
        for (const itemId of ids)
          updateItem(itemId, buildTextStylePresetTemplate(id as never, canvas, 1))
        return
      }
      const source = kind === 'project' ? projectStyles : libraryStyles
      const picked = source.find((entry) => entry.id === id)
      if (picked) applyTextStyleToItems(ids, picked, canvas)
    },
    [canvas, ids, libraryStyles, projectStyles],
  )

  if (!first) return null

  return (
    <PropertySection title={t('textStyles.section')} icon={Brush} defaultOpen={true}>
      <div className="flex w-full min-w-0 flex-col gap-2">
        <Select value={style ? `project:${style.id}` : ''} onValueChange={pick}>
          <SelectTrigger className="h-7 w-full text-xs" aria-label={t('textStyles.section')}>
            <SelectValue
              placeholder={
                sharedStyleId === MIXED ? t('textStyles.mixed') : t('textStyles.placeholder')
              }
            />
          </SelectTrigger>
          <SelectContent>
            <StyleGroup
              label={t('textStyles.groupProject')}
              kind="project"
              entries={groups.project}
            />
            <StyleGroup
              label={t('textStyles.groupLibrary')}
              kind="library"
              entries={groups.library}
            />
            <SelectGroup>
              <SelectLabel className="text-[10px]">{t('textStyles.groupPresets')}</SelectLabel>
              {TEXT_STYLE_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={`preset:${preset.id}`} className="text-xs">
                  {preset.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {style ? (
          <LinkedStyleControls item={first} ids={ids} style={style} canvas={canvas} />
        ) : null}
        <SaveStyleForm item={first} ids={ids} canvas={canvas} />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => setManaging(true)}
        >
          {t('textStyles.manage')}
        </Button>
      </div>
      <TextStylesManagerDialog open={managing} onOpenChange={setManaging} canvas={canvas} />
    </PropertySection>
  )
}

function StyleGroup({
  label,
  kind,
  entries,
}: {
  label: string
  kind: 'project' | 'library'
  entries: ReturnType<typeof buildTextStylePickerGroups>['project']
}) {
  const { t } = useTranslation()
  if (entries.length === 0) return null
  return (
    <SelectGroup>
      <SelectLabel className="text-[10px]">{label}</SelectLabel>
      {entries.map(({ style, suggested }) => (
        <SelectItem key={style.id} value={`${kind}:${style.id}`} className="text-xs">
          {style.name}
          <span className="ml-1 text-muted-foreground">
            · {t(roleLabelKey(style.role))}
            {suggested ? ` · ${t('textStyles.suggested')}` : ''}
          </span>
        </SelectItem>
      ))}
    </SelectGroup>
  )
}

/** Status of a linked item: the differs marker, reset, update the style, detach, library sync. */
function LinkedStyleControls({
  item,
  ids,
  style,
  canvas,
}: {
  item: TextItem
  ids: string[]
  style: TextStyleDefinition
  canvas: CanvasSettings
}) {
  const { t } = useTranslation()
  const libraryStyles = useLibraryTextStylesStore((s) => s.styles)
  const differences = textStyleDifferences(item, style, canvas)
  const libraryState = libraryStateOf(style, libraryStyles)
  const librarySource = libraryStyles.find((entry) => entry.id === style.id)

  const saveToLibrary = () =>
    useLibraryTextStylesStore
      .getState()
      .saveStyle(style)
      .then(() => toast.success(t('textStyles.savedToLibrary', { name: style.name })))
      .catch(() => toast.error(t('textStyles.libraryWriteFailed')))

  return (
    <div
      className="space-y-1.5 rounded-md border border-border/70 p-2"
      data-testid="text-style-status"
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate">{t('textStyles.linked', { name: style.name })}</span>
        {differences.length > 0 ? (
          <span
            className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500"
            title={differences.join(', ')}
            data-testid="text-style-differs"
          >
            {t('textStyles.differs', { count: differences.length })}
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {t('textStyles.matches')}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={differences.length === 0 && !item.textStyleOverrides?.length}
          onClick={() => resetItemsToTextStyle(ids, canvas)}
        >
          {t('textStyles.resetToStyle')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={differences.length === 0}
          onClick={() =>
            saveTextStyleFromItems(textStyleUpdatedFromItem(style, item, canvas), [item.id], canvas)
          }
        >
          {t('textStyles.updateStyle')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => detachItemsFromTextStyle(ids, canvas)}
        >
          {t('textStyles.detach')}
        </Button>
        {libraryState === 'same' ? (
          <span className="self-center text-center text-[10px] text-muted-foreground">
            {t('textStyles.librarySame')}
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => void saveToLibrary()}
          >
            {t('textStyles.saveToLibrary')}
          </Button>
        )}
      </div>
      {libraryState === 'differs' && librarySource ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full text-[11px]"
          onClick={() =>
            upsertProjectTextStyle(
              { ...librarySource, version: Math.max(librarySource.version, style.version + 1) },
              canvas,
            )
          }
        >
          {t('textStyles.updateFromLibrary', { version: librarySource.version })}
        </Button>
      ) : null}
    </div>
  )
}

/** "Save as new style": a name and a role, then the items use the new style. */
function SaveStyleForm({
  item,
  ids,
  canvas,
}: {
  item: TextItem
  ids: string[]
  canvas: CanvasSettings
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState<TextStyleRole>(item.textRole === 'caption' ? 'caption' : 'title')

  const save = () => {
    try {
      const style = newTextStyleFromItem(
        item,
        { name: name.trim(), role },
        canvas,
        useProjectTextStylesStore.getState().styles,
      )
      saveTextStyleFromItems(style, ids, canvas)
      setOpen(false)
      setName('')
    } catch {
      toast.error(t('textStyles.nameTaken'))
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setOpen(true)}>
        {t('textStyles.saveAsNew')}
      </Button>
    )
  }
  return (
    <div className="space-y-1.5 rounded-md border border-border/70 p-2">
      <Input
        autoFocus
        value={name}
        placeholder={t('textStyles.name')}
        aria-label={t('textStyles.name')}
        className="h-7 text-xs"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && name.trim()) save()
        }}
      />
      <Select value={role} onValueChange={(value) => setRole(value as TextStyleRole)}>
        <SelectTrigger className="h-7 w-full text-xs" aria-label={t('textStyles.role')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TEXT_STYLE_ROLES.map((entry) => (
            <SelectItem key={entry} value={entry} className="text-xs">
              {t(roleLabelKey(entry))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => setOpen(false)}
        >
          {t('textStyles.cancel')}
        </Button>
        <Button size="sm" className="h-7 text-[11px]" disabled={!name.trim()} onClick={save}>
          {t('textStyles.save')}
        </Button>
      </div>
    </div>
  )
}
