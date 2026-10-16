import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { ProjectList } from './project-list'

const clearFilters = vi.fn()
const lists = vi.hoisted(() => ({ all: [] as unknown[], shown: [] as unknown[] }))

const project = (id: string, name: string, extra: Partial<Project> = {}) =>
  ({
    id,
    name,
    createdAt: 1,
    metadata: { width: 1080, height: 1920, fps: 30 },
    ...extra,
  }) as Project

const warehouse = project('main1', 'Warehouse')
const wide = project('wide', 'Warehouse · 16:9', {
  metadata: { width: 1920, height: 1080, fps: 30 },
  cut: { group: 'main1', label: '16:9', order: 1 },
})
const hook = project('hook', 'Warehouse · Hook B', {
  cut: { group: 'main1', label: 'Hook B', order: 2 },
})
const bandon = project('p2', 'Bandon')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values?.count ?? ''}${values?.label ?? ''}`,
  }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children?: ReactNode; params?: { projectId: string } }) => (
    <a href={`/editor/${params?.projectId ?? ''}`}>{children}</a>
  ),
}))
vi.mock('./project-card', () => ({
  ProjectCard: ({ project, footer }: { project: Project; footer?: ReactNode }) => (
    <div data-testid="card">
      <span data-testid="card-name">{project.name}</span>
      {footer}
    </div>
  ),
  cardCanvas: (p: Project) => p.metadata,
}))
vi.mock('../hooks/use-project-selectors', () => ({
  useProjects: () => lists.all,
  useFilteredProjects: () => lists.shown,
}))
vi.mock('../hooks/use-project-actions', () => ({
  useProjectFilters: () => ({ clearFilters }),
  useDeleteProject: () => vi.fn(),
}))

const cardNames = () => screen.getAllByTestId('card-name').map((card) => card.textContent)

describe('ProjectList', () => {
  beforeEach(() => {
    clearFilters.mockReset()
  })

  it('lists every project with no search, filter or sort controls, and drops remembered filters', () => {
    lists.all = lists.shown = [warehouse, bandon]
    render(<ProjectList />)
    expect(cardNames()).toEqual(['Warehouse', 'Bandon'])
    expect(screen.queryByTestId('project-cuts')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(clearFilters).toHaveBeenCalledTimes(1)
  })

  it('shows a group of cuts as one card, its Main, with each cut listed by label and size', () => {
    lists.all = lists.shown = [hook, bandon, wide, warehouse]
    render(<ProjectList />)
    expect(cardNames()).toEqual(['Warehouse', 'Bandon'])
    expect(screen.getByText('projects.list.projectCount2')).toBeInTheDocument()
    const cuts = within(screen.getByTestId('project-cuts'))
    expect(cuts.getByText('cuts.projects.count3')).toBeInTheDocument()
    expect(
      cuts.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Main1080×1920', '/editor/main1'],
      ['16:91920×1080', '/editor/wide'],
      ['Hook B1080×1920', '/editor/hook'],
    ])
  })

  it('keeps search and sort: a group shows where its first match is, with all its cuts', () => {
    lists.all = [warehouse, wide, hook, bandon]
    // Searching "hook" matches one cut only; sorting put Bandon first.
    lists.shown = [bandon, hook]
    render(<ProjectList />)
    expect(cardNames()).toEqual(['Bandon', 'Warehouse'])
    expect(within(screen.getByTestId('project-cuts')).getAllByRole('link')).toHaveLength(3)
  })

  it('counts groups, not projects, when a search hides some', () => {
    lists.all = [warehouse, wide, hook, bandon]
    lists.shown = [wide]
    render(<ProjectList />)
    expect(cardNames()).toEqual(['Warehouse'])
    expect(screen.getByText('projects.list.projectCountFiltered')).toBeInTheDocument()
  })

  it('shows the first cut while the Main is in the Trash', () => {
    lists.all = lists.shown = [wide, hook]
    render(<ProjectList />)
    expect(cardNames()).toEqual(['Warehouse · 16:9'])
    expect(within(screen.getByTestId('project-cuts')).getAllByRole('link')).toHaveLength(2)
  })
})
