import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Gauge, Replace, Scissors, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  captureSnapshot,
  rateStretchItemWithoutHistory,
  useTimelineCommandStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { useGizmoStore } from '@/features/editor/deps/preview'
import { useTimelineBeats } from '@/features/editor/deps/timeline-hooks'
import {
  sourceToTimelineFrames,
  timelineToSourceFrames,
} from '@/features/editor/deps/timeline-utils'
import type { ImageItem, VideoItem } from '@/types/timeline'
import { hasSpeedRamp, sourceSpanFrames } from '@/shared/timeline/speed-ramp.mjs'
import { SliderInput } from '../properties-sidebar/components'
import { MotionGraphicControls } from '../properties-sidebar/clip-panel/motion-graphic-section'
import {
  applySpeedRampChoice,
  formatRampSpeed,
  getCombinedSpeedRampRange,
  getSharedSpeedRampState,
  SPEED_RAMP_CHOICE_LABEL_KEYS,
  SPEED_RAMP_CHOICES,
} from '../properties-sidebar/clip-panel/speed-ramp-choices'
import { getMixedValue, updateItemsInOneStep } from '../properties-sidebar/utils'
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
import { focusWithin, formatSeconds, useProjectFps } from './card-helpers'
import { FOCUS_MEDIA_BIN_EVENT } from './events'
import { describeOutPoint, planCutIn, planCutOut } from './beat-cuts'

const MIN_SPEED = 0.25
const MAX_SPEED = 4
const SPEED_PRESETS = [0.5, 1, 1.5, 2]
const MUTED_DB = -60

export type ShotItem = VideoItem | ImageItem

export function ShotCard({ items }: { items: ShotItem[] }) {
  const { t } = useTranslation()
  const fps = useProjectFps()
  const item = items[0]!
  const ids = useMemo(() => items.map((entry) => entry.id), [items])
  const videoIds = useMemo(
    () => items.filter((entry) => entry.type === 'video').map((entry) => entry.id),
    [items],
  )
  const allItems = useTimelineStore((s) => s.items)
  const [moreOpen, setMoreOpen] = useState(false)
  const speedRef = useRef<HTMLDivElement>(null)

  const siblings = useMemo(
    () =>
      allItems.filter((entry) => entry.trackId === item.trackId).sort((a, b) => a.from - b.from),
    [allItems, item.trackId],
  )
  const index = Math.max(
    0,
    siblings.findIndex((entry) => entry.id === item.id),
  )

  const videoItems = items.filter((entry): entry is VideoItem => entry.type === 'video')
  const volume = getMixedValue(videoItems, (entry) => entry.volume, 0)
  const muted =
    videoItems.length > 0 && videoItems.every((entry) => (entry.volume ?? 0) <= MUTED_DB)

  const split = useCallback(() => {
    const { previewFrame, currentFrame } = usePlaybackStore.getState()
    const frame = previewFrame ?? currentFrame
    if (frame > item.from && frame < item.from + item.durationInFrames) {
      useTimelineStore.getState().splitItem(item.id, frame)
    }
  }, [item.from, item.durationInFrames, item.id])

  const frame = usePlaybackStore((s) => s.previewFrame ?? s.currentFrame)
  const canSplit = frame > item.from && frame < item.from + item.durationInFrames

  const verbs: Verb[] = [
    {
      id: 'split',
      icon: Scissors,
      label: t('editor.concise.shot.split'),
      hint: t('editor.concise.shot.splitHint'),
      onClick: split,
      disabled: !canSplit,
    },
    {
      id: 'replace',
      icon: Replace,
      label: t('editor.concise.shot.replace'),
      hint: t('editor.concise.shot.replaceHint'),
      onClick: () => window.dispatchEvent(new CustomEvent(FOCUS_MEDIA_BIN_EVENT)),
    },
    {
      id: 'speed',
      icon: Gauge,
      label: t('editor.concise.shot.speed'),
      onClick: () => focusWithin(speedRef.current),
    },
    {
      id: 'volume',
      icon: muted ? VolumeX : Volume2,
      label: muted ? t('editor.concise.shot.unmute') : t('editor.concise.shot.mute'),
      onClick: () =>
        updateItemsInOneStep(muted ? 'UNMUTE' : 'MUTE', videoIds, { volume: muted ? 0 : MUTED_DB }),
      disabled: videoIds.length === 0,
      active: muted,
    },
    duplicateVerb(t('editor.concise.duplicate'), items),
    deleteVerb(t('editor.concise.delete'), ids),
    moreVerb(t('editor.concise.more.label'), () => setMoreOpen(true)),
  ]

  return (
    <ContextCard
      testId="concise-shot-card"
      title={t('editor.concise.shot.title', { n: index + 1, m: siblings.length })}
      subtitle={item.label}
      verbs={verbs}
    >
      <Cell span={2} className="@3xl:col-span-1">
        <Filmstrip item={item} />
        <Timing item={item} fps={fps} />
      </Cell>
      <Cell title={t('editor.concise.shot.speed')} cellRef={speedRef}>
        <SpeedField items={items} />
      </Cell>
      <Cell title={t('editor.concise.shot.sound')}>
        <Field label={t('editor.concise.shot.volume')}>
          <VolumeField ids={videoIds} value={volume} />
        </Field>
      </Cell>
      <Cell title={t('editor.concise.shot.fades')} span={2} className="@3xl:col-span-1">
        <FadeFields items={videoItems} />
      </Cell>
      <MotionGraphicControls
        items={items}
        wrap={(body) => (
          <Cell title={t('editor.motionGraphic.title')} span={2} className="@3xl:col-span-3">
            {body}
          </Cell>
        )}
      />
      <Cell title={t('editor.concise.shot.beat')} span={2} className="@3xl:col-span-3">
        <BeatCuts item={item} fps={fps} />
      </Cell>
      <p className="col-span-2 text-xs text-muted-foreground @3xl:col-span-3">
        {t('editor.concise.shot.moreNote')}
      </p>
      <MoreDrawer open={moreOpen} onOpenChange={setMoreOpen} />
    </ContextCard>
  )
}

function Filmstrip({ item }: { item: ShotItem }) {
  return (
    <div
      data-testid="concise-filmstrip"
      className="h-16 w-full rounded-md bg-muted bg-repeat-x"
      style={
        item.thumbnailUrl
          ? { backgroundImage: `url(${item.thumbnailUrl})`, backgroundSize: 'auto 100%' }
          : undefined
      }
    />
  )
}

function Timing({ item, fps }: { item: ShotItem; fps: number }) {
  const { t } = useTranslation()
  const sourceFps = item.sourceFps ?? fps
  const speed = item.speed ?? 1
  const sourceIn = item.sourceStart ?? item.trimStart ?? 0
  const sourceOut =
    item.sourceEnd ??
    sourceIn +
      (hasSpeedRamp(item)
        ? Math.round(sourceSpanFrames(item, fps))
        : timelineToSourceFrames(item.durationInFrames, speed, fps, sourceFps))
  const range = (a: number, b: number, rate: number) =>
    `${(a / rate).toFixed(2)}s - ${(b / rate).toFixed(2)}s`
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-muted-foreground">{t('editor.concise.shot.timeline')}</dt>
      <dd className="tabular-nums">{range(item.from, item.from + item.durationInFrames, fps)}</dd>
      <dt className="text-muted-foreground">{t('editor.concise.shot.source')}</dt>
      <dd className="tabular-nums">{range(sourceIn, sourceOut, sourceFps)}</dd>
      <dt className="text-muted-foreground">{t('editor.concise.shot.length')}</dt>
      <dd className="tabular-nums">{formatSeconds(item.durationInFrames, fps)}</dd>
    </dl>
  )
}

/**
 * Cut the shot's edges to the music's beat, through the same trim actions the
 * timeline uses (one undo step, source offsets and neighbours handled there).
 */
function BeatCuts({ item, fps }: { item: ShotItem; fps: number }) {
  const { t } = useTranslation()
  const beats = useTimelineBeats()
  const end = item.from + item.durationInFrames
  const ready = beats.status === 'ready'
  const cutOut = ready ? planCutOut(beats.beatFrames, end) : null
  const cutIn = ready ? planCutIn(beats.beatFrames, item.from) : null
  const readout = ready ? describeOutPoint(beats.beatFrames, end, fps) : null

  return (
    <div className="space-y-2" data-testid="concise-shot-beat">
      <div className="flex gap-1">
        <BeatCutButton
          label={t('editor.concise.shot.cutOutToBeat')}
          disabled={!cutOut}
          title={ready && !cutOut ? t('editor.concise.shot.beatNoBeat') : undefined}
          onClick={() => cutOut && useTimelineStore.getState().trimItemEnd(item.id, cutOut.amount)}
        />
        <BeatCutButton
          label={t('editor.concise.shot.cutInToBeat')}
          disabled={!cutIn}
          title={ready && !cutIn ? t('editor.concise.shot.beatNoBeat') : undefined}
          onClick={() => cutIn && useTimelineStore.getState().trimItemStart(item.id, cutIn.amount)}
        />
      </div>
      <p
        className="text-xs text-muted-foreground tabular-nums"
        data-testid="concise-shot-beat-readout"
      >
        {beatReadoutText(t, beats.status, readout)}
      </p>
    </div>
  )
}

function BeatCutButton({
  label,
  disabled,
  title,
  onClick,
}: {
  label: string
  disabled: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 flex-1 px-2 text-xs"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}

const BEAT_STATUS_HINT_KEYS = {
  none: 'editor.concise.shot.beatNoMusic',
  pending: 'editor.concise.shot.beatPending',
  failed: 'editor.concise.shot.beatFailed',
} as const

const BEAT_OUT_KEYS = {
  on: 'editor.concise.shot.beatOutOn',
  after: 'editor.concise.shot.beatOutAfter',
  before: 'editor.concise.shot.beatOutBefore',
} as const

/** The line under the cut buttons: why beats are unavailable, or where the out point sits. */
function beatReadoutText(
  t: TFunction,
  status: ReturnType<typeof useTimelineBeats>['status'],
  readout: ReturnType<typeof describeOutPoint> | null,
): string {
  if (status !== 'ready') return t(BEAT_STATUS_HINT_KEYS[status])
  if (!readout) return t('editor.concise.shot.beatNoBeat')
  return t(BEAT_OUT_KEYS[readout.direction], {
    ms: readout.ms,
    time: readout.beatSeconds.toFixed(2),
  })
}

/** Speed slider and presets; applied exactly like the clip panel's playback section. */
function SpeedField({ items }: { items: ShotItem[] }) {
  const { t } = useTranslation()
  const stretchable = useMemo(
    () => items.filter((entry) => entry.type === 'video').map((entry) => entry.id),
    [items],
  )
  const snapshotRef = useRef<ReturnType<typeof captureSnapshot> | null>(null)
  const videoItems = useMemo(
    () => items.filter((entry): entry is VideoItem => entry.type === 'video'),
    [items],
  )
  const speed = getMixedValue(videoItems, (entry) => entry.speed, 1)
  const rampState = useMemo(() => getSharedSpeedRampState(videoItems), [videoItems])
  const rampRange = useMemo(() => getCombinedSpeedRampRange(videoItems), [videoItems])
  const ramped = rampRange !== null

  const apply = useCallback(
    (next: number) => {
      const clamped = Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.round(next * 100) / 100))
      const { items: current, fps } = useTimelineStore.getState()
      for (const entry of current) {
        if (entry.type !== 'video' || !stretchable.includes(entry.id)) continue
        const sourceFps = entry.sourceFps ?? fps
        const sourceFrames =
          entry.sourceEnd !== undefined && entry.sourceStart !== undefined
            ? entry.sourceEnd - entry.sourceStart
            : hasSpeedRamp(entry)
              ? Math.round(sourceSpanFrames(entry, fps))
              : timelineToSourceFrames(entry.durationInFrames, entry.speed || 1, fps, sourceFps)
        const duration = Math.max(1, sourceToTimelineFrames(sourceFrames, clamped, sourceFps, fps))
        rateStretchItemWithoutHistory(entry.id, entry.from, duration, clamped)
      }
      return clamped
    },
    [stretchable],
  )

  const live = useCallback(
    (next: number) => {
      snapshotRef.current ??= captureSnapshot()
      apply(next)
    },
    [apply],
  )

  const commit = useCallback(
    (next: number) => {
      const before = snapshotRef.current ?? captureSnapshot()
      const clamped = apply(next)
      useTimelineCommandStore
        .getState()
        .addUndoEntry(
          { type: 'RATE_STRETCH_ITEM', payload: { ids: stretchable, newSpeed: clamped } },
          before,
        )
      snapshotRef.current = null
    },
    [apply, stretchable],
  )

  if (stretchable.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('editor.concise.shot.noSpeed')}</p>
  }
  return (
    <div className="space-y-2">
      {/* A ramp sets the speed over time; a constant change would only rate-stretch it. */}
      <div title={ramped ? t('editor.speedRamp.constantDisabled') : undefined}>
        <SliderInput
          value={speed}
          onChange={commit}
          onLiveChange={live}
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={0.01}
          unit="x"
          disabled={ramped}
          className="w-full"
        />
      </div>
      <div className="flex gap-1">
        {SPEED_PRESETS.map((preset) => (
          <Button
            key={preset}
            variant={!ramped && speed === preset ? 'secondary' : 'outline'}
            size="sm"
            className="h-7 flex-1 px-0 text-xs"
            disabled={ramped}
            onClick={() => commit(preset)}
          >
            {preset}x
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1" data-testid="concise-shot-speed-ramp">
        {SPEED_RAMP_CHOICES.map((choice) => (
          <Button
            key={choice}
            variant={rampState === choice ? 'secondary' : 'outline'}
            size="sm"
            className="h-7 px-2 text-xs"
            aria-pressed={rampState === choice}
            onClick={() => applySpeedRampChoice(stretchable, choice)}
          >
            {t(SPEED_RAMP_CHOICE_LABEL_KEYS[choice])}
          </Button>
        ))}
      </div>
      {rampRange && (
        <p
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="concise-shot-speed-ramp-readout"
        >
          {rampState === 'custom' ? `${t('editor.speedRamp.custom')} · ` : ''}
          {t('editor.speedRamp.range', {
            min: formatRampSpeed(rampRange.min),
            max: formatRampSpeed(rampRange.max),
          })}
        </p>
      )}
    </div>
  )
}

export function VolumeField({ ids, value }: { ids: string[]; value: number | 'mixed' }) {
  const setPreview = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)
  return (
    <SliderInput
      value={value}
      min={-60}
      max={12}
      step={1}
      unit="dB"
      className="w-full"
      disabled={ids.length === 0}
      onLiveChange={(next) =>
        setPreview(Object.fromEntries(ids.map((id) => [id, { volume: next }])))
      }
      onChange={(next) => {
        updateItemsInOneStep('SET_VOLUME', ids, { volume: next })
        queueMicrotask(() => clearPreview())
      }}
    />
  )
}

export function FadeField({
  label,
  ids,
  value,
  property,
  commandType,
}: {
  label: string
  ids: string[]
  value: number | 'mixed'
  property: 'fadeIn' | 'fadeOut' | 'audioFadeIn' | 'audioFadeOut'
  commandType: string
}) {
  const setPreview = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)
  return (
    <Field label={label}>
      <SliderInput
        value={value}
        min={0}
        max={5}
        step={0.1}
        unit="s"
        className="w-full"
        disabled={ids.length === 0}
        onLiveChange={(next) =>
          setPreview(Object.fromEntries(ids.map((id) => [id, { [property]: next }])))
        }
        onChange={(next) => {
          updateItemsInOneStep(commandType, ids, { [property]: next })
          queueMicrotask(() => clearPreview())
        }}
      />
    </Field>
  )
}

function FadeFields({ items }: { items: VideoItem[] }) {
  const { t } = useTranslation()
  const ids = useMemo(() => items.map((entry) => entry.id), [items])
  return (
    <>
      <FadeField
        label={t('editor.concise.shot.fadeIn')}
        ids={ids}
        value={getMixedValue(items, (entry) => entry.fadeIn, 0)}
        property="fadeIn"
        commandType="SET_FADE_IN"
      />
      <FadeField
        label={t('editor.concise.shot.fadeOut')}
        ids={ids}
        value={getMixedValue(items, (entry) => entry.fadeOut, 0)}
        property="fadeOut"
        commandType="SET_FADE_OUT"
      />
    </>
  )
}
