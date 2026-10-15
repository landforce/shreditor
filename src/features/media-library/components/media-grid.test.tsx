import { describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@testing-library/react'
import type { MediaMetadata } from '@/types/storage'

const storeState = vi.hoisted(() => ({
  isLoading: false,
  mediaItems: [] as unknown[],
  selectedMediaIds: [] as string[],
  brokenMediaIds: [] as string[],
  deleteMedia: vi.fn(),
  deleteMediaBatch: vi.fn(),
  relinkMedia: vi.fn(),
  importMedia: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./media-card', () => ({
  GridMediaCard: ({ media }: { media: MediaMetadata }) => <div>{media.fileName}</div>,
  ListMediaCard: ({ media }: { media: MediaMetadata }) => <div>{media.fileName}</div>,
}))

vi.mock('../stores/media-library-store', () => ({
  useMediaLibraryStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
  useFilteredMediaItems: () => [],
}))

vi.mock('@/features/media-library/deps/timeline-stores', () => ({
  getMediaDeletionImpact: vi.fn(),
  removeProjectItems: vi.fn(),
  useTimelineStore: Object.assign(
    (selector: (state: { items: [] }) => unknown) => selector({ items: [] }),
    { getState: () => ({}) },
  ),
  useCompositionsStore: (selector: (state: { mediaDependencyIds: string[] }) => unknown) =>
    selector({ mediaDependencyIds: [] }),
}))

vi.mock('@/shared/state/editor', () => ({
  useEditorStore: (selector: (state: { setSourcePreviewMediaId: () => void }) => unknown) =>
    selector({ setSourcePreviewMediaId: vi.fn() }),
}))

import { GridMediaGrid, ListMediaGrid } from './media-grid'

function makeMedia(id: string, width: number, height: number): MediaMetadata {
  return {
    id,
    storageType: 'workspace',
    fileName: `${id}.mp4`,
    fileSize: 1,
    mimeType: 'video/mp4',
    duration: 5,
    width,
    height,
    fps: 30,
    codec: 'avc',
    bitrate: 1,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function cellStyle(container: HTMLElement, id: string) {
  return (container.querySelector(`[data-media-id="${id}"]`) as HTMLElement).style
}

describe('MediaGrid', () => {
  it('sizes grid cells by their media aspect ratio on a shared row height', () => {
    const items = [makeMedia('tall', 1080, 1920), makeMedia('wide', 1920, 1080)]
    const { container } = render(<GridMediaGrid items={items} itemSize={3} />)

    // Row height for size 3 is 156px
    expect(cellStyle(container, 'tall').flex).toBe(`${9 / 16} 1 ${(9 / 16) * 156}px`)
    expect(cellStyle(container, 'wide').flex).toBe(`${16 / 9} 1 ${(16 / 9) * 156}px`)
    expect(cellStyle(container, 'wide').maxWidth).toBe(`${(16 / 9) * 156 * 1.4}px`)
  })

  it('leaves list rows unstyled', () => {
    const { container } = render(<ListMediaGrid items={[makeMedia('a', 1920, 1080)]} />)
    expect(cellStyle(container, 'a').flex).toBe('')
  })
})
