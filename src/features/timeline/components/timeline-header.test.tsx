import { act, fireEvent, render, screen } from '@testing-library/react'
import { usePlaybackStore } from '@/shared/state/playback'
import type { FocusEventHandler, KeyboardEventHandler, PointerEventHandler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { ZOOM_MAX, ZOOM_MIN } from '../constants'
import { useZoomStore } from '../stores/zoom-store'
import { useSelectionStore } from '@/shared/state/selection'
import { useEditorStore } from '@/shared/state/editor'
import { useTimelineStore } from '../stores/timeline-store'
import { useConciseTimelineStore } from '../stores/concise-timeline-store'
import { TimelineHeader } from './timeline-header'

// Existing suites assume a non-concise workspace (the default is concise).
useEditorStore.setState({ workspace: 'edit' })

const { micRenderSpy, sliderRenderSpy, sliderInput } = vi.hoisted(() => ({
  micRenderSpy: vi.fn(),
  sliderRenderSpy: vi.fn(),
  sliderInput: { value: 0.75 },
}))

vi.mock('@/components/ui/slider', async () => {
  const { forwardRef } = await vi.importActual<typeof import('react')>('react')

  return {
    Slider: forwardRef<
      HTMLSpanElement,
      {
        value?: number[]
        onValueChange?: (value: number[]) => void
        onValueCommit?: (value: number[]) => void
        onPointerDownCapture?: PointerEventHandler<HTMLSpanElement>
        onPointerCancelCapture?: PointerEventHandler<HTMLSpanElement>
        onKeyDownCapture?: KeyboardEventHandler<HTMLSpanElement>
        onKeyUpCapture?: KeyboardEventHandler<HTMLSpanElement>
        onBlurCapture?: FocusEventHandler<HTMLSpanElement>
      }
    >(function MockSlider(
      {
        value,
        onValueChange,
        onValueCommit,
        onPointerDownCapture,
        onPointerCancelCapture,
        onKeyDownCapture,
        onKeyUpCapture,
        onBlurCapture,
      },
      ref,
    ) {
      sliderRenderSpy()
      const keyboardValue = Math.min(1, (value?.[0] ?? 0) + 0.005)
      return (
        <span
          ref={ref}
          data-testid="zoom-slider"
          data-value={value?.[0]}
          onPointerDownCapture={onPointerDownCapture}
          onPointerCancelCapture={onPointerCancelCapture}
          onKeyDownCapture={onKeyDownCapture}
          onKeyUpCapture={onKeyUpCapture}
          onBlurCapture={onBlurCapture}
        >
          <span>
            <span data-testid="zoom-slider-range" />
          </span>
          <span data-testid="zoom-slider-thumb-positioner">
            <button
              type="button"
              role="slider"
              aria-valuenow={value?.[0]}
              onMouseDown={() => onValueChange?.([sliderInput.value])}
              onMouseUp={() => onValueCommit?.([sliderInput.value])}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  onValueChange?.([keyboardValue])
                }
              }}
              onKeyUp={() => onValueCommit?.([value?.[0] ?? 0])}
            />
          </span>
        </span>
      )
    }),
  }
})

vi.mock('./mic-record-control', () => ({
  MicRecordControl: () => {
    micRenderSpy()
    return null
  },
}))

const { splitSpy } = vi.hoisted(() => ({ splitSpy: vi.fn() }))

vi.mock('../stores/actions/item-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stores/actions/item-actions')>()),
  splitAllItemsAtFrame: splitSpy,
}))

describe('TimelineHeader zoom slider', () => {
  beforeEach(() => {
    micRenderSpy.mockClear()
    sliderRenderSpy.mockClear()
    sliderInput.value = 0.75
    useZoomStore.getState().setZoomLevelSynchronized(1)
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedItemIdSet: new Set<string>(),
      editKeyframePanelOpen: false,
      expandedKeyframeLanes: new Set<string>(),
    })
  })

  it('previews pointer input immediately and commits without slider-only momentum', () => {
    const animationFrameSpy = vi.spyOn(window, 'requestAnimationFrame')
    const onZoomChange = vi.fn()
    const targetZoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, 0.75)

    render(<TimelineHeader onZoomChange={onZoomChange} />)
    expect(micRenderSpy).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(screen.getByRole('slider'))

    expect(screen.getByTestId('zoom-slider-thumb-positioner').style.left).toBe('calc(75% - 4px)')
    expect(screen.getByTestId('zoom-slider-range').style.right).toBe('25%')
    expect(onZoomChange).toHaveBeenLastCalledWith(targetZoom)
    expect(animationFrameSpy).not.toHaveBeenCalled()
    expect(micRenderSpy).toHaveBeenCalledTimes(1)
    expect(useZoomStore.getState().level).toBe(1)

    fireEvent.mouseUp(screen.getByRole('slider'))

    expect(onZoomChange).toHaveBeenCalledTimes(1)
    expect(onZoomChange).toHaveBeenLastCalledWith(targetZoom)
    expect(animationFrameSpy).not.toHaveBeenCalled()

    act(() => useZoomStore.getState().setZoomLevelImmediate(targetZoom))
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0.75')
    expect(micRenderSpy).toHaveBeenCalledTimes(1)

    animationFrameSpy.mockRestore()
  })

  it('releases a max-zoom preview when a later zoom supersedes its queued target', () => {
    sliderInput.value = 1
    const onZoomChange = vi.fn()

    render(<TimelineHeader onZoomChange={onZoomChange} />)
    const slider = screen.getByTestId('zoom-slider')

    fireEvent.mouseDown(screen.getByRole('slider'))
    fireEvent.mouseUp(screen.getByRole('slider'))
    expect(onZoomChange).toHaveBeenLastCalledWith(ZOOM_MAX)

    act(() => useZoomStore.getState().setZoomLevelSynchronized(ZOOM_MIN))

    expect(Number(slider.dataset.value)).toBeCloseTo(0)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0')
  })

  it('keeps wheel-frequency zoom updates outside the Radix slider render path', () => {
    vi.useFakeTimers()
    try {
      render(<TimelineHeader />)
      const slider = screen.getByTestId('zoom-slider')
      const initialControlledValue = Number(slider.dataset.value)
      const firstZoom = 0.1
      const finalZoom = 2
      const firstSliderValue = Math.log(firstZoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)
      const finalSliderValue = Math.log(finalZoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)

      expect(sliderRenderSpy).toHaveBeenCalledTimes(1)

      act(() => useZoomStore.getState().setZoomLevelImmediate(firstZoom))
      expect(sliderRenderSpy).toHaveBeenCalledTimes(1)
      expect(Number(screen.getByRole('slider').getAttribute('aria-valuenow'))).toBeCloseTo(
        firstSliderValue,
      )
      expect(Number(slider.dataset.value)).toBeCloseTo(initialControlledValue)

      act(() => useZoomStore.getState().setZoomLevelImmediate(finalZoom))
      expect(sliderRenderSpy).toHaveBeenCalledTimes(1)
      expect(Number(screen.getByRole('slider').getAttribute('aria-valuenow'))).toBeCloseTo(
        finalSliderValue,
      )
      expect(parseFloat(screen.getByTestId('zoom-slider-range').style.right)).toBeCloseTo(
        100 - finalSliderValue * 100,
      )

      act(() => vi.advanceTimersByTime(200))

      expect(sliderRenderSpy).toHaveBeenCalledTimes(2)
      expect(Number(slider.dataset.value)).toBeCloseTo(finalSliderValue)
      expect(Number(screen.getByRole('slider').getAttribute('aria-valuenow'))).toBeCloseTo(
        finalSliderValue,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not settle or contract content while the slider thumb is held', () => {
    vi.useFakeTimers()
    try {
      sliderInput.value = 0.9
      const targetZoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, sliderInput.value)
      render(<TimelineHeader />)
      const thumb = screen.getByRole('slider')

      fireEvent.pointerDown(thumb)
      fireEvent.mouseDown(thumb)
      act(() => vi.advanceTimersByTime(1_000))

      expect(useZoomStore.getState()).toMatchObject({
        level: targetZoom,
        contentLevel: 1,
        isZoomInteracting: true,
      })

      fireEvent.mouseUp(thumb)
      expect(useZoomStore.getState()).toMatchObject({
        contentLevel: targetZoom,
        isZoomInteracting: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases slider zoom when pointer-up lands outside the control', () => {
    vi.useFakeTimers()
    try {
      sliderInput.value = 0.85
      const targetZoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, sliderInput.value)
      render(<TimelineHeader />)

      fireEvent.pointerDown(screen.getByRole('slider'))
      fireEvent.mouseDown(screen.getByRole('slider'))
      act(() => vi.advanceTimersByTime(1_000))
      expect(useZoomStore.getState()).toMatchObject({
        level: targetZoom,
        contentLevel: 1,
        isZoomInteracting: true,
      })

      fireEvent.pointerUp(window)

      expect(useZoomStore.getState()).toMatchObject({
        contentLevel: targetZoom,
        isZoomInteracting: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases slider focus after an outside pointer release', async () => {
    render(<TimelineHeader />)
    const thumb = screen.getByRole('slider')

    thumb.focus()
    expect(thumb).toHaveFocus()

    fireEvent.pointerDown(thumb)
    fireEvent.pointerUp(window)
    await act(async () => {})

    expect(thumb).not.toHaveFocus()
  })

  it('releases slider focus after a normal value commit', async () => {
    render(<TimelineHeader />)
    const thumb = screen.getByRole('slider')

    thumb.focus()
    expect(thumb).toHaveFocus()

    fireEvent.pointerDown(thumb)
    fireEvent.mouseDown(thumb)
    fireEvent.mouseUp(thumb)
    await act(async () => {})

    expect(thumb).not.toHaveFocus()
  })

  it('synchronizes repeated keyboard steps without discarding slider focus', async () => {
    const onZoomChange = vi.fn()
    render(<TimelineHeader onZoomChange={onZoomChange} />)
    const slider = screen.getByTestId('zoom-slider')
    const thumb = screen.getByRole('slider')
    const initialValue = Number(slider.dataset.value)

    thumb.focus()

    fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    expect(Number(slider.dataset.value)).toBeCloseTo(initialValue + 0.005)
    expect(onZoomChange).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    expect(Number(slider.dataset.value)).toBeCloseTo(initialValue + 0.01)
    expect(sliderRenderSpy).toHaveBeenCalledTimes(3)
    expect(onZoomChange).toHaveBeenCalledTimes(2)
    expect(useZoomStore.getState().level).toBe(1)

    fireEvent.keyUp(thumb, { key: 'ArrowRight' })
    await act(async () => {})
    expect(onZoomChange).toHaveBeenCalledTimes(2)
    expect(thumb).toHaveFocus()

    fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    expect(Number(slider.dataset.value)).toBeCloseTo(initialValue + 0.015)
    expect(onZoomChange).toHaveBeenCalledTimes(3)
  })

  it('toggles the keyframe panel without a selected clip', () => {
    render(<TimelineHeader />)

    const toggle = screen.getByRole('button', { name: 'Show keyframe panel' })
    expect(toggle).toBeEnabled()

    fireEvent.click(toggle)

    expect(useSelectionStore.getState().editKeyframePanelOpen).toBe(true)
    expect(useSelectionStore.getState().expandedKeyframeLanes.size).toBe(0)
    expect(screen.getByRole('button', { name: 'Hide keyframe panel' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

/** Radix dropdown triggers open on pointerdown rather than click. */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
}

describe('TimelineHeader concise workspace', () => {
  beforeEach(() => {
    splitSpy.mockClear()
    useEditorStore.setState({ workspace: 'concise' })
    useConciseTimelineStore.setState({ conciseFullHeaders: false })
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedItemIdSet: new Set<string>(),
      activeTool: 'select',
      editKeyframePanelOpen: false,
      expandedKeyframeLanes: new Set<string>(),
    })
  })

  afterEach(() => {
    useEditorStore.setState({ workspace: 'edit' })
  })

  it('renders the compact 32px toolbar and moves the other tools into More', () => {
    render(<TimelineHeader />)

    const toolbar = screen.getByTestId('timeline-header-concise')
    expect(toolbar.style.height).toBe('32px')
    expect(screen.getByRole('button', { name: 'Select Tool' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Split at playhead' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disable Snapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Razor Tool' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set In Point' })).not.toBeInTheDocument()
  })

  it('splits at the gray playhead through the shared split action', () => {
    usePlaybackStore.setState({ currentFrame: 40, previewFrame: 25 })
    render(<TimelineHeader />)

    fireEvent.click(screen.getByRole('button', { name: 'Split at playhead' }))

    expect(splitSpy).toHaveBeenCalledWith(25)
    usePlaybackStore.setState({ previewFrame: null })
  })

  it('opens the sidebar tab from the Add menu', async () => {
    useEditorStore.setState({ activeTab: 'media', leftSidebarOpen: false })
    render(<TimelineHeader />)

    openMenu(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Transitions' }))

    expect(useEditorStore.getState().activeTab).toBe('transitions')
    expect(useEditorStore.getState().leftSidebarOpen).toBe(true)
  })

  it('runs the same tool handlers from the More menu', async () => {
    render(<TimelineHeader />)

    openMenu(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Razor Tool/ }))

    expect(useSelectionStore.getState().activeTool).toBe('razor')
  })

  it('adds a marker at the playhead from the More menu', async () => {
    usePlaybackStore.setState({ currentFrame: 12 })
    const addMarker = vi.spyOn(useTimelineStore.getState(), 'addMarker')
    render(<TimelineHeader />)

    openMenu(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Add Marker/ }))

    expect(addMarker).toHaveBeenCalledWith(12)
    addMarker.mockRestore()
  })

  it('toggles full track headers and persists the choice', () => {
    render(<TimelineHeader />)

    fireEvent.click(screen.getByRole('button', { name: 'Full track headers' }))

    expect(useConciseTimelineStore.getState().conciseFullHeaders).toBe(true)
    expect(localStorage.getItem('timeline:conciseFullHeaders')).toBe('true')
    expect(screen.getByRole('button', { name: 'Compact track labels' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('keeps the full toolbar outside the concise workspace', () => {
    useEditorStore.setState({ workspace: 'edit' })
    render(<TimelineHeader />)

    expect(screen.queryByTestId('timeline-header-concise')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Razor Tool' })).toBeInTheDocument()
  })
})
