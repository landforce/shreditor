import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ellipsis, Replace, Scissors, Trash2, Volume2, VolumeX, Waves } from 'lucide-react'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { AudioItem } from '@/types/timeline'
import { getMixedValue, updateItemsInOneStep } from '../properties-sidebar/utils'
import { Cell, ContextCard, Field, MoreDrawer, type Verb } from './card-parts'
import { focusWithin, formatSeconds, useProjectFps } from './card-helpers'
import { FOCUS_MEDIA_BIN_EVENT } from './events'
import { FadeField, VolumeField } from './shot-card'

const MUTED_DB = -60

export function MusicCard({ items }: { items: AudioItem[] }) {
  const { t } = useTranslation()
  const fps = useProjectFps()
  const item = items[0]!
  const ids = useMemo(() => items.map((entry) => entry.id), [items])
  const [moreOpen, setMoreOpen] = useState(false)
  const fadeRef = useRef<HTMLDivElement>(null)
  const trimRef = useRef<HTMLDivElement>(null)

  const volume = getMixedValue(items, (entry) => entry.volume, 0)
  const muted = items.every((entry) => (entry.volume ?? 0) <= MUTED_DB)
  const sourceIn = item.sourceStart ?? item.trimStart ?? 0
  const sourceFps = item.sourceFps ?? fps

  const verbs: Verb[] = [
    {
      id: 'volume',
      icon: muted ? VolumeX : Volume2,
      label: muted ? t('editor.concise.shot.unmute') : t('editor.concise.shot.mute'),
      onClick: () =>
        updateItemsInOneStep(muted ? 'UNMUTE' : 'MUTE', ids, { volume: muted ? 0 : MUTED_DB }),
      active: muted,
    },
    {
      id: 'fade',
      icon: Waves,
      label: t('editor.concise.music.fade'),
      onClick: () => focusWithin(fadeRef.current),
    },
    {
      id: 'trim',
      icon: Scissors,
      label: t('editor.concise.music.trim'),
      onClick: () => focusWithin(trimRef.current),
    },
    {
      id: 'replace',
      icon: Replace,
      label: t('editor.concise.shot.replace'),
      hint: t('editor.concise.music.replaceHint'),
      onClick: () => window.dispatchEvent(new CustomEvent(FOCUS_MEDIA_BIN_EVENT)),
    },
    {
      id: 'delete',
      icon: Trash2,
      label: t('editor.concise.delete'),
      onClick: () => useTimelineStore.getState().removeItems(ids),
      destructive: true,
    },
    {
      id: 'more',
      icon: Ellipsis,
      label: t('editor.concise.more.label'),
      onClick: () => setMoreOpen(true),
    },
  ]

  return (
    <ContextCard
      testId="concise-music-card"
      title={t('editor.concise.music.title')}
      subtitle={item.label}
      verbs={verbs}
    >
      <Cell title={t('editor.concise.shot.sound')}>
        <Field label={t('editor.concise.shot.volume')}>
          <VolumeField ids={ids} value={volume} />
        </Field>
      </Cell>
      <Cell title={t('editor.concise.shot.fades')} cellRef={fadeRef}>
        <FadeField
          label={t('editor.concise.shot.fadeIn')}
          ids={ids}
          value={getMixedValue(items, (entry) => entry.audioFadeIn, 0)}
          property="audioFadeIn"
          commandType="SET_AUDIO_FADE_IN"
        />
        <FadeField
          label={t('editor.concise.shot.fadeOut')}
          ids={ids}
          value={getMixedValue(items, (entry) => entry.audioFadeOut, 0)}
          property="audioFadeOut"
          commandType="SET_AUDIO_FADE_OUT"
        />
      </Cell>
      <Cell
        title={t('editor.concise.music.range')}
        cellRef={trimRef}
        span={2}
        className="@3xl:col-span-1"
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">{t('editor.concise.shot.timeline')}</dt>
          <dd className="tabular-nums">
            {formatSeconds(item.from, fps)} -{' '}
            {formatSeconds(item.from + item.durationInFrames, fps)}
          </dd>
          <dt className="text-muted-foreground">{t('editor.concise.music.offset')}</dt>
          <dd className="tabular-nums">{formatSeconds(sourceIn, sourceFps)}</dd>
          <dt className="text-muted-foreground">{t('editor.concise.shot.length')}</dt>
          <dd className="tabular-nums">{formatSeconds(item.durationInFrames, fps)}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">{t('editor.concise.music.trimNote')}</p>
      </Cell>
      <MoreDrawer open={moreOpen} onOpenChange={setMoreOpen} />
    </ContextCard>
  )
}
