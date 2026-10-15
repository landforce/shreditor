import {
  useEffect,
  useCallback,
  memo,
  useLayoutEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import {
  Film,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Magnet,
  Scissors,
  Gauge,
  ArrowRightLeft,
  BetweenHorizontalEnd,
  ChevronDown,
  X,
  MousePointer2,
  Undo2,
  Redo2,
  Flag,
  FlagOff,
  Link2,
  Volume2,
  Diamond,
  Trash2,
  Plus,
  MoreHorizontal,
  PanelLeft,
  Check,
  Mic,
  Music,
} from 'lucide-react'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { Separator } from '@/components/ui/separator'
import { formatHotkeyBinding } from '@/config/hotkeys'
import { useTimelineStore } from '../stores/timeline-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useZoomStore } from '../stores/zoom-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { ZOOM_MIN, ZOOM_MAX, SLIP_SLIDE_TOOLS_ENABLED } from '../constants'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'
import { MicRecordControl } from './mic-record-control'
import { isConciseWorkspace } from '@/config/editor-workspaces'
import type { EditorSidebarTab } from '@/config/editor-workspaces'
import { useMicRecordingStore } from '@/shared/state/mic-recording-store'
import { AgentCommentButton } from './timeline-agent-comments'
import { useConciseTimelineStore } from '../stores/concise-timeline-store'
import { deleteSelectionFromStores, splitAtPlayhead } from '../utils/editing-commands'
import { isMicRecordingSupported, startMicRecording } from '../services/mic-recording-controller'

interface TimelineHeaderProps {
  onZoomChange?: (newZoom: number) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onZoomToFit?: () => void
}

function TrimEditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="10.6" y="4" width="2.8" height="16" rx="0.75" fill="currentColor" opacity="0.72" />
      <path d="m9 7-6 5 6 5z" fill="currentColor" stroke="none" />
      <path d="m15 7 6 5-6 5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

const InlineKeyframesToggle = memo(function InlineKeyframesToggle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const label = t(
    isOpen ? 'timeline.keyframeEditor.editLane.hide' : 'timeline.keyframeEditor.editLane.show',
    { defaultValue: isOpen ? 'Hide keyframe panel' : 'Show keyframe panel' },
  )

  return (
    <Button
      variant="ghost"
      size="icon"
      style={{
        width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
        height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
      }}
      className={isOpen ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}
      onClick={onToggle}
      aria-label={label}
      aria-pressed={isOpen}
      data-tooltip={label}
    >
      <Diamond className="h-3.5 w-3.5" />
    </Button>
  )
})

function isDifferentSliderValue(previousValue: number | null, nextValue: number): boolean {
  return previousValue === null || Math.abs(previousValue - nextValue) > 0.000001
}

function isSameZoomLevel(left: number, right: number): boolean {
  const tolerance = Math.max(0.000001, Math.max(Math.abs(left), Math.abs(right)) * 0.0001)
  return Math.abs(left - right) <= tolerance
}

function blurSliderFocus(root: HTMLElement | null): void {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && root?.contains(activeElement)) {
    activeElement.blur()
  }
}

const TimelineZoomControls = memo(function TimelineZoomControls({
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
}: TimelineHeaderProps) {
  const { t } = useTranslation()
  const settledZoomLevel = useZoomStore((state) => state.contentLevel)
  const zoomIn = useZoomStore((state) => state.zoomIn)
  const zoomOut = useZoomStore((state) => state.zoomOut)
  const beginZoomGesture = useZoomStore((state) => state.beginZoomGesture)
  const endZoomGesture = useZoomStore((state) => state.endZoomGesture)
  const setZoomImmediate = useZoomStore((state) => state.setZoomLevelImmediate)
  const setZoomSynchronized = useZoomStore((state) => state.setZoomLevelSynchronized)
  const sliderRef = useRef<HTMLSpanElement>(null)
  const sliderRafRef = useRef<number | null>(null)
  const pendingSliderValueRef = useRef<number | null>(null)
  const latestSliderValueRef = useRef<number | null>(null)
  const sliderInteractionRef = useRef<'idle' | 'dragging' | 'awaiting-zoom'>('idle')
  const sliderCommitBaseZoomRef = useRef<number | null>(null)
  const sliderKeyboardInputRef = useRef(false)
  const sliderZoomGestureHeldRef = useRef(false)
  const liveZoomLevelRef = useRef(useZoomStore.getState().level)
  const [, forceKeyboardSliderRender] = useReducer((revision: number) => revision + 1, 0)
  const btnSize = {
    width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
    height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
  } as const

  const applyZoom = useCallback(
    (newZoom: number, synchronizeContent = false) => {
      const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom))
      if (onZoomChange) {
        onZoomChange(clampedZoom)
      } else if (synchronizeContent) {
        setZoomSynchronized(clampedZoom)
      } else {
        setZoomImmediate(clampedZoom)
      }
    },
    [onZoomChange, setZoomImmediate, setZoomSynchronized],
  )

  const sliderToZoom = useCallback(
    (sliderValue: number) => ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, sliderValue),
    [],
  )

  const zoomToSlider = useCallback(
    (zoom: number) => Math.log(zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN),
    [],
  )

  const renderSliderPreview = useCallback((sliderValue: number) => {
    const root = sliderRef.current
    const thumb = root?.querySelector<HTMLElement>('[role="slider"]')
    const thumbPositioner = thumb?.parentElement
    const track = root?.firstElementChild as HTMLElement | null
    const range = track?.firstElementChild as HTMLElement | null
    if (!thumb || !thumbPositioner || !range) return

    const value = Math.max(0, Math.min(1, sliderValue))
    const percentage = value * 100
    const thumbOffset = 8 - value * 16
    thumbPositioner.style.left = `calc(${percentage}% + ${thumbOffset}px)`
    range.style.left = '0%'
    range.style.right = `${100 - percentage}%`
    thumb.setAttribute('aria-valuenow', String(value))
  }, [])

  const releaseSliderZoomGesture = useCallback(() => {
    if (!sliderZoomGestureHeldRef.current) {
      return
    }
    sliderZoomGestureHeldRef.current = false
    endZoomGesture()
  }, [endZoomGesture])

  const finishSliderZoomInteraction = useCallback(() => {
    releaseSliderZoomGesture()
    // Radix can restore thumb focus after onValueCommit returns. Defer the
    // blur until the pointer/key event has fully finished so Space immediately
    // returns to the editor transport.
    queueMicrotask(() => blurSliderFocus(sliderRef.current))
  }, [releaseSliderZoomGesture])

  const beginSliderZoomGesture = useCallback(() => {
    if (sliderZoomGestureHeldRef.current) {
      return
    }
    sliderZoomGestureHeldRef.current = true
    beginZoomGesture()
  }, [beginZoomGesture])

  const flushSliderChange = useCallback(() => {
    sliderRafRef.current = null
    const sliderValue = pendingSliderValueRef.current
    pendingSliderValueRef.current = null
    if (sliderValue === null) return
    applyZoom(sliderToZoom(sliderValue))
  }, [applyZoom, sliderToZoom])

  useLayoutEffect(() => {
    const liveZoomLevel = useZoomStore.getState().level
    liveZoomLevelRef.current = liveZoomLevel
    const sliderPreviewValue = latestSliderValueRef.current
    if (sliderPreviewValue !== null && sliderInteractionRef.current !== 'dragging') {
      const commitBaseZoom = sliderCommitBaseZoomRef.current
      if (commitBaseZoom === null || !isSameZoomLevel(liveZoomLevel, commitBaseZoom)) {
        // The first store update after release owns the controlled value even when
        // another zoom gesture superseded the slider's queued target.
        latestSliderValueRef.current = null
        sliderCommitBaseZoomRef.current = null
        sliderInteractionRef.current = 'idle'
      }
    }

    if (sliderInteractionRef.current !== 'dragging') {
      const previewValue = latestSliderValueRef.current
      renderSliderPreview(previewValue ?? zoomToSlider(liveZoomLevel))
    }
  }, [renderSliderPreview, settledZoomLevel, zoomToSlider])

  useEffect(() => {
    return useZoomStore.subscribe((state) => {
      const nextZoomLevel = state.level
      if (isSameZoomLevel(nextZoomLevel, liveZoomLevelRef.current)) return
      liveZoomLevelRef.current = nextZoomLevel
      if (sliderInteractionRef.current === 'dragging') return

      const commitBaseZoom = sliderCommitBaseZoomRef.current
      if (
        sliderInteractionRef.current === 'awaiting-zoom' &&
        commitBaseZoom !== null &&
        !isSameZoomLevel(nextZoomLevel, commitBaseZoom)
      ) {
        latestSliderValueRef.current = null
        sliderCommitBaseZoomRef.current = null
        sliderInteractionRef.current = 'idle'
      }

      renderSliderPreview(zoomToSlider(nextZoomLevel))
    })
  }, [renderSliderPreview, zoomToSlider])

  useEffect(() => {
    window.addEventListener('pointerup', finishSliderZoomInteraction)
    window.addEventListener('pointercancel', finishSliderZoomInteraction)

    return () => {
      window.removeEventListener('pointerup', finishSliderZoomInteraction)
      window.removeEventListener('pointercancel', finishSliderZoomInteraction)
      if (sliderRafRef.current !== null) {
        cancelAnimationFrame(sliderRafRef.current)
      }
      releaseSliderZoomGesture()
    }
  }, [finishSliderZoomInteraction, releaseSliderZoomGesture])

  const handleSliderChange = useCallback(
    (values: number[]) => {
      const sliderValue = values[0] ?? 0.5
      sliderInteractionRef.current = 'dragging'
      sliderCommitBaseZoomRef.current = null
      latestSliderValueRef.current = sliderValue
      renderSliderPreview(sliderValue)
      if (sliderKeyboardInputRef.current) {
        // Radix derives the next arrow-key step from its controlled value. Keep
        // that value current for keyboard input even though wheel zoom remains
        // on the imperative DOM path until content zoom settles.
        forceKeyboardSliderRender()
        if (onZoomChange) {
          applyZoom(sliderToZoom(sliderValue))
          return
        }
        if (sliderRafRef.current !== null) {
          cancelAnimationFrame(sliderRafRef.current)
          sliderRafRef.current = null
        }
        pendingSliderValueRef.current = null
        applyZoom(sliderToZoom(sliderValue), true)
        return
      }
      if (onZoomChange) {
        applyZoom(sliderToZoom(sliderValue))
        return
      }

      pendingSliderValueRef.current = sliderValue
      if (sliderRafRef.current === null) {
        sliderRafRef.current = requestAnimationFrame(flushSliderChange)
      }
    },
    [
      applyZoom,
      flushSliderChange,
      forceKeyboardSliderRender,
      onZoomChange,
      renderSliderPreview,
      sliderToZoom,
    ],
  )

  const commitSliderZoom = useCallback(
    (sliderValue: number, previousSliderValue: number | null) => {
      if (onZoomChange) {
        if (isDifferentSliderValue(previousSliderValue, sliderValue)) {
          applyZoom(sliderToZoom(sliderValue))
        }
        return
      }

      if (
        pendingSliderValueRef.current === null &&
        isDifferentSliderValue(previousSliderValue, sliderValue)
      ) {
        pendingSliderValueRef.current = sliderValue
      }
      if (sliderRafRef.current !== null) {
        cancelAnimationFrame(sliderRafRef.current)
        sliderRafRef.current = null
      }
      flushSliderChange()
    },
    [applyZoom, flushSliderChange, onZoomChange, sliderToZoom],
  )

  const handleSliderCommit = useCallback(
    (values: number[]) => {
      const sliderValue = values[0] ?? 0.5
      const latestSliderValue = latestSliderValueRef.current
      sliderInteractionRef.current = 'awaiting-zoom'
      sliderCommitBaseZoomRef.current = useZoomStore.getState().level
      latestSliderValueRef.current = sliderValue
      renderSliderPreview(sliderValue)
      commitSliderZoom(sliderValue, latestSliderValue)
      if (sliderKeyboardInputRef.current) {
        releaseSliderZoomGesture()
      } else {
        finishSliderZoomInteraction()
      }
    },
    [commitSliderZoom, finishSliderZoomInteraction, releaseSliderZoomGesture, renderSliderPreview],
  )

  const controlledSliderValue = zoomToSlider(settledZoomLevel)
  const sliderCommitBaseZoom = sliderCommitBaseZoomRef.current
  const shouldRenderSliderPreview =
    latestSliderValueRef.current !== null &&
    (sliderInteractionRef.current === 'dragging' ||
      (sliderInteractionRef.current === 'awaiting-zoom' &&
        sliderCommitBaseZoom !== null &&
        isSameZoomLevel(liveZoomLevelRef.current, sliderCommitBaseZoom)))

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        style={btnSize}
        onClick={onZoomOut ?? zoomOut}
        aria-label={t('timeline.header.zoomOut')}
        data-tooltip={t('timeline.header.zoomOutTooltip')}
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </Button>

      <Slider
        ref={sliderRef}
        value={[
          shouldRenderSliderPreview
            ? (latestSliderValueRef.current ?? controlledSliderValue)
            : controlledSliderValue,
        ]}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
        onPointerDownCapture={beginSliderZoomGesture}
        onPointerCancelCapture={finishSliderZoomInteraction}
        onKeyDownCapture={() => {
          sliderKeyboardInputRef.current = true
        }}
        onKeyUpCapture={() => {
          // Keep the keyboard marker set through Radix's onValueCommit, which
          // runs later in this keyup event. The next microtask ends the input.
          queueMicrotask(() => {
            sliderKeyboardInputRef.current = false
          })
        }}
        onBlurCapture={() => {
          sliderKeyboardInputRef.current = false
        }}
        min={0}
        max={1}
        step={0.005}
        className="w-24"
        aria-label={t('timeline.header.zoomSlider')}
      />

      <Button
        variant="ghost"
        size="icon"
        style={btnSize}
        onClick={onZoomIn ?? zoomIn}
        aria-label={t('timeline.header.zoomIn')}
        data-tooltip={t('timeline.header.zoomInTooltip')}
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        style={btnSize}
        onClick={onZoomToFit}
        aria-label={t('timeline.header.zoomToFit')}
        data-tooltip={t('timeline.header.zoomToFitTooltip')}
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
})

/**
 * State and handlers shared by the full and the concise (compact) toolbars, so
 * a control behaves identically wherever it is rendered.
 */
function useTimelineHeaderModel() {
  const { t } = useTranslation()
  const hotkeys = useResolvedHotkeys()
  const snapEnabled = useTimelineStore((s) => s.snapEnabled)
  const toggleSnap = useTimelineStore((s) => s.toggleSnap)
  const audioSkimmingEnabled = useTimelineStore((s) => s.audioSkimmingEnabled)
  const toggleAudioSkimming = useTimelineStore((s) => s.toggleAudioSkimming)
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const setInPoint = useTimelineStore((s) => s.setInPoint)
  const setOutPoint = useTimelineStore((s) => s.setOutPoint)
  const clearInOutPoints = useTimelineStore((s) => s.clearInOutPoints)
  const addMarker = useTimelineStore((s) => s.addMarker)
  // Only subscribe to marker count for disabled state - avoids re-render on marker changes
  const hasMarkers = useTimelineStore((s) => s.markers.length > 0)
  const removeMarker = useTimelineStore((s) => s.removeMarker)
  const clearAllMarkers = useTimelineStore((s) => s.clearAllMarkers)
  // NOTE: Don't subscribe to currentFrame - only needed in click handlers
  // Read from store directly when needed to avoid re-renders every frame
  const activeTool = useSelectionStore((s) => s.activeTool)
  const setActiveTool = useSelectionStore((s) => s.setActiveTool)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId)
  const inlineKeyframesOpen = useSelectionStore((s) => s.editKeyframePanelOpen)
  const toggleEditKeyframePanel = useSelectionStore((s) => s.toggleEditKeyframePanel)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const linkedSelectionEnabled = useEditorStore((s) => s.linkedSelectionEnabled)
  const setLinkedSelectionEnabled = useEditorStore((s) => s.setLinkedSelectionEnabled)
  const canUndo = useTimelineCommandStore((s) => s.canUndo)
  const canRedo = useTimelineCommandStore((s) => s.canRedo)
  const undoLabel = useTimelineCommandStore((s) => s.getUndoLabel())
  const redoLabel = useTimelineCommandStore((s) => s.getRedoLabel())
  const SlipSlideFlyoutIcon = activeTool === 'slide' ? BetweenHorizontalEnd : ArrowRightLeft

  const btnSize = {
    width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
    height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
  } as const

  const handleUndo = () => {
    useTimelineStore.temporal.getState().undo()
  }

  const handleRedo = () => {
    useTimelineStore.temporal.getState().redo()
  }

  const selectTool = () => setActiveTool('select')
  const toggleTrimTool = () => setActiveTool(activeTool === 'trim-edit' ? 'select' : 'trim-edit')
  const toggleRazorTool = () => setActiveTool(activeTool === 'razor' ? 'select' : 'razor')
  const toggleRateStretchTool = () =>
    setActiveTool(activeTool === 'rate-stretch' ? 'select' : 'rate-stretch')
  const toggleSlipTool = () => setActiveTool(activeTool === 'slip' ? 'select' : 'slip')
  const toggleSlideTool = () => setActiveTool(activeTool === 'slide' ? 'select' : 'slide')
  const handleSetInPoint = () => setInPoint(usePlaybackStore.getState().currentFrame)
  const handleSetOutPoint = () => setOutPoint(usePlaybackStore.getState().currentFrame)
  const handleAddMarker = () => addMarker(usePlaybackStore.getState().currentFrame)
  const handleRemoveSelectedMarker = () => {
    if (selectedMarkerId) {
      removeMarker(selectedMarkerId)
      clearSelection()
    }
  }
  const toggleLinkedSelection = () => setLinkedSelectionEnabled(!linkedSelectionEnabled)

  return {
    t,
    hotkeys,
    snapEnabled,
    toggleSnap,
    audioSkimmingEnabled,
    toggleAudioSkimming,
    inPoint,
    outPoint,
    clearInOutPoints,
    hasMarkers,
    clearAllMarkers,
    activeTool,
    selectedMarkerId,
    inlineKeyframesOpen,
    toggleEditKeyframePanel,
    linkedSelectionEnabled,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    SlipSlideFlyoutIcon,
    btnSize,
    handleUndo,
    handleRedo,
    selectTool,
    toggleTrimTool,
    toggleRazorTool,
    toggleRateStretchTool,
    toggleSlipTool,
    toggleSlideTool,
    handleSetInPoint,
    handleSetOutPoint,
    handleAddMarker,
    handleRemoveSelectedMarker,
    toggleLinkedSelection,
  }
}

type HeaderModel = ReturnType<typeof useTimelineHeaderModel>

function TimelineToolGroup({ model }: { model: HeaderModel }) {
  const {
    t,
    hotkeys,
    activeTool,
    SlipSlideFlyoutIcon,
    btnSize,
    selectTool,
    toggleTrimTool,
    toggleRazorTool,
    toggleRateStretchTool,
    toggleSlipTool,
    toggleSlideTool,
  } = model
  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          className={
            activeTool === 'select' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }
          onClick={selectTool}
          aria-label={t('timeline.header.selectTool')}
          data-tooltip={t('timeline.header.selectToolTooltip')}
        >
          <MousePointer2 className="w-3.5 h-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          className={
            activeTool === 'trim-edit'
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : ''
          }
          onClick={toggleTrimTool}
          aria-label={t('timeline.header.trimEditTool')}
          data-tooltip={t('timeline.header.trimEditToolTooltip')}
        >
          <TrimEditIcon className="w-3.5 h-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          className={
            activeTool === 'razor' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }
          onClick={toggleRazorTool}
          aria-label={t('timeline.header.razorTool')}
          data-tooltip={t('timeline.header.razorToolTooltip')}
        >
          <Scissors className="w-3.5 h-3.5 -rotate-90" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          className={
            activeTool === 'rate-stretch'
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : ''
          }
          onClick={toggleRateStretchTool}
          aria-label={t('timeline.header.rateStretchTool')}
          data-tooltip={t('timeline.header.rateStretchToolTooltip')}
        >
          <Gauge className="w-3.5 h-3.5" />
        </Button>

        {SLIP_SLIDE_TOOLS_ENABLED ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                style={{ height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }}
                className={`gap-1 px-2 ${
                  activeTool === 'slip' || activeTool === 'slide'
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : ''
                }`}
                aria-label={t('timeline.header.slipSlideTools')}
                data-tooltip={t('timeline.header.slipSlideToolsTooltip')}
              >
                <span className="flex items-center gap-1">
                  <span className="inline-flex items-center justify-center">
                    <SlipSlideFlyoutIcon className="w-3.5 h-3.5" />
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={toggleSlipTool}>
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span className="flex-1">{t('timeline.header.slipTool')}</span>
                <span className="text-xs text-muted-foreground">
                  {formatHotkeyBinding(hotkeys.SLIP_TOOL)}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleSlideTool}>
                <BetweenHorizontalEnd className="w-3.5 h-3.5" />
                <span className="flex-1">{t('timeline.header.slideTool')}</span>
                <span className="text-xs text-muted-foreground">
                  {formatHotkeyBinding(hotkeys.SLIDE_TOOL)}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </>
  )
}

function UndoRedoGroup({ model }: { model: HeaderModel }) {
  const { t, btnSize, canUndo, canRedo, undoLabel, redoLabel, handleUndo, handleRedo } = model
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        style={btnSize}
        onClick={handleUndo}
        disabled={!canUndo}
        aria-label={
          undoLabel
            ? t('timeline.header.undoWithLabel', { label: undoLabel })
            : t('timeline.header.undo')
        }
        data-tooltip={
          undoLabel
            ? t('timeline.header.undoWithLabelTooltip', { label: undoLabel })
            : t('timeline.header.undoTooltip')
        }
      >
        <Undo2 className="w-3.5 h-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        style={btnSize}
        onClick={handleRedo}
        disabled={!canRedo}
        aria-label={
          redoLabel
            ? t('timeline.header.redoWithLabel', { label: redoLabel })
            : t('timeline.header.redo')
        }
        data-tooltip={
          redoLabel
            ? t('timeline.header.redoWithLabelTooltip', { label: redoLabel })
            : t('timeline.header.redoTooltip')
        }
      >
        <Redo2 className="w-3.5 h-3.5" />
      </Button>
    </>
  )
}

function InOutPointGroup({ model }: { model: HeaderModel }) {
  const { t, btnSize, inPoint, outPoint, clearInOutPoints, handleSetInPoint, handleSetOutPoint } =
    model
  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          onClick={handleSetInPoint}
          aria-label={t('timeline.header.setInPoint')}
          data-tooltip={t('timeline.header.setInPointTooltip')}
        >
          <span className="text-sm font-bold" style={{ color: 'var(--color-timeline-in)' }}>
            [
          </span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          onClick={handleSetOutPoint}
          aria-label={t('timeline.header.setOutPoint')}
          data-tooltip={t('timeline.header.setOutPointTooltip')}
        >
          <span className="text-sm font-bold" style={{ color: 'var(--color-timeline-out)' }}>
            ]
          </span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          onClick={clearInOutPoints}
          disabled={inPoint === null && outPoint === null}
          aria-label={t('timeline.header.clearInOutPoints')}
          data-tooltip={t('timeline.header.clearInOutPointsTooltip')}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </>
  )
}

function MarkerGroup({ model }: { model: HeaderModel }) {
  const {
    t,
    btnSize,
    selectedMarkerId,
    hasMarkers,
    clearAllMarkers,
    handleAddMarker,
    handleRemoveSelectedMarker,
  } = model
  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          onClick={handleAddMarker}
          aria-label={t('timeline.header.addMarker')}
          data-tooltip={t('timeline.header.addMarkerTooltip')}
        >
          <Flag className="w-3.5 h-3.5" style={{ color: 'var(--color-timeline-marker)' }} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          onClick={handleRemoveSelectedMarker}
          disabled={!selectedMarkerId}
          aria-label={t('timeline.header.removeSelectedMarker')}
          data-tooltip={t('timeline.header.removeSelectedMarkerTooltip')}
        >
          <FlagOff className="w-3.5 h-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          onClick={clearAllMarkers}
          disabled={!hasMarkers}
          aria-label={t('timeline.header.clearAllMarkers')}
          data-tooltip={t('timeline.header.clearAllMarkersTooltip')}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </>
  )
}

/** An icon button that lights up while its mode is on. */
function ToggleToolButton({
  btnSize,
  active,
  label,
  tooltip,
  exposePressed = false,
  onClick,
  children,
}: {
  btnSize: HeaderModel['btnSize']
  active: boolean
  label: string
  tooltip: string
  exposePressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      style={btnSize}
      className={active ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}
      onClick={onClick}
      aria-label={label}
      aria-pressed={exposePressed ? active : undefined}
      data-tooltip={tooltip}
    >
      {children}
    </Button>
  )
}

function ModeToggleGroup({ model }: { model: HeaderModel }) {
  const { t, hotkeys, btnSize, snapEnabled, audioSkimmingEnabled, linkedSelectionEnabled } = model
  const pick = (on: boolean, onKey: string, offKey: string) =>
    t(`timeline.header.${on ? onKey : offKey}`)
  return (
    <>
      <ToggleToolButton
        btnSize={btnSize}
        active={snapEnabled}
        label={pick(snapEnabled, 'disableSnapping', 'enableSnapping')}
        tooltip={pick(snapEnabled, 'snapEnabled', 'snapDisabled')}
        onClick={model.toggleSnap}
      >
        <Magnet className="w-3.5 h-3.5" />
      </ToggleToolButton>

      <ToggleToolButton
        btnSize={btnSize}
        active={audioSkimmingEnabled}
        label={pick(audioSkimmingEnabled, 'disableAudioSkimming', 'enableAudioSkimming')}
        tooltip={pick(audioSkimmingEnabled, 'audioSkimmingEnabled', 'audioSkimmingDisabled')}
        exposePressed
        onClick={model.toggleAudioSkimming}
      >
        <Volume2 className="w-3.5 h-3.5" />
      </ToggleToolButton>

      <Separator orientation="vertical" className="h-5 mx-1.5" />

      <InlineKeyframesToggle
        isOpen={model.inlineKeyframesOpen}
        onToggle={model.toggleEditKeyframePanel}
      />

      <ToggleToolButton
        btnSize={btnSize}
        active={linkedSelectionEnabled}
        label={pick(linkedSelectionEnabled, 'disableLinkedSelection', 'enableLinkedSelection')}
        tooltip={t('timeline.header.linkedSelectionTooltip', {
          state: pick(linkedSelectionEnabled, 'linkedSelectionOn', 'linkedSelectionOff'),
          shortcut: formatHotkeyBinding(hotkeys.TOGGLE_LINKED_SELECTION),
        })}
        exposePressed
        onClick={model.toggleLinkedSelection}
      >
        <Link2 className="w-3.5 h-3.5" />
      </ToggleToolButton>
    </>
  )
}

/**
 * Timeline Toolbar Component
 *
 * Unified toolbar for timeline controls:
 * - Select/Razor tools
 * - Undo/Redo
 * - In/Out points, Snap toggle
 * - Zoom controls
 */
const FullTimelineHeader = memo(function FullTimelineHeader({
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
}: TimelineHeaderProps) {
  const model = useTimelineHeaderModel()
  const { t } = model

  return (
    <div
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3"
      style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineHeaderHeight }}
      role="toolbar"
      aria-label={t('timeline.header.controls')}
    >
      {/* Left: Title */}
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
          <Film className="w-3 h-3" />
          {t('timeline.header.title')}
        </h2>
      </div>

      {/* Middle: Timeline Controls */}
      <div className="min-w-0 overflow-x-auto overflow-y-hidden">
        <div className="flex w-max min-w-full items-center justify-center gap-2.5">
          <TimelineToolGroup model={model} />

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          <div className="flex items-center gap-1">
            <UndoRedoGroup model={model} />
          </div>

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          <InOutPointGroup model={model} />

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          <MarkerGroup model={model} />

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          {/* Microphone voiceover */}
          <MicRecordControl />

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          <ModeToggleGroup model={model} />
        </div>
      </div>

      <TimelineZoomControls
        onZoomChange={onZoomChange}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomToFit={onZoomToFit}
      />
    </div>
  )
})

const CONCISE_ADD_TABS: readonly EditorSidebarTab[] = [
  'media',
  'text',
  'shapes',
  'effects',
  'transitions',
  'lottie',
  'templates',
  'transcript',
  'ai',
]

/** Show the media sidebar on `tab`, the same way the shell's rail does. */
function openSidebarTab(tab: EditorSidebarTab): void {
  const editor = useEditorStore.getState()
  editor.setActiveTab(tab)
  editor.setLeftSidebarOpen(true)
}

function MoreMenuItem({
  icon,
  label,
  hint,
  checked,
  disabled,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  hint?: string
  checked?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <DropdownMenuItem disabled={disabled} onClick={onClick}>
      <span className="inline-flex w-3.5 items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {checked ? <Check className="h-3.5 w-3.5" /> : null}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </DropdownMenuItem>
  )
}

const hotkeyHint = (binding: string | undefined): string | undefined =>
  binding ? formatHotkeyBinding(binding) : undefined

function ConciseAddMenu() {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          style={{ height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }}
          className="gap-1 px-2"
          aria-label={t('timeline.concise.add')}
          data-tooltip={t('timeline.concise.add')}
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="text-xs">{t('timeline.concise.add')}</span>
          <ChevronDown className="w-3 h-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {CONCISE_ADD_TABS.map((tab) => (
          <DropdownMenuItem key={tab} onClick={() => openSidebarTab(tab)}>
            {t(`timeline.concise.addItems.${tab}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ConciseMoreMenu({ model: m }: { model: HeaderModel }) {
  const { t, hotkeys, btnSize } = m
  const showBeatGrid = useSettingsStore((s) => s.showBeatGrid)
  const setSetting = useSettingsStore((s) => s.setSetting)
  const micStatus = useMicRecordingStore((s) => s.status)
  const micSupported = isMicRecordingSupported()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          aria-label={t('timeline.concise.more')}
          data-tooltip={t('timeline.concise.more')}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <MoreMenuItem
          icon={<TrimEditIcon className="w-3.5 h-3.5" />}
          label={t('timeline.header.trimEditTool')}
          hint={hotkeyHint(hotkeys.TRIM_EDIT_TOOL)}
          checked={m.activeTool === 'trim-edit'}
          onClick={m.toggleTrimTool}
        />
        <MoreMenuItem
          icon={<Scissors className="w-3.5 h-3.5 -rotate-90" />}
          label={t('timeline.header.razorTool')}
          hint={hotkeyHint(hotkeys.RAZOR_TOOL)}
          checked={m.activeTool === 'razor'}
          onClick={m.toggleRazorTool}
        />
        <MoreMenuItem
          icon={<Gauge className="w-3.5 h-3.5" />}
          label={t('timeline.header.rateStretchTool')}
          hint={hotkeyHint(hotkeys.RATE_STRETCH_TOOL)}
          checked={m.activeTool === 'rate-stretch'}
          onClick={m.toggleRateStretchTool}
        />
        {SLIP_SLIDE_TOOLS_ENABLED ? (
          <>
            <MoreMenuItem
              icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
              label={t('timeline.header.slipTool')}
              hint={hotkeyHint(hotkeys.SLIP_TOOL)}
              checked={m.activeTool === 'slip'}
              onClick={m.toggleSlipTool}
            />
            <MoreMenuItem
              icon={<BetweenHorizontalEnd className="w-3.5 h-3.5" />}
              label={t('timeline.header.slideTool')}
              hint={hotkeyHint(hotkeys.SLIDE_TOOL)}
              checked={m.activeTool === 'slide'}
              onClick={m.toggleSlideTool}
            />
          </>
        ) : null}

        <DropdownMenuSeparator />
        <MoreMenuItem
          icon={
            <span className="text-sm font-bold" style={{ color: 'var(--color-timeline-in)' }}>
              [
            </span>
          }
          label={t('timeline.header.setInPoint')}
          hint={hotkeyHint(hotkeys.MARK_IN)}
          onClick={m.handleSetInPoint}
        />
        <MoreMenuItem
          icon={
            <span className="text-sm font-bold" style={{ color: 'var(--color-timeline-out)' }}>
              ]
            </span>
          }
          label={t('timeline.header.setOutPoint')}
          hint={hotkeyHint(hotkeys.MARK_OUT)}
          onClick={m.handleSetOutPoint}
        />
        <MoreMenuItem
          icon={<X className="w-3.5 h-3.5" />}
          label={t('timeline.header.clearInOutPoints')}
          hint={hotkeyHint(hotkeys.CLEAR_IN_OUT)}
          disabled={m.inPoint === null && m.outPoint === null}
          onClick={m.clearInOutPoints}
        />

        <DropdownMenuSeparator />
        <MoreMenuItem
          icon={<Flag className="w-3.5 h-3.5" style={{ color: 'var(--color-timeline-marker)' }} />}
          label={t('timeline.header.addMarker')}
          hint={hotkeyHint(hotkeys.ADD_MARKER)}
          onClick={m.handleAddMarker}
        />
        <MoreMenuItem
          icon={<FlagOff className="w-3.5 h-3.5" />}
          label={t('timeline.header.removeSelectedMarker')}
          hint={hotkeyHint(hotkeys.REMOVE_MARKER)}
          disabled={!m.selectedMarkerId}
          onClick={m.handleRemoveSelectedMarker}
        />
        <MoreMenuItem
          icon={<X className="w-3.5 h-3.5" />}
          label={t('timeline.header.clearAllMarkers')}
          disabled={!m.hasMarkers}
          onClick={m.clearAllMarkers}
        />

        <DropdownMenuSeparator />
        {micSupported ? (
          <MoreMenuItem
            icon={<Mic className="w-3.5 h-3.5" style={{ color: 'var(--color-destructive)' }} />}
            label={t('recording.record')}
            disabled={micStatus !== 'idle'}
            onClick={() => void startMicRecording()}
          />
        ) : null}
        <MoreMenuItem
          icon={<Volume2 className="w-3.5 h-3.5" />}
          label={
            m.audioSkimmingEnabled
              ? t('timeline.header.disableAudioSkimming')
              : t('timeline.header.enableAudioSkimming')
          }
          checked={m.audioSkimmingEnabled}
          onClick={m.toggleAudioSkimming}
        />
        <MoreMenuItem
          icon={<Diamond className="w-3.5 h-3.5" />}
          label={t(
            m.inlineKeyframesOpen
              ? 'timeline.keyframeEditor.editLane.hide'
              : 'timeline.keyframeEditor.editLane.show',
            {
              defaultValue: m.inlineKeyframesOpen ? 'Hide keyframe panel' : 'Show keyframe panel',
            },
          )}
          checked={m.inlineKeyframesOpen}
          onClick={m.toggleEditKeyframePanel}
        />
        <MoreMenuItem
          icon={<Link2 className="w-3.5 h-3.5" />}
          label={
            m.linkedSelectionEnabled
              ? t('timeline.header.disableLinkedSelection')
              : t('timeline.header.enableLinkedSelection')
          }
          hint={hotkeyHint(hotkeys.TOGGLE_LINKED_SELECTION)}
          checked={m.linkedSelectionEnabled}
          onClick={m.toggleLinkedSelection}
        />
        <MoreMenuItem
          icon={<Music className="w-3.5 h-3.5" />}
          label={t('timeline.concise.beatGrid')}
          checked={showBeatGrid}
          onClick={() => setSetting('showBeatGrid', !showBeatGrid)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Compact 32px toolbar for the Concise workspace. Everything the full toolbar
 * offers is still reachable: the rest lives in the More menu with its shortcut
 * hints, and every shortcut keeps working.
 */
const ConciseTimelineHeader = memo(function ConciseTimelineHeader({
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
}: TimelineHeaderProps) {
  const m = useTimelineHeaderModel()
  const { t, btnSize } = m
  const conciseFullHeaders = useConciseTimelineStore((s) => s.conciseFullHeaders)
  const toggleConciseFullHeaders = useConciseTimelineStore((s) => s.toggleConciseFullHeaders)
  const micStatus = useMicRecordingStore((s) => s.status)
  const micError = useMicRecordingStore((s) => s.error)
  const activeClass = 'bg-primary text-primary-foreground hover:bg-primary/90'
  const sep = <Separator orientation="vertical" className="mx-1 h-4" />
  const conciseHeight = 32
  const tracksLabel = conciseFullHeaders
    ? t('timeline.concise.compactTracks')
    : t('timeline.concise.fullTracks')

  return (
    <div
      className="flex items-center gap-1 border-b border-border px-2"
      style={{ height: conciseHeight }}
      role="toolbar"
      aria-label={t('timeline.header.controls')}
      data-testid="timeline-header-concise"
    >
      <Button
        variant="ghost"
        size="icon"
        style={btnSize}
        className={m.activeTool === 'select' ? activeClass : ''}
        onClick={m.selectTool}
        aria-label={t('timeline.header.selectTool')}
        data-tooltip={t('timeline.header.selectToolTooltip')}
      >
        <MousePointer2 className="w-3.5 h-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        style={btnSize}
        onClick={splitAtPlayhead}
        aria-label={t('timeline.concise.splitAtPlayhead')}
        data-tooltip={t('timeline.concise.splitAtPlayhead')}
      >
        <Scissors className="w-3.5 h-3.5 -rotate-90" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        style={btnSize}
        onClick={deleteSelectionFromStores}
        aria-label={t('timeline.concise.deleteSelected')}
        data-tooltip={t('timeline.concise.deleteSelected')}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>

      <UndoRedoGroup model={m} />

      {sep}

      <ToggleToolButton
        btnSize={btnSize}
        active={m.snapEnabled}
        label={t(
          m.snapEnabled ? 'timeline.header.disableSnapping' : 'timeline.header.enableSnapping',
        )}
        tooltip={t(m.snapEnabled ? 'timeline.header.snapEnabled' : 'timeline.header.snapDisabled')}
        onClick={m.toggleSnap}
      >
        <Magnet className="w-3.5 h-3.5" />
      </ToggleToolButton>

      <ConciseAddMenu />

      <AgentCommentButton btnSize={btnSize} />

      {isMicRecordingSupported() && (micStatus !== 'idle' || micError) ? (
        <MicRecordControl />
      ) : null}

      <div className="min-w-0 flex-1" />

      <TimelineZoomControls
        onZoomChange={onZoomChange}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomToFit={onZoomToFit}
      />

      {sep}

      <Button
        variant="ghost"
        size="icon"
        style={btnSize}
        className={conciseFullHeaders ? activeClass : ''}
        onClick={toggleConciseFullHeaders}
        aria-label={tracksLabel}
        aria-pressed={conciseFullHeaders}
        data-tooltip={tracksLabel}
      >
        <PanelLeft className="w-3.5 h-3.5" />
      </Button>

      <ConciseMoreMenu model={m} />
    </div>
  )
})

/**
 * Timeline toolbar. The Concise workspace gets the compact variant; every other
 * workspace renders the full toolbar unchanged.
 */
export const TimelineHeader = memo(function TimelineHeader(props: TimelineHeaderProps) {
  const isConcise = useEditorStore((s) => isConciseWorkspace(s.workspace))
  return isConcise ? <ConciseTimelineHeader {...props} /> : <FullTimelineHeader {...props} />
})
