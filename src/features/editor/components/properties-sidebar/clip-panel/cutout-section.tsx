import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Eraser, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { CutoutSettings, CutoutSubject } from '@/types/cutout'
import { cutoutModelFor } from '@/shared/cutout/cutout-core.mjs'
import { PropertyRow, PropertySection, SliderInput } from '../components'
import { getMixedValue } from '../utils'
import {
  cancelCutout,
  reanalyseCutout,
  setClipCutout,
  useCutoutStatus,
  type CutoutUiStatus,
} from '@/features/editor/hooks/use-cutout-status'
import { CutoutBrushControls } from './cutout-brush-controls'

const SUBJECTS: CutoutSubject[] = ['auto', 'person', 'object']
const BUSY = new Set(['queued', 'downloading', 'preparing', 'analyzing'])

/** Translation key and values for each state's status line. */
const STATUS_TEXT: Partial<
  Record<CutoutUiStatus['state'], (status: CutoutUiStatus) => [string, Record<string, unknown>?]>
> = {
  queued: () => ['editor.cutout.status.queued'],
  downloading: (s) => [
    'editor.cutout.status.downloading',
    { percent: Math.round(s.progress * 100), size: Math.round((s.job?.total ?? 0) / 1e6) },
  ],
  preparing: () => ['editor.cutout.status.preparing'],
  analyzing: (s) => [
    'editor.cutout.status.analyzing',
    { done: s.job?.done ?? 0, count: s.job?.count ?? 0 },
  ],
  ready: (s) => ['editor.cutout.status.ready', { count: s.needed }],
  partial: (s) => ['editor.cutout.status.partial', { done: s.done, count: s.needed }],
  none: () => ['editor.cutout.status.none'],
  error: (s) => ['editor.cutout.status.error', { error: s.error ?? '' }],
  'no-media': () => ['editor.cutout.status.noMedia'],
}

/** The status line under the controls: model download, analysis progress, or coverage. */
export function CutoutStatusLine({ status }: { status: CutoutUiStatus }) {
  const { t } = useTranslation()
  const entry = STATUS_TEXT[status.state]?.(status)
  if (!entry) return null
  const busy = BUSY.has(status.state)
  return (
    <div className="space-y-1" data-testid="cutout-status">
      {busy && <Progress value={status.progress * 100} className="h-1" />}
      <p
        className={
          status.state === 'error'
            ? 'text-xs text-destructive'
            : 'text-xs text-muted-foreground tabular-nums'
        }
      >
        {t(entry[0], entry[1])}
      </p>
    </div>
  )
}

/**
 * Remove background: cut the subject (a person, or the main object) out of a
 * clip shot in a real room, without a green screen. Analysis runs in the
 * background; feather, edge and invert apply at draw time and never re-run
 * the model (a new sample rate analyses the new samples).
 */
export function CutoutSection({ items }: { items: TimelineItem[] }) {
  const { t } = useTranslation()
  const videoItems = useMemo(
    () => items.filter((item): item is VideoItem => item.type === 'video'),
    [items],
  )
  const first = videoItems[0]
  const status = useCutoutStatus(first)
  const enabled = videoItems.length > 0 && videoItems.every((item) => item.cutout?.enabled)
  const subject = getMixedValue(videoItems, (item) => item.cutout?.subject, 'auto')
  const feather = getMixedValue(videoItems, (item) => item.cutout?.feather, 0)
  const refine = getMixedValue(videoItems, (item) => item.cutout?.refine, 0)
  const invert = videoItems.every((item) => item.cutout?.invert === true)
  const full = videoItems.every((item) => item.cutout?.sampleRate === 'full')

  const patch = useCallback(
    (next: Partial<CutoutSettings>) => setClipCutout(videoItems, next),
    [videoItems],
  )

  if (videoItems.length === 0) return null
  const model = cutoutModelFor(
    status.resolvedSubject ?? (subject === 'object' ? 'object' : 'person'),
  )
  const sizeMb = Math.round(model.files.webgpu.bytes / 1e6)

  return (
    <PropertySection title={t('editor.cutout.title')} icon={Eraser} defaultOpen={enabled}>
      <PropertyRow label={t('editor.cutout.enable')}>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => patch({ enabled: checked })}
          aria-label={t('editor.cutout.enable')}
          data-testid="cutout-enable"
        />
      </PropertyRow>
      {enabled && (
        <>
          <PropertyRow label={t('editor.cutout.subject')}>
            <Select
              value={subject === 'mixed' ? '' : subject}
              onValueChange={(value) => patch({ subject: value as CutoutSubject })}
            >
              <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                <SelectValue placeholder={t('editor.cutout.mixed')} />
              </SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((value) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {t(`editor.cutout.subjects.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropertyRow>
          <PropertyRow label={t('editor.cutout.feather')}>
            <SliderInput
              value={feather}
              onChange={(next) => patch({ feather: next })}
              onLiveChange={() => {}}
              min={0}
              max={100}
              step={1}
              unit="px"
              className="flex-1 min-w-0"
            />
          </PropertyRow>
          <PropertyRow label={t('editor.cutout.refine')} tooltip={t('editor.cutout.refineHint')}>
            <SliderInput
              value={typeof refine === 'number' ? Math.round(refine * 100) : refine}
              onChange={(next) => patch({ refine: next / 100 })}
              onLiveChange={() => {}}
              min={0}
              max={100}
              step={1}
              unit="%"
              className="flex-1 min-w-0"
            />
          </PropertyRow>
          <PropertyRow label={t('editor.cutout.invert')}>
            <Switch
              checked={invert}
              onCheckedChange={(checked) => patch({ invert: checked })}
              aria-label={t('editor.cutout.invert')}
            />
          </PropertyRow>
          <PropertyRow
            label={t('editor.cutout.everyFrame')}
            tooltip={t('editor.cutout.everyFrameHint')}
          >
            <Switch
              checked={full}
              onCheckedChange={(checked) => patch({ sampleRate: checked ? 'full' : undefined })}
              aria-label={t('editor.cutout.everyFrame')}
            />
          </PropertyRow>
          <div className="space-y-2 pt-1">
            <CutoutStatusLine status={status} />
            <p className="text-[11px] text-muted-foreground">
              {t('editor.cutout.model', {
                model: model.label,
                license: model.license,
                size: sizeMb,
              })}
            </p>
            {first && (
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1 gap-1 px-2 text-xs"
                  onClick={() => void reanalyseCutout(first)}
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('editor.cutout.reanalyse')}
                </Button>
                {BUSY.has(status.state) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => cancelCutout(first)}
                  >
                    <X className="h-3 w-3" />
                    {t('editor.cutout.cancel')}
                  </Button>
                )}
              </div>
            )}
          </div>
          {first && videoItems.length === 1 && <CutoutBrushControls item={first} />}
        </>
      )}
    </PropertySection>
  )
}
