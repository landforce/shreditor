import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextItem } from '@/types/timeline'
import type { CoordinateParams, Transform } from '../types/gizmo'

const updateItem = vi.fn()
const executeTimelineCommand = vi.fn(
  (_type: string, action: () => unknown, _payload?: Record<string, unknown>) => action(),
)

vi.mock('@/features/preview/deps/timeline-store', () => ({
  useTimelineStore: (selector: (s: { updateItem: typeof updateItem }) => unknown) =>
    selector({ updateItem }),
  executeTimelineCommand: (
    type: string,
    action: () => unknown,
    payload?: Record<string, unknown>,
  ) => executeTimelineCommand(type, action, payload),
}))
vi.mock('@/shared/typography/font-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/typography/font-loader')>()),
  loadFont: (name: string) => name,
}))

import { TextInlineEditor } from './text-inline-editor'

const ITEM = {
  id: 'text-1',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 30,
  label: 'Hello',
  text: 'Hello',
  fontSize: 80,
  fontFamily: 'Inter',
  color: '#ffffff',
  textAlign: 'center',
} as TextItem

const TRANSFORM: Transform = {
  x: 0,
  y: 0,
  width: 960,
  height: 200,
  rotation: 0,
  opacity: 1,
}

// Player is half the project size, so the preview scale is 0.5.
const COORD: CoordinateParams = {
  containerRect: new DOMRect(0, 0, 960, 540),
  playerSize: { width: 960, height: 540 },
  projectSize: { width: 1920, height: 1080 },
  zoom: -1,
}

describe('TextInlineEditor', () => {
  beforeEach(() => {
    updateItem.mockClear()
    executeTimelineCommand.mockClear()
  })

  it('mounts over the item bounds with the font scaled to the preview', () => {
    render(
      <TextInlineEditor item={ITEM} transform={TRANSFORM} coordParams={COORD} onExit={vi.fn()} />,
    )
    const box = screen.getByTestId('text-inline-editor')
    expect(box.style.width).toBe('480px')
    expect(box.style.height).toBe('100px')
    expect(box.style.left).toBe('240px')
    expect(box.style.top).toBe('220px')
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('Hello')
    expect(textarea.style.fontSize).toBe('40px')
    expect(document.activeElement).toBe(textarea)
  })

  it('writes each keystroke through one coalesced session', () => {
    render(
      <TextInlineEditor item={ITEM} transform={TRANSFORM} coordParams={COORD} onExit={vi.fn()} />,
    )
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Hello w' } })
    fireEvent.change(textarea, { target: { value: 'Hello wo' } })
    expect(updateItem).toHaveBeenLastCalledWith(
      'text-1',
      expect.objectContaining({ text: 'Hello wo' }),
    )
    const keys = executeTimelineCommand.mock.calls.map((call) => call[2]?.coalesce)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[0]).toBe(keys[1])
  })

  it('restores the original text and exits on Escape', () => {
    const onExit = vi.fn()
    render(
      <TextInlineEditor item={ITEM} transform={TRANSFORM} coordParams={COORD} onExit={onExit} />,
    )
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Changed' } })
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(updateItem).toHaveBeenLastCalledWith(
      'text-1',
      expect.objectContaining({ text: 'Hello' }),
    )
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('keeps the edit and exits on blur', () => {
    const onExit = vi.fn()
    render(
      <TextInlineEditor item={ITEM} transform={TRANSFORM} coordParams={COORD} onExit={onExit} />,
    )
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Kept' } })
    act(() => {
      fireEvent.blur(textarea)
    })
    expect(updateItem).toHaveBeenLastCalledWith('text-1', expect.objectContaining({ text: 'Kept' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
