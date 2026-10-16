/**
 * Painting a cutout fix on the preview (docs/background-removal.md, Smart
 * brush). While the clip panel's Painting toggle is on, this overlay takes
 * pointer strokes over the clip, shows the brush and the path, maps the path
 * back through the clip's transform and crop to source-frame fractions and
 * adds it as one stroke (one undo step) at the source time under the
 * playhead. The clip itself is drawn with its removed area dimmed meanwhile
 * (the renderer reads the same painting state), and a smart stroke shows its
 * tracking progress here.
 */
import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { VideoItem } from '@/types/timeline'
import type { CutoutStroke } from '@/types/cutout'
import {
  getCutoutPaint,
  setCutoutPaint,
  subscribeCutoutPaint,
} from '@/infrastructure/cutout/cutout-paint'
import { getCutoutMediaInfo } from '@/infrastructure/cutout/cutout-masks'
import {
  getCutoutRegionJobs,
  subscribeCutoutRegionJobs,
} from '@/infrastructure/cutout/cutout-regions'
import {
  CUTOUT_MAX_STROKES,
  isEraseStroke,
  isSmartStroke,
  simplifyStroke,
  withCutoutStroke,
} from '@/shared/cutout/cutout-strokes.mjs'
import {
  canvasToSourcePoint,
  sourceShortSideOnCanvas,
  type StrokeMapFrame,
} from '@/shared/cutout/cutout-stroke-map'
import { useResolvedPlaybackFrame } from '@/shared/state/playback/use-resolved-playback-frame'
import {
  executeTimelineCommand,
  useItemsStore,
  useTimelineSettingsStore,
  useTimelineStore,
} from '@/features/preview/deps/timeline-store'
import {
  getItemRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
} from '@/features/preview/deps/export'
import type { CoordinateParams, Point } from '../types/gizmo'
import { getEffectiveScale, screenToCanvas } from '../utils/coordinate-transform'
import { useVisualTransforms } from '../hooks/use-visual-transform'

interface Size {
  width: number
  height: number
}

interface CutoutPaintContainerProps {
  containerRect: DOMRect | null
  playerSize: Size
  projectSize: Size
  zoom: number
}

/** Mounted with the other preview overlays; renders only while a clip is being painted. */
export const CutoutPaintContainer = memo(function CutoutPaintContainer(
  props: CutoutPaintContainerProps,
) {
  const paint = useSyncExternalStore(subscribeCutoutPaint, getCutoutPaint)
  const item = useItemsStore((s) => (paint.itemId ? s.itemById[paint.itemId] : undefined))
  if (!props.containerRect || item?.type !== 'video') return null
  return (
    <CutoutPaintOverlay
      {...props}
      containerRect={props.containerRect}
      item={item}
      tool={paint.tool}
      size={paint.size}
    />
  )
})

/** The clip's source frame size (from the item, else its media). */
function sourceSize(item: VideoItem): Size {
  const info = item.mediaId ? getCutoutMediaInfo(item.mediaId) : null
  return {
    width: item.sourceWidth ?? info?.width ?? 0,
    height: item.sourceHeight ?? info?.height ?? 0,
  }
}

/** The clip's geometry for mapping strokes, at the playhead. */
function useStrokeMapFrame(item: VideoItem, projectSize: Size): StrokeMapFrame | null {
  const transforms = useVisualTransforms([item], projectSize)
  const transform = transforms.get(item.id)
  return useMemo(() => {
    const source = sourceSize(item)
    if (!transform || source.width <= 0 || source.height <= 0) return null
    const { flipHorizontal, flipVertical } = item.transform ?? {}
    const sizes = { sourceWidth: source.width, sourceHeight: source.height }
    return {
      canvas: projectSize,
      transform,
      flipHorizontal,
      flipVertical,
      ...sizes,
      crop: item.crop,
    }
  }, [item, projectSize, transform])
}

/** Tracking progress of this clip's media's smart strokes ("" when none runs). */
function useTrackingLabel(mediaId: string | undefined): { done: number; count: number } | null {
  const jobs = useSyncExternalStore(subscribeCutoutRegionJobs, getCutoutRegionJobs)
  const running = jobs.filter(
    (job) =>
      job.mediaId === mediaId &&
      (job.state === 'queued' || job.state === 'downloading' || job.state === 'tracking'),
  )
  if (running.length === 0) return null
  return {
    done: running.reduce((sum, job) => sum + job.done, 0),
    count: running.reduce((sum, job) => sum + job.count, 0),
  }
}

/** Add a painted path (canvas points) to the clip as one stroke, in one undo step. */
function commitStroke(
  item: VideoItem,
  path: Point[],
  frame: StrokeMapFrame,
  stroke: Pick<CutoutStroke, 'tool' | 'size' | 'at'>,
): void {
  const source = path
    .map((point) => canvasToSourcePoint(point, frame))
    .filter((point): point is [number, number] => point !== null)
  if (source.length === 0 || (item.cutout?.strokes?.length ?? 0) >= CUTOUT_MAX_STROKES) return
  const aspect =
    Math.min(frame.sourceWidth, frame.sourceHeight) /
    Math.max(frame.sourceWidth, frame.sourceHeight)
  const points = simplifyStroke(source, stroke.size * aspect * 0.3)
  const cutout = withCutoutStroke(item.cutout, { ...stroke, points })
  executeTimelineCommand('ADD_CUTOUT_STROKE', () => {
    useTimelineStore.getState().updateItem(item.id, { cutout } as Partial<VideoItem>)
  })
}

const STROKE_COLOURS = { add: 'rgba(56, 189, 248, 0.55)', erase: 'rgba(244, 63, 94, 0.55)' }

const CutoutPaintOverlay = memo(function CutoutPaintOverlay({
  containerRect,
  playerSize,
  projectSize,
  zoom,
  item,
  tool,
  size,
}: Omit<CutoutPaintContainerProps, 'containerRect'> & {
  containerRect: DOMRect
  item: VideoItem
  tool: CutoutStroke['tool']
  size: number
}) {
  const { t } = useTranslation()
  const fps = useTimelineSettingsStore((s) => s.fps)
  const playhead = useResolvedPlaybackFrame(true)
  const frame = useStrokeMapFrame(item, projectSize)
  const tracking = useTrackingLabel(item.mediaId)
  const coords = useMemo(
    (): CoordinateParams => ({ containerRect, playerSize, projectSize, zoom }),
    [containerRect, playerSize, projectSize, zoom],
  )
  const scale = getEffectiveScale(coords)
  const pointerRef = useRef<number | null>(null)
  const [path, setPath] = useState<Point[]>([])
  const [cursor, setCursor] = useState<Point | null>(null)
  const radius = frame ? size * sourceShortSideOnCanvas(frame) * scale : 0
  const probe = { tool, at: 0, size, points: [] } as CutoutStroke
  const colour = isEraseStroke(probe) ? STROKE_COLOURS.erase : STROKE_COLOURS.add

  const toCanvas = useCallback(
    (event: PointerEvent<HTMLDivElement>) => screenToCanvas(event.clientX, event.clientY, coords),
    [coords],
  )
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      pointerRef.current = event.pointerId
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setPath([toCanvas(event)])
    },
    [toCanvas],
  )
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const point = toCanvas(event)
      setCursor(point)
      if (pointerRef.current === event.pointerId) setPath((prev) => [...prev, point])
    },
    [toCanvas],
  )
  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (pointerRef.current !== event.pointerId) return
      pointerRef.current = null
      const span = getItemRenderTimelineSpan(item)
      const at = Math.max(0, resolveVideoRenderSourceTimeSeconds(item, span, playhead, fps))
      if (frame)
        commitStroke(item, [...path, toCanvas(event)], frame, {
          tool,
          size,
          at: Math.round(at * 1000) / 1000,
        })
      setPath([])
    },
    [fps, frame, item, path, playhead, size, toCanvas, tool],
  )

  const toPlayer = (p: Point) => `${p.x * scale},${p.y * scale}`
  return (
    <div
      className="pointer-events-auto absolute z-50 cursor-none touch-none"
      data-testid="cutout-paint-overlay"
      style={{ left: 0, top: 0, width: playerSize.width, height: playerSize.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setPath([])}
      onPointerLeave={() => setCursor(null)}
      onKeyDown={(event) => event.key === 'Escape' && setCutoutPaint({ itemId: null })}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg
        className="pointer-events-none absolute inset-0"
        width={playerSize.width}
        height={playerSize.height}
      >
        {path.length > 0 && (
          <polyline
            points={path.map(toPlayer).join(' ')}
            fill="none"
            stroke={colour}
            strokeWidth={radius * 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={isSmartStroke(probe) ? `${radius} ${radius * 0.6}` : undefined}
          />
        )}
        {cursor && (
          <circle
            cx={cursor.x * scale}
            cy={cursor.y * scale}
            r={radius}
            fill="none"
            stroke="white"
            strokeWidth={1.5}
          />
        )}
      </svg>
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[11px] text-white">
        {tracking
          ? t('editor.cutout.paint.tracking', tracking)
          : t(`editor.cutout.paint.overlay.${tool}`)}
      </div>
    </div>
  )
})
