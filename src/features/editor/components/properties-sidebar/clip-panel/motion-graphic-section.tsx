import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { TimelineItem } from '@/types/timeline'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  readMotionClip,
  rerenderMotionClip,
  saveOpenEditorNow,
  type MotionClipInfo,
  type MotionVariable,
} from '@/infrastructure/storage/bridge-fs/bridge-agent-commands'
import { ColorPicker, NumberInput, PropertyRow, PropertySection } from '../components'
import { changedValues, isMotionGraphicClip, selectWhenLoaded } from './motion-graphic-clip'

type Status = 'idle' | 'saving' | 'rendering'

interface ControlProps {
  variable: MotionVariable
  value: unknown
  label: string
  onChange: (value: unknown) => void
}

const textOf = (value: unknown) => (value === undefined || value === null ? '' : String(value))

function OptionsControl({ variable, value, label, onChange }: ControlProps) {
  return (
    <select
      value={textOf(value)}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
      aria-label={label}
    >
      {(variable.options ?? []).map((option) => (
        <option key={String(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  )
}

/** A control per HyperFrames variable type; anything else edits as text. */
const CONTROLS: Record<string, (props: ControlProps) => ReactNode> = {
  color: ({ value, onChange }) => (
    <ColorPicker color={textOf(value) || '#ffffff'} onChange={onChange} />
  ),
  number: ({ variable, value, onChange }) => (
    <NumberInput
      value={Number(value ?? 0)}
      onChange={onChange}
      min={variable.min}
      max={variable.max}
      step={variable.step}
    />
  ),
  boolean: ({ value, label, onChange }) => (
    <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={label} />
  ),
  text: ({ value, label, onChange }) => (
    <Input
      value={textOf(value)}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 text-xs"
      aria-label={label}
    />
  ),
}

function VariableControl(props: Omit<ControlProps, 'label'>) {
  const label = props.variable.label ?? props.variable.id
  const render = props.variable.options?.length
    ? OptionsControl
    : (CONTROLS[props.variable.type ?? ''] ?? CONTROLS.text!)
  return <>{render({ ...props, label })}</>
}

/**
 * A HyperFrames motion graphic's controls (its composition's variables), for
 * a clip `shred motion` placed. Update re-renders it with the new values and
 * swaps the render into the clip: the same `shred motion add --item` Claude
 * runs, so nothing is lost. `wrap` frames the body (the clip panel's section,
 * Concise's card cell); nothing renders for other clips.
 */
export function MotionGraphicControls({
  items,
  wrap,
}: {
  items: TimelineItem[]
  wrap: (body: ReactNode) => ReactNode
}) {
  const { t } = useTranslation()
  const item = items.length === 1 && isMotionGraphicClip(items[0]) ? items[0] : undefined
  const itemId = item?.id
  const projectId = useProjectStore((s) => s.currentProject?.id ?? null)
  const [info, setInfo] = useState<MotionClipInfo | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setInfo(null)
    setError(null)
    if (!itemId || !projectId) return
    let live = true
    void readMotionClip(projectId, itemId).then((next) => {
      if (!live) return
      setInfo(next)
      setDraft(next?.values ?? {})
    })
    return () => {
      live = false
    }
  }, [itemId, projectId])

  if (!item || !info || !projectId) return null
  const changes = changedValues(draft, info.values)
  const dirty = Object.keys(changes).length > 0
  const busy = status !== 'idle'

  const update = async () => {
    setError(null)
    setStatus('saving')
    try {
      if (!(await saveOpenEditorNow(projectId))) throw new Error(t('editor.motionGraphic.unsaved'))
      setStatus('rendering')
      const clipId = await rerenderMotionClip(projectId, item.id, changes)
      await selectWhenLoaded(clipId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setStatus('idle')
    }
  }

  return wrap(
    <>
      {info.variables.length === 0 ? (
        <p className="px-1 pb-2 text-[11px] leading-snug text-muted-foreground">
          {t('editor.motionGraphic.noControls')}
        </p>
      ) : (
        <>
          {info.variables.map((variable) => (
            <PropertyRow key={variable.id} label={variable.label ?? variable.id}>
              <div className="min-w-0 flex-1">
                <VariableControl
                  variable={variable}
                  value={draft[variable.id]}
                  onChange={(value) => setDraft((prev) => ({ ...prev, [variable.id]: value }))}
                />
              </div>
            </PropertyRow>
          ))}
          <div className="mt-2 flex items-center gap-2 px-1">
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={!dirty || busy}
              onClick={() => void update()}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {status === 'saving'
                ? t('editor.motionGraphic.saving')
                : status === 'rendering'
                  ? t('editor.motionGraphic.rendering')
                  : t('editor.motionGraphic.update')}
            </Button>
            {dirty && !busy && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setDraft(info.values)}
              >
                {t('editor.motionGraphic.revert')}
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 whitespace-pre-wrap px-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <p className="mt-2 px-1 text-[11px] leading-snug text-muted-foreground">
        {t('editor.motionGraphic.hint')}
      </p>
    </>,
  )
}

/** The clip panel's Motion graphic section. */
export function MotionGraphicSection({ items }: { items: TimelineItem[] }) {
  const { t } = useTranslation()
  return (
    <MotionGraphicControls
      items={items}
      wrap={(body) => (
        <PropertySection title={t('editor.motionGraphic.title')} icon={Sparkles} defaultOpen>
          {body}
        </PropertySection>
      )}
    />
  )
}
