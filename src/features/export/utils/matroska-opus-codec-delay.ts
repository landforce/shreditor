/**
 * Opus encoder delay ("pre-skip") for WebM/MKV exports.
 *
 * An Opus encoder's first packets decode to `preSkip` samples of lead-in
 * (Chrome's encoder: 312 samples, 6.5 ms) before the first input sample. The
 * OpusHead in CodecPrivate states it, but Matroska players (ffmpeg, Chrome)
 * drop the lead-in by the track's CodecDelay element, which Mediabunny always
 * writes as 0, so every WebM/MKV export's audio played 6.5 ms late. Mediabunny
 * also puts the pre-skip in SeekPreRoll, where Opus wants 80 ms.
 *
 * `opusCodecDelayPatch` rewrites the Opus TrackEntry in a finished file's
 * header with CodecDelay = pre-skip and SeekPreRoll = 80 ms in the same number
 * of bytes, so nothing after it moves (cluster and cue positions stay valid).
 * The room comes from a Void element and, when needed, from dropping a
 * FlagLacing of 0 (the default, 1, only says blocks MAY be laced; each block
 * says whether it is). Files it does not recognise are left alone.
 */

const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  tracks: 0x1654ae6b,
  cluster: 0x1f43b675,
  trackEntry: 0xae,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  codecDelay: 0x56aa,
  seekPreRoll: 0x56bb,
  flagLacing: 0x9c,
  void: 0xec,
} as const

const OPUS_SAMPLE_RATE = 48_000
const OPUS_SEEK_PRE_ROLL_NS = 80_000_000
/** How much of the file's start to read: Mediabunny writes Tracks in its first few hundred bytes. */
export const MATROSKA_HEADER_READ_BYTES = 64 * 1024

interface Element {
  id: number
  /** Offset of the element's ID. */
  start: number
  /** Offset of its data. */
  dataStart: number
  /** Offset just past its data. */
  end: number
}

export interface MatroskaPatch {
  /** File offset to write `bytes` at (same length as what it replaces). */
  offset: number
  bytes: Uint8Array<ArrayBuffer>
}

/** An EBML variable-length integer: element IDs keep their length marker, sizes drop it. */
function readVint(bytes: Uint8Array, at: number, keepMarker: boolean) {
  // Leading zero bits of the first byte, plus one, give the length.
  const length = Math.clz32(bytes[at] ?? 0) - 23
  if (length < 1 || length > 8 || at + length > bytes.length) return null
  let value = 0
  for (let i = 0; i < length; i++) value = value * 256 + bytes[at + i]!
  if (keepMarker) return { value, length, unknown: false }
  const marker = 2 ** (7 * length)
  // All value bits set means "unknown size" (a live-written Segment).
  return { value: value - marker, length, unknown: value - marker === marker - 1 }
}

/**
 * The element at `at`; an unknown size runs to `limit`. With `truncate` an
 * element that runs past `limit` (the Segment, beyond the bytes read) ends there.
 */
function readElement(
  bytes: Uint8Array,
  at: number,
  limit: number,
  truncate = false,
): Element | null {
  const id = readVint(bytes, at, true)
  if (!id) return null
  const size = readVint(bytes, at + id.length, false)
  if (!size) return null
  const dataStart = at + id.length + size.length
  let end = size.unknown ? limit : dataStart + size.value
  if (end > limit) {
    if (!truncate) return null
    end = limit
  }
  return { id: id.value, start: at, dataStart, end }
}

function children(bytes: Uint8Array, parent: Element): Element[] {
  const list: Element[] = []
  let at = parent.dataStart
  while (at < parent.end) {
    const element = readElement(bytes, at, parent.end)
    if (!element) break
    list.push(element)
    at = element.end
  }
  return list
}

const readUint = (bytes: Uint8Array, element: Element) =>
  bytes.subarray(element.dataStart, element.end).reduce((value, byte) => value * 256 + byte, 0)

function idBytes(id: number): number[] {
  const out: number[] = []
  for (let value = id; value > 0; value = Math.floor(value / 256)) out.unshift(value % 256)
  return out
}

/** EBML size field of `size` in `length` bytes. */
function sizeBytes(size: number, length: number): number[] {
  const out: number[] = []
  let value = size
  for (let i = 0; i < length; i++) {
    out.unshift(value % 256)
    value = Math.floor(value / 256)
  }
  out[0]! |= 0x80 >> (length - 1)
  return out
}

/** An unsigned-integer element, its value padded with leading zeros to `width` bytes. */
function uintElement(id: number, value: number, width = 0): number[] {
  const data: number[] = []
  for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) data.unshift(rest % 256)
  if (data.length === 0) data.push(0)
  while (data.length < width) data.unshift(0)
  return [...idBytes(id), ...sizeBytes(data.length, 1), ...data]
}

/** A Void element exactly `length` (>= 2) bytes long. */
function voidElement(length: number): number[] {
  const sizeLength = length - 2 <= 126 ? 1 : 8
  const payload = length - 1 - sizeLength
  return [ID.void, ...sizeBytes(payload, sizeLength), ...new Array<number>(payload).fill(0)]
}

/** Pre-skip from an OpusHead (RFC 7845 5.1), or null. */
function opusPreSkip(bytes: Uint8Array, codecPrivate: Element | undefined): number | null {
  if (!codecPrivate || codecPrivate.end - codecPrivate.dataStart < 19) return null
  const head = bytes.subarray(codecPrivate.dataStart, codecPrivate.end)
  if (String.fromCharCode(...head.subarray(0, 8)) !== 'OpusHead') return null
  return head[10]! | (head[11]! << 8)
}

/**
 * TrackEntry data of the same length with the given CodecDelay and, room
 * permitting, an 80 ms SeekPreRoll; null when it cannot fit.
 */
function rewriteTrackEntry(
  bytes: Uint8Array,
  entry: Element,
  entryChildren: Element[],
  codecDelayNs: number,
): Uint8Array<ArrayBuffer> | null {
  const space = entry.end - entry.dataStart
  const replaced = new Set<number>([ID.codecDelay, ID.seekPreRoll, ID.void])
  const lacing = entryChildren.find((e) => e.id === ID.flagLacing)
  const attempts: Array<{ dropLacing: boolean; seekPreRoll: boolean }> = [
    { dropLacing: false, seekPreRoll: true },
    { dropLacing: true, seekPreRoll: true },
    { dropLacing: false, seekPreRoll: false },
  ]
  for (const { dropLacing, seekPreRoll } of attempts) {
    if (dropLacing && (!lacing || readUint(bytes, lacing) !== 0)) continue
    const kept = entryChildren.filter(
      (e) => !replaced.has(e.id) && !(dropLacing && e.id === ID.flagLacing),
    )
    const keptBytes = kept.flatMap((e) => [...bytes.subarray(e.start, e.end)])
    const preRoll = seekPreRoll ? uintElement(ID.seekPreRoll, OPUS_SEEK_PRE_ROLL_NS) : []
    let delay = uintElement(ID.codecDelay, codecDelayNs)
    let spare = space - keptBytes.length - preRoll.length - delay.length
    if (spare < 0) continue
    // A Void needs two bytes; one spare byte widens CodecDelay instead.
    if (spare === 1) {
      const dataLength = delay.length - idBytes(ID.codecDelay).length - 1
      delay = uintElement(ID.codecDelay, codecDelayNs, dataLength + 1)
      spare = 0
    }
    return Uint8Array.from([
      ...keptBytes,
      ...delay,
      ...preRoll,
      ...(spare ? voidElement(spare) : []),
    ])
  }
  return null
}

function findTracks(bytes: Uint8Array): Element | null {
  let at = 0
  const ebml = readElement(bytes, at, bytes.length)
  if (!ebml || ebml.id !== ID.ebml) return null
  at = ebml.end
  const segment = readElement(bytes, at, bytes.length, true)
  if (!segment || segment.id !== ID.segment) return null
  at = segment.dataStart
  while (at < segment.end) {
    const element = readElement(bytes, at, segment.end)
    if (!element || element.id === ID.cluster) return null
    if (element.id === ID.tracks) return element
    at = element.end
  }
  return null
}

/**
 * The same-length rewrite of `head` (the start of a finished WebM/MKV) that
 * gives its Opus track CodecDelay = the OpusHead pre-skip, or null when there
 * is nothing to change or the file is not recognised.
 */
export function opusCodecDelayPatch(head: Uint8Array): MatroskaPatch | null {
  const tracks = findTracks(head)
  if (!tracks) return null
  for (const entry of children(head, tracks)) {
    if (entry.id !== ID.trackEntry) continue
    const entryChildren = children(head, entry)
    const codecId = entryChildren.find((e) => e.id === ID.codecId)
    if (
      !codecId ||
      String.fromCharCode(...head.subarray(codecId.dataStart, codecId.end)) !== 'A_OPUS'
    )
      continue
    const preSkip = opusPreSkip(
      head,
      entryChildren.find((e) => e.id === ID.codecPrivate),
    )
    if (!preSkip) return null
    const codecDelayNs = Math.round((preSkip * 1e9) / OPUS_SAMPLE_RATE)
    const current = entryChildren.find((e) => e.id === ID.codecDelay)
    if (current && readUint(head, current) === codecDelayNs) return null
    const bytes = rewriteTrackEntry(head, entry, entryChildren, codecDelayNs)
    return bytes ? { offset: entry.dataStart, bytes } : null
  }
  return null
}
