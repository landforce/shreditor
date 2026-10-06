import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { ProjectCard, cardCanvas } from './project-card'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ children }: { children?: unknown }) => children,
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: unknown }) => children,
}))
vi.mock('../hooks/use-project-actions', () => ({
  useDeleteProject: () => vi.fn(),
  useRestoreProject: () => vi.fn(),
  useDuplicateProject: () => vi.fn(),
}))
vi.mock('../hooks/use-project-thumbnail', () => ({ useProjectThumbnail: () => 'blob:cover' }))

const project = (width: number, height: number): Project =>
  ({
    id: 'p1',
    name: 'Warehouse',
    description: '',
    createdAt: 1,
    updatedAt: 2,
    duration: 0,
    metadata: { width, height, fps: 30 },
  }) as Project

describe('ProjectCard', () => {
  it('shapes the cover like the project and labels its aspect ratio', () => {
    const { container } = render(<ProjectCard project={project(1080, 1920)} />)
    const cover = container.querySelector('img')!.parentElement!
    expect(cover.style.aspectRatio).toBe('1080 / 1920')
    expect(screen.getByText('9:16')).toBeTruthy()
    expect(screen.getByText('1080×1920')).toBeTruthy()
  })

  it('falls back to the default canvas for projects without a size', () => {
    expect(cardCanvas({ ...project(0, 0), metadata: undefined } as unknown as Project)).toEqual(
      cardCanvas(project(0, 0)),
    )
  })
})
