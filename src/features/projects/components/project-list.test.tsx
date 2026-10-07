import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { ProjectList } from './project-list'

const clearFilters = vi.fn()
const projects = [
  { id: 'p1', name: 'Warehouse', metadata: { width: 1080, height: 1920, fps: 30 } },
  { id: 'p2', name: 'Bandon', metadata: { width: 1080, height: 1920, fps: 30 } },
] as unknown as Project[]

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key}${values?.count ?? ''}`,
  }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: unknown }) => children,
}))
vi.mock('./project-card', () => ({
  ProjectCard: ({ project }: { project: Project }) => <div data-testid="card">{project.name}</div>,
}))
vi.mock('../hooks/use-project-selectors', () => ({
  useProjects: () => projects,
  useFilteredProjects: () => projects,
}))
vi.mock('../hooks/use-project-actions', () => ({
  useProjectFilters: () => ({ clearFilters }),
  useDeleteProject: () => vi.fn(),
}))

describe('ProjectList', () => {
  it('lists every project with no search, filter or sort controls, and drops remembered filters', () => {
    render(<ProjectList />)
    expect(screen.getAllByTestId('card').map((card) => card.textContent)).toEqual([
      'Warehouse',
      'Bandon',
    ])
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(clearFilters).toHaveBeenCalledTimes(1)
  })
})
