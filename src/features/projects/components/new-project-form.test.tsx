import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'

const storage = vi.hoisted(() => ({
  createProject: vi.fn(async (project: unknown) => project),
}))

vi.mock('@/infrastructure/storage', () => storage)

vi.mock('@/features/projects/deps/media-library-contract', () => ({
  importMediaLibraryService: vi.fn(),
}))

vi.mock('@/features/projects/deps/settings-contract', () => ({
  useSettingsStore: { getState: () => ({ maxUndoHistory: 100 }), subscribe: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/projects">{children}</a>,
}))

const { NewProjectForm } = await import('./new-project-form')
const { useProjectStore } = await import('../stores/project-store')

function renderForm() {
  const onCreated = vi.fn<(project: Project) => void>()
  render(<NewProjectForm onCreated={onCreated} />)
  return onCreated
}

const createButton = () => screen.getByRole('button', { name: 'Create Project' })

async function submitNamed(name: string) {
  // Let the canvas the format sets validate first, as it does between a click and typing.
  await act(async () => {})
  fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: name } })
  await waitFor(() => expect(createButton()).toBeEnabled())
  fireEvent.click(createButton())
}

describe('NewProjectForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ projects: [], currentProject: null })
  })

  it('leads with the four formats and waits for a choice', () => {
    renderForm()
    expect(screen.getByRole('heading', { name: 'Choose a format' })).toBeInTheDocument()
    for (const id of ['graphic-yap', 'greenscreen', 'vlog', 'ten-shot']) {
      expect(screen.getByTestId(`format-card-${id}`)).toBeInTheDocument()
    }
    expect(screen.getByText('Choose a format above, or No format.')).toBeInTheDocument()
    expect(createButton()).toBeDisabled()
  })

  it('creates a project defined by the chosen format: canvas, tracks with roles and format', async () => {
    const onCreated = renderForm()
    const card = screen.getByTestId('format-card-graphic-yap')
    fireEvent.click(within(card).getByRole('button', { name: /Graphic Yap/ }))
    // The default variant is preselected; pick the other one.
    expect(within(card).getByRole('radio', { name: 'Standard' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(within(card).getByRole('radio', { name: 'Intense' }))
    expect(screen.getByText('Canvas from Graphic Yap')).toBeInTheDocument()

    await submitNamed('Gear video')

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    const stored = storage.createProject.mock.calls[0]![0] as Project
    expect(stored.metadata).toMatchObject({ width: 1080, height: 1920, fps: 30 })
    expect(stored.format).toMatchObject({ id: 'graphic-yap', variant: 'intense' })
    expect(stored.format?.reviewedHash).toMatch(/^sha256:/)
    expect(stored.timeline?.tracks.map((track) => [track.name, track.formatRole])).toEqual([
      ['Title', 'title'],
      ['Captions', 'captions'],
      ['Images', 'images'],
      ['Speaker', 'speaker'],
      ['Speaker audio', 'speaker'],
      ['Music', 'music'],
    ])
    expect(onCreated.mock.calls[0]![0].id).toBe(stored.id)
  })

  it('keeps today’s flow with No format: no format, no preset tracks', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /No format/ }))
    expect(screen.getByText('Resolution')).toBeVisible()

    await submitNamed('Plain')

    await waitFor(() => expect(storage.createProject).toHaveBeenCalled())
    const stored = storage.createProject.mock.calls[0]![0] as Project
    expect(stored.format).toBeUndefined()
    expect(stored.timeline).toBeUndefined()
  })
})
