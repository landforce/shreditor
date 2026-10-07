import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Move, Palette, Type } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { executeTimelineCommand, useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { TextItem } from '@/types/timeline'
import { TextContentSection } from '../properties-sidebar/clip-panel/text-section'
import { TextStylesSection } from '../properties-sidebar/clip-panel/text-styles-section'
import {
  Cell,
  ContextCard,
  deleteVerb,
  duplicateVerb,
  Field,
  MoreDrawer,
  moreVerb,
  type Verb,
} from './card-parts'
import { focusWithin, formatSeconds, useProjectCanvas } from './card-helpers'

export function TextCard({ items }: { items: TextItem[] }) {
  const { t } = useTranslation()
  const canvas = useProjectCanvas()
  const item = items[0]!
  const ids = useMemo(() => items.map((entry) => entry.id), [items])
  const trackName = useTimelineStore(
    (s) => s.tracks.find((track) => track.id === item.trackId)?.name,
  )
  const [moreOpen, setMoreOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const timingRef = useRef<HTMLDivElement>(null)

  const isTitle = /title/i.test(`${item.formatRole ?? ''} ${trackName ?? ''}`)
  const subtitle = `${formatSeconds(item.from, canvas.fps)} - ${formatSeconds(
    item.from + item.durationInFrames,
    canvas.fps,
  )}`

  const verbs: Verb[] = [
    {
      id: 'edit',
      icon: Type,
      label: t('editor.concise.text.edit'),
      hint: t('editor.concise.text.editHint'),
      onClick: () => focusWithin(contentRef.current),
    },
    {
      id: 'style',
      icon: Palette,
      label: t('editor.concise.text.style'),
      onClick: () => focusWithin(styleRef.current),
    },
    {
      id: 'position',
      icon: Move,
      label: t('editor.concise.text.position'),
      hint: t('editor.concise.text.positionHint'),
      onClick: () => setMoreOpen(true),
    },
    {
      id: 'timing',
      icon: Clock,
      label: t('editor.concise.text.timing'),
      onClick: () => focusWithin(timingRef.current),
    },
    duplicateVerb(t('editor.concise.duplicate'), items),
    deleteVerb(t('editor.concise.delete'), ids),
    moreVerb(t('editor.concise.more.label'), () => setMoreOpen(true)),
  ]

  return (
    <ContextCard
      testId="concise-text-card"
      title={isTitle ? t('editor.concise.text.titleCard') : t('editor.concise.text.textCard')}
      subtitle={subtitle}
      verbs={verbs}
    >
      <Cell cellRef={contentRef} span={2} className="@3xl:col-span-2">
        <TextContentSection items={items} canvas={canvas} />
      </Cell>
      <Cell cellRef={timingRef} title={t('editor.concise.text.timing')}>
        <TimingFields item={item} fps={canvas.fps} />
      </Cell>
      <Cell cellRef={styleRef} span={2} className="@3xl:col-span-3">
        <TextStylesSection items={items} canvas={canvas} />
      </Cell>
      <p className="col-span-2 text-xs text-muted-foreground @3xl:col-span-3">
        {t('editor.concise.text.moreNote')}
      </p>
      <MoreDrawer open={moreOpen} onOpenChange={setMoreOpen} />
    </ContextCard>
  )
}

/** Start and end in seconds; one undo step per committed edit. */
function TimingFields({ item, fps }: { item: TextItem; fps: number }) {
  const { t } = useTranslation()
  const start = item.from / fps
  const end = (item.from + item.durationInFrames) / fps
  const [draft, setDraft] = useState({ start: start.toFixed(2), end: end.toFixed(2) })

  useEffect(() => {
    setDraft({ start: start.toFixed(2), end: end.toFixed(2) })
  }, [item.id, start, end])

  const commit = () => {
    const nextStart = Number(draft.start)
    const nextEnd = Number(draft.end)
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) {
      setDraft({ start: start.toFixed(2), end: end.toFixed(2) })
      return
    }
    const from = Math.max(0, Math.round(nextStart * fps))
    const durationInFrames = Math.max(1, Math.round(nextEnd * fps) - from)
    if (from === item.from && durationInFrames === item.durationInFrames) return
    executeTimelineCommand('SET_TEXT_TIMING', () =>
      useTimelineStore.getState().updateItem(item.id, { from, durationInFrames }),
    )
  }

  const field = (key: 'start' | 'end', label: string) => (
    <Field label={label}>
      <Input
        type="number"
        step={0.01}
        min={0}
        inputMode="decimal"
        className="h-8 text-xs tabular-nums"
        value={draft[key]}
        onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </Field>
  )

  return (
    <div className="grid grid-cols-2 gap-2">
      {field('start', t('editor.concise.text.start'))}
      {field('end', t('editor.concise.text.end'))}
    </div>
  )
}
