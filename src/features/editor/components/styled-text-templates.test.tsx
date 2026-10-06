import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { TextStyleDefinition } from '@/types/text-style'
import { useProjectTextStylesStore } from '@/shared/state/text-styles'
import { StyledTextTemplates } from './styled-text-templates'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const style: TextStyleDefinition = {
  id: 'kit-title',
  name: 'Kit title',
  role: 'title',
  variants: [{ aspect: '9:16', style: { fontSize: 120, color: '#ffffff' } }],
  version: 1,
  updatedAt: 1,
}

describe('StyledTextTemplates', () => {
  it('starts a drag only when a tile is dragged, never while rendering', () => {
    useProjectTextStylesStore.getState().setStyles([style])
    const onDragStart = vi.fn(() => vi.fn())
    render(
      <StyledTextTemplates
        canvas={{ width: 1080, height: 1920 }}
        onAdd={vi.fn()}
        onDragStart={onDragStart}
      />,
    )
    expect(onDragStart).not.toHaveBeenCalled()
    fireEvent.dragStart(screen.getByText('Kit title').closest('button')!)
    expect(onDragStart).toHaveBeenCalledWith(style)
    useProjectTextStylesStore.getState().setStyles([])
  })
})
