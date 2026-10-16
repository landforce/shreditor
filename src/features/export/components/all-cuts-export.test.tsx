import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { useCutsStore } from '@/shared/state/cuts'
import { AllCutsExportDialog, AllCutsMenuItem } from './all-cuts-export'
import { useAllCutsExport, type CutExportJob } from '../hooks/use-all-cuts-export'

const summary = (id: string, label: string) => ({
  id,
  name: label,
  label,
  main: id === 'main',
  order: 0,
  width: 1080,
  height: 1920,
  aspect: '9:16',
  lastPass: null,
})

const setCuts = (...labels: string[]) =>
  useCutsStore.setState({
    projectId: 'main',
    group: {
      groupId: 'main',
      groupName: 'Warehouse',
      cuts: labels.map((label, i) => summary(i === 0 ? 'main' : `c${i}`, label)),
    },
  })

const menu = () =>
  render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <AllCutsMenuItem onSelect={() => undefined} />
      </DropdownMenuContent>
    </DropdownMenu>,
  )

describe('All cuts export', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('offers "All cuts" only when the project has sibling cuts', () => {
    setCuts('Main')
    const { unmount } = menu()
    expect(screen.queryByTestId('export-all-cuts')).toBeNull()
    unmount()
    setCuts('Main', 'Hook B')
    menu()
    expect(screen.getByTestId('export-all-cuts')).toHaveTextContent('All cuts2')
  })

  it('shows each cut: waiting, exporting, done with its engine, failed with why', () => {
    const job: CutExportJob = {
      id: 'j',
      done: false,
      cuts: [
        {
          id: 'main',
          label: 'Main',
          name: 'W - Main',
          status: 'done',
          engine: 'native',
          path: '/x/W_-_Main.mp4',
        },
        { id: 'c1', label: 'Hook B', name: 'W - Hook B', status: 'exporting' },
        { id: 'c2', label: '16:9', name: 'W - 16-9', status: 'failed', error: 'no service' },
        { id: 'c3', label: 'Short', name: 'W - Short', status: 'queued' },
      ],
    }
    render(<AllCutsExportDialog job={job} onClose={() => undefined} />)
    expect(screen.getByText('2 of 4 cuts exported', { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('cut-export-done')).toHaveTextContent('done (native)')
    expect(screen.getByTestId('cut-export-done')).toHaveTextContent('/x/W_-_Main.mp4')
    expect(screen.getByTestId('cut-export-exporting')).toHaveTextContent('exporting…')
    expect(screen.getByTestId('cut-export-failed')).toHaveTextContent('no service')
    expect(screen.getByTestId('cut-export-queued')).toHaveTextContent('W - Short')
  })

  it('starts the export on the bridge with the dialog codec and follows it to the end', async () => {
    setCuts('Main', 'Hook B')
    const running: CutExportJob = { id: 'j1', done: false, cuts: [] }
    const finished: CutExportJob = { id: 'j1', done: true, cuts: [] }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => running })
      .mockResolvedValue({ ok: true, json: async () => finished })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAllCutsExport())
    await act(() => result.current.start({ codec: 'h264', quality: 'high' }))
    expect(fetchMock.mock.calls[0]![0]).toBe('/__shreditor/cuts/export')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      project: 'main',
      codec: 'h264',
      quality: 'high',
    })
    await waitFor(() => expect(result.current.job?.done).toBe(true), { timeout: 3000 })
    expect(fetchMock.mock.calls[1]![0]).toBe('/__shreditor/cuts/export?job=j1')
  })
})
