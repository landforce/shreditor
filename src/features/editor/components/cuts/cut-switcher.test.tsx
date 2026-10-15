import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CutGroup } from '@/infrastructure/storage'

const storage = vi.hoisted(() => ({
  listCutGroup: vi.fn(async (): Promise<CutGroup | null> => null),
  readCutPassCounts: vi.fn(async (): Promise<Record<string, number>> => ({})),
}))
const navigate = vi.hoisted(() => vi.fn())

vi.mock('@/infrastructure/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infrastructure/storage')>()),
  ...storage,
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

const { CutSwitcher } = await import('./cut-switcher')
const { useCutsStore } = await import('@/shared/state/cuts')
const { useTimelineStore } = await import('@/features/editor/deps/timeline-store')

const cut = (id: string, label: string, extra: Partial<CutGroup['cuts'][number]> = {}) => ({
  id,
  name: `Warehouse · ${label}`,
  label,
  main: false,
  order: 1,
  width: 1080,
  height: 1920,
  aspect: '9:16',
  lastPass: null,
  ...extra,
})

const group: CutGroup = {
  groupId: 'main',
  groupName: 'Warehouse',
  cuts: [
    cut('main', 'Main', {
      main: true,
      order: 0,
      lastPass: { n: 3, label: 'Pass 3', createdAt: null, summary: { pass: 9, warn: 1, fail: 0 } },
    }),
    cut('wide', '16:9', {
      width: 1920,
      height: 1080,
      aspect: '16:9',
      lastPass: { n: 1, label: 'New cut', createdAt: null, summary: { pass: 4, warn: 0, fail: 2 } },
    }),
    cut('hook', 'Hook B', { order: 2 }),
  ],
}

const renderSwitcher = (projectId = 'main') =>
  render(
    <CutSwitcher
      projectId={projectId}
      canvas={{ width: 1080, height: 1920 }}
      onSave={async () => undefined}
    />,
  )

const openMenu = () => {
  const trigger = screen.getByTestId('cut-switcher')
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
}

describe('CutSwitcher', () => {
  beforeEach(() => {
    navigate.mockReset()
    storage.listCutGroup.mockReset()
    storage.readCutPassCounts.mockReset()
    storage.readCutPassCounts.mockResolvedValue({})
    useCutsStore.setState({ projectId: null, group: null, seenPasses: {}, fresh: [] })
    useTimelineStore.setState({ isDirty: false })
  })

  it('stays quiet with one cut: a small "+ Cut" and no menu', async () => {
    storage.listCutGroup.mockResolvedValue({
      groupId: 'main',
      groupName: 'Warehouse',
      cuts: [cut('main', 'Main', { main: true, order: 0 })],
    })
    renderSwitcher()
    await waitFor(() => expect(storage.listCutGroup).toHaveBeenCalledWith('main'))
    expect(screen.getByTestId('cut-add')).toHaveTextContent('Cut')
    expect(screen.queryByTestId('cut-switcher')).toBeNull()
    fireEvent.click(screen.getByTestId('cut-add'))
    expect(await screen.findByText('New cut')).toBeInTheDocument()
  })

  it('shows the current cut and lists every cut with size and scorecard dot', async () => {
    storage.listCutGroup.mockResolvedValue(group)
    renderSwitcher('wide')
    expect(await screen.findByTestId('cut-switcher')).toHaveTextContent('16:9')
    openMenu()
    const options = await screen.findAllByTestId('cut-option')
    expect(options.map((o) => o.textContent)).toEqual([
      'Main1080×1920',
      '16:91920×1080',
      'Hook B1080×1920',
    ])
    expect(screen.getByTestId('cut-score-warn')).toBeInTheDocument()
    expect(screen.getByTestId('cut-score-fail')).toBeInTheDocument()
    expect(screen.getByText('New cut…')).toBeInTheDocument()
    expect(screen.getByText('Manage cuts…')).toBeInTheDocument()
  })

  it('switches cuts in the same tab, asking first when there are unsaved edits', async () => {
    storage.listCutGroup.mockResolvedValue(group)
    renderSwitcher('main')
    await screen.findByTestId('cut-switcher')
    openMenu()
    fireEvent.click((await screen.findAllByTestId('cut-option'))[2]!)
    expect(navigate).toHaveBeenCalledWith({
      to: '/editor/$projectId',
      params: { projectId: 'hook' },
    })

    navigate.mockReset()
    useTimelineStore.setState({ isDirty: true })
    openMenu()
    fireEvent.click((await screen.findAllByTestId('cut-option'))[1]!)
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /discard/i }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/editor/$projectId',
      params: { projectId: 'wide' },
    })
  })

  it('marks a cut the agent published to while the user was elsewhere', async () => {
    storage.listCutGroup.mockResolvedValue(group)
    renderSwitcher('main')
    await screen.findByTestId('cut-switcher')
    expect(screen.queryByTestId('cut-fresh')).toBeNull()
    storage.readCutPassCounts.mockResolvedValue({ wide: 2, hook: 0 })
    await act(() => useCutsStore.getState().poll())
    expect(screen.getByTestId('cut-fresh')).toBeInTheDocument()
    openMenu()
    expect(await screen.findByText('new pass')).toBeInTheDocument()
  })
})
