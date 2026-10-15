import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createFormatTracks, projectFormatRecord } from '@formats/registry.mjs'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'

const storage = vi.hoisted(() => ({
  updateProject: vi.fn(async (id: string, updates: object) => ({ id, ...updates })),
  getTranscript: vi.fn(async () => undefined),
}))

vi.mock('@/infrastructure/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infrastructure/storage')>()),
  ...storage,
}))

const { useProjectStore } = await import('@/features/editor/deps/projects')
const { useItemsStore, useTimelineCommandStore, useCompositionNavigationStore } =
  await import('@/features/editor/deps/timeline-store')
const { usePlaybackStore } = await import('@/shared/state/playback')
const { useFormatScorecardStore } = await import('@/shared/state/format-scorecard')
const { FormatPanel } = await import('./format-panel')
const { FormatScorecardController } = await import('./format-scorecard-controller')

const FPS = 30
const tracks = createFormatTracks('graphic-yap') as unknown as TimelineTrack[]

// 30 s of speaker with an image every 10 s: "no new image for 10 s" fails three times.
const items = [
  { id: 'speaker', type: 'video', trackId: 'track-speaker', from: 0, durationInFrames: 900 },
  ...[0, 300, 600].map((from, index) => ({
    id: `image-${index}`,
    type: 'image',
    trackId: 'track-images',
    from,
    durationInFrames: 30,
  })),
].map((item) => ({ label: item.id, src: '', ...item })) as unknown as TimelineItem[]

function setUp(format: 'graphic-yap' | null = 'graphic-yap') {
  useProjectStore.setState({
    projects: [],
    currentProject: {
      id: 'p1',
      name: 'Project',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 0,
      metadata: { width: 1080, height: 1920, fps: FPS },
      ...(format ? { format: projectFormatRecord(format) } : {}),
    },
  })
  useItemsStore.getState().setTracks(tracks)
  useItemsStore.getState().setItems(items)
  useCompositionNavigationStore.setState({ activeCompositionId: null })
  useTimelineCommandStore.getState().clearHistory()
  usePlaybackStore.getState().setCurrentFrame(0)
  useFormatScorecardStore.setState({ card: null, stale: false, showTimelineRanges: true })
}

function renderPanel() {
  return render(
    <>
      <FormatScorecardController />
      <FormatPanel />
    </>,
  )
}

describe('FormatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setUp()
  })

  it('shows the format, its rules and a live scorecard of the timeline', async () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: 'Graphic Yap' })).toBeInTheDocument()
    expect(
      screen.getByText('Required from 0 s, held 3 s or more, or all video'),
    ).toBeInTheDocument()
    expect(screen.getByText('None: hard cuts only')).toBeInTheDocument()
    expect(screen.getByText('None: constant speed')).toBeInTheDocument()
    expect(screen.getByTestId('format-allow-speed-ramps')).not.toBeChecked()

    const summary = await screen.findByTestId('format-summary')
    // Pacing numbers are guidelines (warn); only format rules fail.
    expect(summary).toHaveTextContent('2 fail')
    expect(summary).toHaveTextContent('5 warn')
    // The speed ramp check (no ramped clips) is one of the passes.
    expect(summary).toHaveTextContent('3 pass')
    const gap = screen.getByTestId('format-check-longestNoNewImageSec')
    expect(gap).toHaveAttribute('data-status', 'warn')
    expect(gap).toHaveTextContent('Longest stretch with no new image')
    expect(gap).toHaveTextContent('10 s')
    expect(gap).toHaveTextContent('<= 5 s')
  })

  it('rescores when the timeline changes', async () => {
    renderPanel()
    await screen.findByTestId('format-summary')

    const dense = Array.from({ length: 15 }, (_, index) => ({
      ...items[1]!,
      id: `dense-${index}`,
      from: index * 60,
      durationInFrames: 45,
    }))
    act(() => useItemsStore.getState().setItems([items[0]!, ...dense]))

    await waitFor(() =>
      expect(screen.getByTestId('format-check-longestNoNewImageSec')).toHaveAttribute(
        'data-status',
        'pass',
      ),
    )
  })

  it('jumps the playhead to a failing range, then to the next on repeat clicks', async () => {
    renderPanel()
    const gap = await screen.findByTestId('format-check-longestNoNewImageSec')
    expect(gap).toHaveTextContent('Jump through 3 spots')

    usePlaybackStore.getState().setCurrentFrame(450)
    fireEvent.click(gap)
    expect(usePlaybackStore.getState().currentFrame).toBe(0)
    expect(gap).toHaveTextContent('At 1 of 3')
    fireEvent.click(gap)
    expect(usePlaybackStore.getState().currentFrame).toBe(300)
    fireEvent.click(gap)
    expect(usePlaybackStore.getState().currentFrame).toBe(600)
    fireEvent.click(gap)
    expect(usePlaybackStore.getState().currentFrame).toBe(0)
  })

  it('offers Set format on a project without one', () => {
    setUp(null)
    renderPanel()
    expect(screen.getByText('No format yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set format' })).toBeInTheDocument()
  })
})

describe('Change format', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setUp()
  })

  it('re-targets the format and adds the missing tracks without moving or deleting anything', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Change format' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(/Nothing on the timeline is moved or deleted/),
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Greenscreen Talking Head/ }))
    const addTracks = within(dialog).getByRole('checkbox', {
      name: /Add the missing tracks: Plates/,
    })
    expect(addTracks).toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change format' }))

    await waitFor(() => expect(storage.updateProject).toHaveBeenCalled())
    expect(storage.updateProject).toHaveBeenCalledWith('p1', {
      format: expect.objectContaining({ id: 'greenscreen', reviewedHash: expect.any(String) }),
    })
    expect(useProjectStore.getState().currentProject?.format?.id).toBe('greenscreen')

    const after = useItemsStore.getState()
    expect(after.items).toEqual(items)
    for (const track of tracks) {
      expect(after.tracks.find((t) => t.id === track.id)).toMatchObject({
        name: track.name,
        formatRole: track.formatRole,
      })
    }
    const plates = after.tracks.find((track) => track.formatRole === 'plates')
    expect(plates).toMatchObject({ name: 'Plates', kind: 'video' })
    expect(after.tracks).toHaveLength(tracks.length + 1)
    // Undoable like any other track edit.
    expect(useTimelineCommandStore.getState().canUndo).toBe(true)
  })

  it('can change the format without adding tracks', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Change format' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Vlog/ }))
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change format' }))

    await waitFor(() => expect(useProjectStore.getState().currentProject?.format?.id).toBe('vlog'))
    expect(useItemsStore.getState().tracks).toHaveLength(tracks.length)
    expect(useItemsStore.getState().items).toEqual(items)
  })
})
