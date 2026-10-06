// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { asHandle, createRoot, readFileText, type MemDir } from './__tests__/in-memory-handle'

const mocks = vi.hoisted(() => ({ root: null as unknown }))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('./root', () => ({
  requireWorkspaceRoot: () => mocks.root,
  notifyPermissionLost: vi.fn(),
}))

import { listWorkspaceLuts, lutLibraryFileName, readWorkspaceLut, saveWorkspaceLut } from './luts'

const cube = (title: string | null, size = 2) =>
  [
    ...(title ? [`TITLE "${title}"`] : []),
    `LUT_3D_SIZE ${size}`,
    ...Array.from({ length: size ** 3 }, () => '0.5 0.5 0.5'),
  ].join('\n')

async function plant(root: MemDir, name: string, text: string): Promise<void> {
  const dir = await root.getDirectoryHandle('luts', { create: true })
  const file = await dir.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  await writable.write(text)
  await writable.close()
}

describe('workspace LUT library', () => {
  let root: MemDir

  beforeEach(() => {
    root = createRoot()
    mocks.root = asHandle(root)
  })

  it('lists nothing when luts/ does not exist yet', async () => {
    await expect(listWorkspaceLuts()).resolves.toEqual([])
  })

  it('lists .cube files sorted by name with their TITLE and size', async () => {
    await plant(root, 'warm.cube', cube('Warm Look', 3))
    await plant(root, 'Bleach.CUBE', cube(null))
    await plant(root, 'notes.txt', 'not a lut')

    await expect(listWorkspaceLuts()).resolves.toEqual([
      { name: 'Bleach.CUBE', title: null, size: 2 },
      { name: 'warm.cube', title: 'Warm Look', size: 3 },
    ])
  })

  it('reads a LUT by file name, null when missing or not a plain .cube name', async () => {
    await plant(root, 'warm.cube', cube('Warm Look'))

    await expect(readWorkspaceLut('warm.cube')).resolves.toBe(cube('Warm Look'))
    await expect(readWorkspaceLut('cold.cube')).resolves.toBeNull()
    await expect(readWorkspaceLut('notes.txt')).resolves.toBeNull()
    await expect(readWorkspaceLut('../warm.cube')).resolves.toBeNull()
  })

  it('saves a new file, skips an identical one and suffixes a different one', async () => {
    await expect(saveWorkspaceLut('Warm.cube', cube('A'))).resolves.toEqual({
      name: 'Warm.cube',
      written: true,
    })
    await expect(saveWorkspaceLut('Warm.cube', cube('A'))).resolves.toEqual({
      name: 'Warm.cube',
      written: false,
    })
    await expect(saveWorkspaceLut('Warm.cube', cube('B'))).resolves.toEqual({
      name: 'Warm-2.cube',
      written: true,
    })
    await expect(saveWorkspaceLut('Warm.cube', cube('B'))).resolves.toEqual({
      name: 'Warm-2.cube',
      written: false,
    })
    await expect(saveWorkspaceLut('Warm.cube', cube('C'))).resolves.toEqual({
      name: 'Warm-3.cube',
      written: true,
    })

    await expect(readFileText(root, 'luts', 'Warm.cube')).resolves.toBe(cube('A'))
    await expect(readFileText(root, 'luts', 'Warm-2.cube')).resolves.toBe(cube('B'))
  })

  it('keeps library names safe and always .cube', () => {
    expect(lutLibraryFileName('Film: Look?.cube')).toBe('Film_ Look_.cube')
    expect(lutLibraryFileName('look')).toBe('look.cube')
    expect(lutLibraryFileName('Look.CUBE')).toBe('Look.CUBE')
  })
})
