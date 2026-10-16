import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CutGroup } from '@/infrastructure/storage'

const storage = vi.hoisted(() => ({
  listCutGroup: vi.fn(async (): Promise<CutGroup | null> => null),
  readCutPassCounts: vi.fn(async (): Promise<Record<string, number>> => ({})),
  updateProject: vi.fn(async () => ({})),
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
const { useCutsStore, receiveCutPublish, siblingCutIds } = await import('@/shared/state/cuts')
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
    storage.updateProject.mockReset()
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

  it('follows a publish into another cut: switches there, the new-pass mark stays', async () => {
    storage.listCutGroup.mockResolvedValue(group)
    renderSwitcher('main')
    await screen.findByTestId('cut-switcher')
    expect(siblingCutIds()).toEqual(['wide', 'hook'])
    // Old news (before the editor loaded) and the open cut's own publish are ignored.
    act(() =>
      receiveCutPublish({ projectId: 'hook', label: 'Old', endedAt: '2020-01-01T00:00:00Z' }),
    )
    act(() => receiveCutPublish({ projectId: 'main', label: 'Mine', endedAt: future(1) }))
    act(() => receiveCutPublish({ projectId: 'elsewhere', label: 'X', endedAt: future(1) }))
    expect(navigate).not.toHaveBeenCalled()

    const publish = { projectId: 'hook', label: 'New opening', endedAt: future(2) }
    act(() => receiveCutPublish(publish))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/editor/$projectId',
        params: { projectId: 'hook' },
      }),
    )
    expect(useCutsStore.getState().follow).toBeNull()
    // The same publish heard again on the next heartbeat is not followed twice.
    navigate.mockReset()
    act(() => receiveCutPublish({ ...publish }))
    expect(navigate).not.toHaveBeenCalled()
    storage.readCutPassCounts.mockResolvedValue({ wide: 1, hook: 1 })
    await act(() => useCutsStore.getState().poll())
    expect(screen.getByTestId('cut-fresh')).toBeInTheDocument()
  })

  it('follows a publish only through the unsaved-changes dialog when there are edits', async () => {
    storage.listCutGroup.mockResolvedValue(group)
    renderSwitcher('main')
    await screen.findByTestId('cut-switcher')
    useTimelineStore.setState({ isDirty: true })
    act(() => receiveCutPublish({ projectId: 'wide', label: 'Landscape', endedAt: future(3) }))
    expect(await screen.findByRole('button', { name: /discard/i })).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /discard/i })).toBeNull())
    expect(navigate).not.toHaveBeenCalled()
  })

  it('makes another cut Main from Manage cuts: only it and the old Main change', async () => {
    storage.listCutGroup.mockResolvedValue(group)
    renderSwitcher('main')
    await screen.findByTestId('cut-switcher')
    openMenu()
    fireEvent.click(await screen.findByText('Manage cuts…'))
    expect(await screen.findByTestId('cut-is-main')).toBeDisabled()
    const makeMain = screen.getAllByTestId('cut-make-main')
    expect(makeMain).toHaveLength(2)
    fireEvent.click(makeMain[1]!)
    await waitFor(() => expect(storage.updateProject).toHaveBeenCalledTimes(2))
    expect(storage.updateProject.mock.calls).toEqual([
      [
        'hook',
        { cut: { group: 'main', label: 'Hook B', order: 0, main: true }, name: 'Warehouse' },
      ],
      [
        'main',
        { cut: { group: 'main', label: 'Main', order: 2, main: false }, name: 'Warehouse · Main' },
      ],
    ])
  })

  it('keeps the Main flag when a promoted Main is renamed or moved', async () => {
    const promoted: CutGroup = {
      ...group,
      cuts: [
        cut('hook', 'Hook B', { main: true, order: 0 }),
        cut('main', 'Main', { order: 1 }),
        cut('wide', '16:9', { order: 2 }),
      ],
    }
    storage.listCutGroup.mockResolvedValue(promoted)
    renderSwitcher('hook')
    await screen.findByTestId('cut-switcher')
    openMenu()
    fireEvent.click(await screen.findByText('Manage cuts…'))
    const label = await screen.findByLabelText('Label of Hook B')
    fireEvent.change(label, { target: { value: 'Hook C' } })
    fireEvent.blur(label)
    await waitFor(() => expect(storage.updateProject).toHaveBeenCalledTimes(1))
    expect(storage.updateProject).toHaveBeenCalledWith('hook', {
      cut: { group: 'main', label: 'Hook C', order: 0, main: true },
    })
    storage.updateProject.mockClear()
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[1]!)
    await waitFor(() => expect(storage.updateProject).toHaveBeenCalledTimes(2))
    expect(storage.updateProject.mock.calls[0]).toEqual([
      'main',
      { cut: { group: 'main', label: 'Main', order: 2, main: false } },
    ])
  })
})

/** An ISO time `seconds` after now. */
function future(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}
