import { describe, expect, it, vi, beforeEach } from 'vite-plus/test'
const mocked = vi.hoisted(() => ({ readBlob: vi.fn(), readJson: vi.fn() }))
vi.mock('./root', () => ({ requireWorkspaceRoot: () => ({}) }))
vi.mock('./fs-primitives', () => ({
  ...mocked,
  listDirectory: async () => [{ kind: 'file', name: 'original.mov' }],
  writeBlob: vi.fn(),
}))
import { readMediaSource } from './media-source'

beforeEach(() => vi.clearAllMocks())
describe('workspace compatibility source selection', () => {
  it('preview reads the validated full-resolution derivative', async () => {
    const source = new File(['original'], 'original.mov', { lastModified: 1234 })
    const prepared = new Blob(['prepared'])
    mocked.readBlob.mockResolvedValueOnce(source).mockResolvedValueOnce(prepared)
    mocked.readJson.mockResolvedValue({
      version: 1,
      file: `${'a'.repeat(64)}.mov`,
      source: { size: source.size, mtimeMs: 1234.5 },
      outputSize: prepared.size,
    })
    expect(await readMediaSource('clip')).toBe(prepared)
  })
  it('does not use stale derivatives after source replacement', async () => {
    const source = new File(['original'], 'original.mov', { lastModified: 2000 })
    mocked.readBlob.mockResolvedValue(source)
    mocked.readJson.mockResolvedValue({
      version: 1,
      file: `${'a'.repeat(64)}.mov`,
      source: { size: source.size, mtimeMs: 1234 },
      outputSize: 8,
    })
    expect(await readMediaSource('clip')).toBe(source)
    expect(mocked.readBlob).toHaveBeenCalledTimes(1)
  })
  it('a corrupt derivative manifest does not hide the original', async () => {
    const source = new File(['original'], 'original.mov')
    mocked.readBlob.mockResolvedValue(source)
    mocked.readJson.mockRejectedValue(new Error('invalid JSON'))
    expect(await readMediaSource('clip')).toBe(source)
  })
  it('an incomplete derivative manifest does not hide the original', async () => {
    const source = new File(['original'], 'original.mov')
    mocked.readBlob.mockResolvedValue(source)
    mocked.readJson.mockResolvedValue({ version: 1, file: `${'a'.repeat(64)}.mov` })
    expect(await readMediaSource('clip')).toBe(source)
  })
})
