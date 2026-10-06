/**
 * AAC encoder delay ("priming") for MP4/MOV exports.
 *
 * An AAC encoder's first output packets decode to `primingSamples` of lead-in
 * before the first input sample (Chrome's AAC encoder: 2112 samples, 44 ms at
 * 48 kHz), and WebCodecs stamps those packets from timestamp 0. Players only
 * drop the lead-in when the track's edit list says so (media_time = priming),
 * which is how ffmpeg, Apple and Android encoders mark it. Mediabunny writes
 * edit lists only for a positive start offset, so without this patch every
 * export's audio plays `primingSamples` late.
 *
 * `addAudioPrimingEditList` rewrites a finished file's `moov`: the sound
 * track gets an `edts`/`elst` with one edit (media_time = priming, duration =
 * the samples actually fed to the encoder), its `tkhd` and the `mvhd` take
 * that duration, and when `moov` precedes `mdat` every chunk offset moves by
 * the bytes the edit list adds. Files it does not recognise (fragmented, an
 * existing audio edit list, no or several sound tracks) are left alone.
 */

interface BoxRef {
  type: string
  start: number
  size: number
  headerSize: number
}

export interface AudioPrimingEdit {
  /** Encoder delay in samples at `sampleRate`. */
  primingSamples: number
  /** Samples fed to the encoder: the audio's presented length. */
  presentationSamples: number
  sampleRate: number
}

const fourcc = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!)

function readBox(bytes: Uint8Array, at: number, end: number): BoxRef | null {
  if (at + 8 > end) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let size = view.getUint32(at)
  let headerSize = 8
  if (size === 1) {
    if (at + 16 > end) return null
    size = Number(view.getBigUint64(at + 8))
    headerSize = 16
  } else if (size === 0) {
    size = end - at
  }
  if (size < headerSize || at + size > end) return null
  return { type: fourcc(bytes, at + 4), start: at, size, headerSize }
}

function children(bytes: Uint8Array, box: BoxRef): BoxRef[] {
  const list: BoxRef[] = []
  const end = box.start + box.size
  let at = box.start + box.headerSize
  while (at < end) {
    const child = readBox(bytes, at, end)
    if (!child) break
    list.push(child)
    at += child.size
  }
  return list
}

const child = (bytes: Uint8Array, box: BoxRef | undefined, type: string) =>
  box ? children(bytes, box).find((entry) => entry.type === type) : undefined

/** Top-level boxes of a whole file held in memory. */
export function listTopLevelBoxes(bytes: Uint8Array): BoxRef[] {
  return children(bytes, { type: 'file', start: 0, size: bytes.byteLength, headerSize: 0 })
}

function boxHeader(type: string, payloadSize: number): Uint8Array {
  const large = payloadSize + 8 > 0xffffffff
  const header = new Uint8Array(large ? 16 : 8)
  const view = new DataView(header.buffer)
  if (large) {
    view.setUint32(0, 1)
    view.setBigUint64(8, BigInt(payloadSize + 16))
  } else {
    view.setUint32(0, payloadSize + 8)
  }
  for (let i = 0; i < 4; i++) header[4 + i] = type.charCodeAt(i)
  return header
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/** Rebuild `box` with its children, replacing some and inserting after others. */
function rebuild(
  bytes: Uint8Array,
  box: BoxRef,
  replace: Map<number, Uint8Array>,
  insertAfter: Map<number, Uint8Array> = new Map(),
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = []
  for (const entry of children(bytes, box)) {
    parts.push(replace.get(entry.start) ?? bytes.subarray(entry.start, entry.start + entry.size))
    const extra = insertAfter.get(entry.start)
    if (extra) parts.push(extra)
  }
  const payload = concat(parts)
  return concat([boxHeader(box.type, payload.byteLength), payload])
}

interface FullBoxTiming {
  version: number
  /** Byte offset of the duration field. */
  durationAt: number
  timescale?: number
}

/** `mvhd`/`mdhd`: timescale and duration; `tkhd`: duration only. */
function timing(bytes: Uint8Array, box: BoxRef): FullBoxTiming {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const body = box.start + box.headerSize
  const version = bytes[body]!
  const v1 = version === 1
  if (box.type === 'tkhd') return { version, durationAt: body + 4 + (v1 ? 24 : 16) }
  const timescaleAt = body + 4 + (v1 ? 16 : 8)
  return { version, durationAt: timescaleAt + 4, timescale: view.getUint32(timescaleAt) }
}

function readDuration(bytes: Uint8Array, at: FullBoxTiming): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return at.version === 1 ? Number(view.getBigUint64(at.durationAt)) : view.getUint32(at.durationAt)
}

function withDuration(bytes: Uint8Array, box: BoxRef, duration: number): Uint8Array | null {
  const at = timing(bytes, box)
  if (at.version !== 1 && duration > 0xffffffff) return null
  const copy = bytes.slice(box.start, box.start + box.size)
  const view = new DataView(copy.buffer)
  const offset = at.durationAt - box.start
  if (at.version === 1) view.setBigUint64(offset, BigInt(duration))
  else view.setUint32(offset, duration)
  return copy
}

function editListBox(segmentDuration: number, mediaTime: number): Uint8Array {
  const v1 = segmentDuration > 0xffffffff || mediaTime > 0x7fffffff
  const elst = new Uint8Array(4 + 4 + (v1 ? 20 : 12))
  const view = new DataView(elst.buffer)
  view.setUint8(0, v1 ? 1 : 0)
  view.setUint32(4, 1) // entry count
  if (v1) {
    view.setBigUint64(8, BigInt(segmentDuration))
    view.setBigInt64(16, BigInt(mediaTime))
    view.setInt16(24, 1) // media rate 1.0
  } else {
    view.setUint32(8, segmentDuration)
    view.setInt32(12, mediaTime)
    view.setInt16(16, 1)
  }
  const elstBox = concat([boxHeader('elst', elst.byteLength), elst])
  return concat([boxHeader('edts', elstBox.byteLength), elstBox])
}

function handlerType(bytes: Uint8Array, trak: BoxRef): string | null {
  const hdlr = child(bytes, child(bytes, trak, 'mdia'), 'hdlr')
  return hdlr ? fourcc(bytes, hdlr.start + hdlr.headerSize + 8) : null
}

/** Add `delta` to each entry of one stco/co64 table in place. False on overflow. */
function shiftChunkOffsetTable(view: DataView, table: BoxRef, delta: number): boolean {
  const body = table.start + table.headerSize
  const count = view.getUint32(body + 4)
  const wide = table.type === 'co64'
  for (let i = 0; i < count; i++) {
    const at = body + 8 + i * (wide ? 8 : 4)
    if (wide) {
      view.setBigUint64(at, view.getBigUint64(at) + BigInt(delta))
      continue
    }
    const value = view.getUint32(at) + delta
    if (value > 0xffffffff) return false
    view.setUint32(at, value)
  }
  return true
}

/** Add `delta` to every chunk offset of every track in place. False on overflow. */
function shiftChunkOffsets(moov: Uint8Array, delta: number): boolean {
  if (delta === 0) return true
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const root = readBox(moov, 0, moov.byteLength)!
  const tables = children(moov, root)
    .filter((box) => box.type === 'trak')
    .map((trak) => child(moov, child(moov, child(moov, trak, 'mdia'), 'minf'), 'stbl'))
    .flatMap((stbl) => (stbl ? children(moov, stbl) : []))
    .filter((table) => table.type === 'stco' || table.type === 'co64')
  return tables.every((table) => shiftChunkOffsetTable(view, table, delta))
}

interface SoundTrack {
  moov: BoxRef
  mvhd: BoxRef
  traks: BoxRef[]
  trak: BoxRef
  tkhd: BoxRef
  movieTimescale: number
  mediaTimescale: number
}

/** The one sound `trak` (and its `tkhd`/`mdhd`) when it has no edit list yet. */
function soundTrak(bytes: Uint8Array, traks: BoxRef[]) {
  const sound = traks.filter((trak) => handlerType(bytes, trak) === 'soun')
  if (sound.length !== 1) return null
  const trak = sound[0]!
  const tkhd = child(bytes, trak, 'tkhd')
  const mdhd = child(bytes, child(bytes, trak, 'mdia'), 'mdhd')
  return tkhd && mdhd && !child(bytes, trak, 'edts') ? { trak, tkhd, mdhd } : null
}

/** `mvhd` of a non-fragmented movie (no `mvex`), or undefined. */
const movieHeader = (boxes: BoxRef[]) =>
  boxes.some((box) => box.type === 'mvex') ? undefined : boxes.find((box) => box.type === 'mvhd')

/** The single sound track of a non-fragmented `moov` without an edit list, or null. */
function findSoundTrack(bytes: Uint8Array): SoundTrack | null {
  const moov = readBox(bytes, 0, bytes.byteLength)
  const boxes = moov?.type === 'moov' ? children(bytes, moov) : []
  const mvhd = movieHeader(boxes)
  const traks = boxes.filter((box) => box.type === 'trak')
  const sound = soundTrak(bytes, traks)
  if (!moov || !mvhd || !sound) return null
  const movieTimescale = timing(bytes, mvhd).timescale ?? 0
  const mediaTimescale = timing(bytes, sound.mdhd).timescale ?? 0
  if (Math.min(movieTimescale, mediaTimescale) <= 0) return null
  return { moov, mvhd, traks, trak: sound.trak, tkhd: sound.tkhd, movieTimescale, mediaTimescale }
}

/** Longest track after the sound track takes `soundDuration` (movie timescale). */
function movieDurationWith(bytes: Uint8Array, found: SoundTrack, soundDuration: number): number {
  const others = found.traks
    .filter((trak) => trak !== found.trak)
    .map((trak) => child(bytes, trak, 'tkhd'))
    .map((tkhd) => (tkhd ? readDuration(bytes, timing(bytes, tkhd)) : 0))
  return Math.max(soundDuration, ...others)
}

/**
 * The `moov` with the priming edit, or null when it cannot be applied. When
 * `moov` precedes `mdat` the media data moves by the bytes the edit adds, so
 * every chunk offset moves with it.
 */
function patchMoovForAudioPriming(
  moovBytes: Uint8Array,
  edit: AudioPrimingEdit,
  options: { moovPrecedesMdat: boolean },
): Uint8Array<ArrayBuffer> | null {
  const found = edit.primingSamples > 0 && edit.sampleRate > 0 ? findSoundTrack(moovBytes) : null
  if (!found) return null
  const { moov, mvhd, trak, tkhd } = found
  const mediaTime = Math.round((edit.primingSamples * found.mediaTimescale) / edit.sampleRate)
  const segmentDuration = Math.round(
    (edit.presentationSamples * found.movieTimescale) / edit.sampleRate,
  )
  const newTkhd = withDuration(moovBytes, tkhd, segmentDuration)
  const newMvhd = withDuration(
    moovBytes,
    mvhd,
    movieDurationWith(moovBytes, found, segmentDuration),
  )
  if (!newTkhd || !newMvhd) return null
  const newTrak = rebuild(
    moovBytes,
    trak,
    new Map([[tkhd.start, newTkhd]]),
    new Map([[tkhd.start, editListBox(segmentDuration, mediaTime)]]),
  )
  const patched = rebuild(
    moovBytes,
    moov,
    new Map([
      [mvhd.start, newMvhd],
      [trak.start, newTrak],
    ]),
  )
  const delta = options.moovPrecedesMdat ? patched.byteLength - moov.size : 0
  return shiftChunkOffsets(patched, delta) ? patched : null
}

/** Random access to a finished file. */
export interface IsoBmffFileAccess {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
  /** Replace everything from `offset` to the end of the file with `data`. */
  replaceTail(offset: number, data: Uint8Array<ArrayBuffer>): Promise<void>
}

/**
 * Apply the priming edit to a file whose `moov` is its last top-level box
 * (Mediabunny without fast start). Returns whether the file was changed.
 */
export async function addAudioPrimingEditListToFile(
  file: IsoBmffFileAccess,
  edit: AudioPrimingEdit,
): Promise<boolean> {
  let at = 0
  let moov: { start: number; size: number } | null = null
  let mdatSeen = false
  while (at + 8 <= file.size) {
    const box = readHeaderOnly(await file.read(at, 16), file.size - at)
    if (!box) return false
    if (box.type === 'mdat') mdatSeen = true
    if (box.type === 'moov') moov = { start: at, size: box.size }
    at += box.size
  }
  if (!moov || !mdatSeen || moov.start + moov.size !== file.size) return false
  const patched = patchMoovForAudioPriming(await file.read(moov.start, moov.size), edit, {
    moovPrecedesMdat: false,
  })
  if (!patched) return false
  await file.replaceTail(moov.start, patched)
  return true
}

/** Header of a box whose body is not in `head` (it was read 16 bytes at a time). */
function readHeaderOnly(head: Uint8Array, remaining: number): BoxRef | null {
  if (head.byteLength < 8) return null
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  let size = view.getUint32(0)
  let headerSize = 8
  if (size === 1) {
    if (head.byteLength < 16) return null
    size = Number(view.getBigUint64(8))
    headerSize = 16
  } else if (size === 0) {
    size = remaining
  }
  if (size < headerSize || size > remaining) return null
  return { type: fourcc(head, 4), start: 0, size, headerSize }
}

/** Apply the priming edit to a whole file in memory; null when not applied. */
export function addAudioPrimingEditListToBuffer(
  bytes: Uint8Array,
  edit: AudioPrimingEdit,
): Uint8Array<ArrayBuffer> | null {
  const boxes = listTopLevelBoxes(bytes)
  const moovIndex = boxes.findIndex((box) => box.type === 'moov')
  const mdatIndex = boxes.findIndex((box) => box.type === 'mdat')
  if (moovIndex < 0 || mdatIndex < 0) return null
  const moov = boxes[moovIndex]!
  const patched = patchMoovForAudioPriming(
    bytes.subarray(moov.start, moov.start + moov.size),
    edit,
    { moovPrecedesMdat: moovIndex < mdatIndex },
  )
  if (!patched) return null
  return concat([bytes.subarray(0, moov.start), patched, bytes.subarray(moov.start + moov.size)])
}
