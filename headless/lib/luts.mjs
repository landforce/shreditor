// The workspace LUT library: `.cube` files in <workspace>/luts/, shared by the
// user (the editor's LUT panel) and the agent (`shred lut`, the `addLut` op).
// The browser can't read the workspace on its own here, so the Node side
// resolves each `addLut` op's file and hands its text to the edit input.
import fs from 'node:fs'
import path from 'node:path'
import { assertSinglePathComponent, HttpError, resolveContained } from './http-security.mjs'

export const LUTS_DIR = 'luts'
/** Larger than any real 3D LUT (a 65³ .cube is ~8 MB of text). */
export const MAX_LUT_BYTES = 16 * 1024 * 1024
const CUBE_EXTENSION = /\.cube$/i
const isDataLine = (line) => /^[-+.\d]/.test(line)

/** The `.cube` file names in <workspace>/luts/, sorted. */
export function listLutNames(workspaceDir) {
  const dir = path.join(workspaceDir, LUTS_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && CUBE_EXTENSION.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function lutNotFound(workspaceDir, name) {
  const names = listLutNames(workspaceDir)
  const has = names.length ? `luts/ has: ${names.join(', ')}` : 'luts/ is empty'
  return new HttpError(
    404,
    'LUT_NOT_FOUND',
    `No LUT "${name}" in the workspace (${has}). Add one with: shred lut add <file.cube>`,
  )
}

/**
 * Resolve a library LUT name to its file: a single path component ending in
 * `.cube`, inside the workspace (symlinks included), at most MAX_LUT_BYTES.
 */
export function resolveLutFile(workspaceDir, name) {
  assertSinglePathComponent(name, 'lut')
  if (!CUBE_EXTENSION.test(name))
    throw new HttpError(400, 'INVALID_LUT', `lut must be a .cube file name in luts/, got "${name}"`)
  const file = resolveContained(workspaceDir, path.join(LUTS_DIR, name))
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  if (!stat?.isFile()) throw lutNotFound(workspaceDir, name)
  if (stat.size > MAX_LUT_BYTES)
    throw new HttpError(
      413,
      'LUT_TOO_LARGE',
      `luts/${name} is ${stat.size} bytes; a LUT may be at most ${MAX_LUT_BYTES}`,
    )
  return file
}

/** `{ name, text }` for every LUT the ops' `addLut` ops name (deduped). */
export function collectLuts(workspaceDir, ops) {
  const names = [...new Set(ops.filter((o) => o.op === 'addLut').map((o) => o.lut))]
  return names.map((name) => ({
    name,
    text: fs.readFileSync(resolveLutFile(workspaceDir, name), 'utf8'),
  }))
}

const HEADER_LINES = [
  [/^TITLE\s+(?:"(.*)"|(.*))$/, (header, m) => (header.title = (m[1] ?? m[2]).trim())],
  [/^LUT_3D_SIZE\s+(\S+)/, (header, m) => (header.size = Number.parseInt(m[1], 10))],
  [/^LUT_1D_SIZE\b/, (header) => (header.oneDimensional = true)],
]

function readHeaderLine(header, line) {
  for (const [pattern, apply] of HEADER_LINES) {
    const match = pattern.exec(line)
    if (match) return apply(header, match)
  }
}

/**
 * What a `.cube` header says: TITLE, LUT_3D_SIZE, and whether it is a 1D LUT.
 * Reads up to the first data line only.
 */
export function readCubeHeader(text) {
  const header = { title: null, size: null, oneDimensional: false }
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const firstData = lines.findIndex(isDataLine)
  for (const line of firstData === -1 ? lines : lines.slice(0, firstData))
    readHeaderLine(header, line)
  return header
}

const isUsableSize = (size) => Number.isInteger(size) && size >= 2 && size <= 129

/**
 * Check `.cube` text is a 3D LUT the editor can load: a LUT_3D_SIZE header
 * (2..129, not a 1D LUT) and size³ data lines. Returns its header; throws a
 * plain-language reason otherwise.
 */
export function checkCubeText(text) {
  const header = readCubeHeader(text)
  if (header.oneDimensional) throw new Error('a 1D LUT (LUT_1D_SIZE); only 3D LUTs work here')
  const { size } = header
  if (!isUsableSize(size))
    throw new Error('no LUT_3D_SIZE between 2 and 129 in the header; not a 3D .cube LUT')
  const entries = text.split(/\r?\n/).filter((raw) => isDataLine(raw.trim())).length
  if (entries !== size ** 3)
    throw new Error(`LUT_3D_SIZE ${size} needs ${size ** 3} data lines, found ${entries}`)
  return header
}

/** The header of a `.cube` file on disk, reading only its first 16 KB. */
export function readCubeFileHeader(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(16 * 1024)
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0)
    return readCubeHeader(buffer.subarray(0, length).toString('utf8'))
  } finally {
    fs.closeSync(fd)
  }
}
