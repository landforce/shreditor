import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const bridge = vi.hoisted(() => ({
  readProjectKit: vi.fn(),
  setProjectKitValues: vi.fn(async () => {}),
  saveOpenEditorNow: vi.fn(async () => true),
}))
vi.mock('@/infrastructure/storage/bridge-fs/bridge-agent-commands', () => bridge)

const { useProjectStore } = await import('@/features/editor/deps/projects')
const { StyleTab } = await import('./style-tab')

const kit = {
  creator: 'Landforce',
  kitVersion: '0.5.0',
  fonts: { main: { stack: ['TikTok Sans', 'Arial'] } },
  titles: { style: { font: 'main', weight: 700, size: 88, color: '#000000' } },
  preferences: { punchIns: { on: true } },
}
const record = { path: '/kits/kit.json', kitVersion: '0.5.0', hash: 'sha256:x' }

describe('StyleTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ currentProject: { id: 'p1' } } as never)
  })

  it('saves the changed values through kit set and reloads the kit', async () => {
    bridge.readProjectKit.mockResolvedValue({ record, path: record.path, kit, drift: false })
    render(<StyleTab />)
    expect(await screen.findByText('Landforce')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Save to kit' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Main'), { target: { value: 'Neue Haas' } })
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '600' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(bridge.setProjectKitValues).toHaveBeenCalledWith('p1', {
        'fonts.main.stack.0': 'Neue Haas',
        'titles.style.weight': '600',
      }),
    )
    expect(bridge.saveOpenEditorNow).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(bridge.readProjectKit).toHaveBeenCalledTimes(2))
  })

  it('locks editing when the kit file drifted since apply', async () => {
    bridge.readProjectKit.mockResolvedValue({ record, path: record.path, kit, drift: true })
    render(<StyleTab />)
    expect(await screen.findByText(/changed since this project applied it/)).toBeInTheDocument()
    expect(screen.getByLabelText('Weight')).toBeDisabled()
  })

  it('says how to get a kit when the project has none', async () => {
    bridge.readProjectKit.mockResolvedValue({ record: null })
    render(<StyleTab />)
    expect(await screen.findByText(/has no Video Style Kit/)).toBeInTheDocument()
  })

  it('shows a refused set', async () => {
    bridge.readProjectKit.mockResolvedValue({ record, path: record.path, kit, drift: false })
    bridge.setProjectKitValues.mockRejectedValueOnce(new Error('titles.style.size is a number'))
    render(<StyleTab />)
    fireEvent.change(await screen.findByLabelText('Main'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to kit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('is a number')
  })
})
