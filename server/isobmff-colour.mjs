// The `colr` boxes of an MP4/MOV file's first video sample entry, read from
// the box headers only (the media data is never read).
//
// ffprobe reports one merged set of colour tags, so it can't tell colour that
// the container declares from colour only the H.264/HEVC bitstream carries.
// Chrome's <video> element and Mediabunny read the container's `colr` box, so
// the compatibility policy needs to know which of the two a file has.
import fs from 'node:fs'

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])
const MAX_MOOV = 64 * 1024 * 1024
// VisualSampleEntry fields before its child boxes (ISO/IEC 14496-12 12.1.3).
const VISUAL_SAMPLE_ENTRY = 78

function* boxes(bytes, start, end) {
  let at = start
  while (at + 8 <= end) {
    let size = bytes.readUInt32BE(at)
    let header = 8
    if (size === 1) {
      if (at + 16 > end) return
      size = Number(bytes.readBigUInt64BE(at + 8))
      header = 16
    } else if (size === 0) {
      size = end - at
    }
    if (size < header || at + size > end) return
    yield { type: bytes.toString('latin1', at + 4, at + 8), start: at + header, end: at + size }
    at += size
  }
}

/** The moov box, read from the file by walking the top-level box headers. */
function readMoov(fd, fileSize) {
  const head = Buffer.alloc(16)
  let at = 0
  while (at + 8 <= fileSize) {
    if (fs.readSync(fd, head, 0, 16, at) < 8) return null
    let size = head.readUInt32BE(0)
    let header = 8
    if (size === 1) {
      size = Number(head.readBigUInt64BE(8))
      header = 16
    } else if (size === 0) {
      size = fileSize - at
    }
    if (size < header) return null
    const type = head.toString('latin1', 4, 8)
    if (type === 'moov') {
      if (size > MAX_MOOV) return null
      const moov = Buffer.alloc(size - header)
      fs.readSync(fd, moov, 0, moov.length, at + header)
      return moov
    }
    at += size
  }
  return null
}

function parseColr(bytes, box) {
  if (box.end - box.start < 4) return null
  const kind = bytes.toString('latin1', box.start, box.start + 4)
  if ((kind !== 'nclx' && kind !== 'nclc') || box.end - box.start < 10) return { type: kind }
  return {
    type: kind,
    primaries: bytes.readUInt16BE(box.start + 4),
    transfer: bytes.readUInt16BE(box.start + 6),
    matrix: bytes.readUInt16BE(box.start + 8),
    ...(kind === 'nclx' && box.end - box.start >= 11 ? { fullRange: (bytes[box.start + 10] & 0x80) !== 0 } : {}),
  }
}

/** `colr` boxes in the first sample entry of a stsd box. */
function sampleEntryColr(bytes, stsd) {
  // FullBox header (4) + entry_count (4), then the sample entries.
  const [entry] = boxes(bytes, stsd.start + 8, stsd.end)
  if (!entry || entry.end - entry.start < VISUAL_SAMPLE_ENTRY) return []
  return [...boxes(bytes, entry.start + VISUAL_SAMPLE_ENTRY, entry.end)]
    .filter((child) => child.type === 'colr')
    .map((child) => parseColr(bytes, child))
    .filter(Boolean)
}

function isVideoTrak(bytes, trak) {
  for (const mdia of boxes(bytes, trak.start, trak.end)) {
    if (mdia.type !== 'mdia') continue
    for (const child of boxes(bytes, mdia.start, mdia.end)) {
      // hdlr: FullBox header (4), pre_defined (4), handler_type (4).
      if (child.type === 'hdlr' && child.end - child.start >= 12)
        return bytes.toString('latin1', child.start + 8, child.start + 12) === 'vide'
    }
  }
  return false
}

function findStsd(bytes, box) {
  for (const child of boxes(bytes, box.start, box.end)) {
    if (child.type === 'stsd') return child
    if (CONTAINERS.has(child.type)) {
      const found = findStsd(bytes, child)
      if (found) return found
    }
  }
  return null
}

/**
 * The `colr` boxes of the first video track (`[]` when it has none), each
 * `{ type: 'nclx'|'nclc', primaries, transfer, matrix, fullRange? }` or
 * `{ type: 'prof'|'rICC'|... }`; null when the file is not a readable MP4/MOV.
 */
export function readContainerColour(file) {
  if (!file) return null
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const moov = readMoov(fd, fs.fstatSync(fd).size)
    if (!moov) return null
    for (const trak of boxes(moov, 0, moov.length)) {
      if (trak.type !== 'trak' || !isVideoTrak(moov, trak)) continue
      const stsd = findStsd(moov, trak)
      return stsd ? sampleEntryColr(moov, stsd) : []
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/**
 * True when a `colr` box gives the matrix, primaries and transfer (Chrome
 * ignores an nclx/nclc box with any of them unspecified).
 */
export function isCompleteColour(colr) {
  if (colr.type !== 'nclx' && colr.type !== 'nclc') return false
  const specified = (value) => value !== 2 && value !== 3
  return specified(colr.matrix) && specified(colr.primaries) && specified(colr.transfer) && colr.primaries !== 0 && colr.transfer !== 0
}
