import { describe, expect, it } from 'vite-plus/test'
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  Input,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import {
  addAudioPrimingEditListToBuffer,
  addAudioPrimingEditListToFile,
  listTopLevelBoxes,
} from './isobmff-audio-priming'

const RATE = 48_000
const PACKETS = 50
const edit = { primingSamples: 2112, presentationSamples: RATE, sampleRate: RATE }

/** An AAC-in-MP4 file as Mediabunny writes it: packets stamped from 0. */
async function muxAac(options: { fastStart: false | 'in-memory'; mov?: boolean }) {
  const target = new BufferTarget()
  const format = options.mov
    ? new MovOutputFormat({ fastStart: options.fastStart })
    : new Mp4OutputFormat({ fastStart: options.fastStart })
  const output = new Output({ format, target })
  const source = new EncodedAudioPacketSource('aac')
  output.addAudioTrack(source)
  await output.start()
  const decoderConfig = {
    codec: 'mp4a.40.2',
    numberOfChannels: 2,
    sampleRate: RATE,
    description: new Uint8Array([0x11, 0x90]),
  }
  for (let i = 0; i < PACKETS; i++) {
    const packet = new EncodedPacket(
      new Uint8Array(40).fill(i),
      'key',
      (i * 1024) / RATE,
      1024 / RATE,
    )
    await source.add(packet, i === 0 ? { decoderConfig } : undefined)
  }
  source.close()
  await output.finalize()
  return new Uint8Array(target.buffer!)
}

async function readBack(bytes: Uint8Array) {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) })
  try {
    const track = (await input.getPrimaryAudioTrack())!
    const packets: number[] = []
    for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet.data[0]!)
    return { firstTimestamp: await track.getFirstTimestamp(), packets }
  } finally {
    input.dispose()
  }
}

/** Version-0 field of a box found by path: mvhd timescale +20 / duration +24, tkhd duration +28. */
function boxField(bytes: Uint8Array, path: string[], offset: number): number {
  let scope = { start: 0, end: bytes.byteLength, header: 0 }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let found = -1
  for (const type of path) {
    found = -1
    for (let at = scope.start + scope.header; at < scope.end; ) {
      const size = view.getUint32(at)
      const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
      if (name === type) {
        found = at
        scope = { start: at, end: at + size, header: 8 }
        break
      }
      at += size
    }
    if (found < 0) throw new Error(`no ${type}`)
  }
  return view.getUint32(found + offset)
}

describe('addAudioPrimingEditListToBuffer', () => {
  it('marks the encoder delay so readers start the audio after the priming', async () => {
    const original = await muxAac({ fastStart: false })
    expect((await readBack(original)).firstTimestamp).toBe(0)

    const patched = addAudioPrimingEditListToBuffer(original, edit)!
    const { firstTimestamp, packets } = await readBack(patched)
    expect(firstTimestamp).toBeCloseTo(-2112 / RATE, 9)
    expect(packets).toEqual(Array.from({ length: PACKETS }, (_, i) => i))
    // Presented length is what was fed to the encoder (1 s), not the padded media.
    const movieTimescale = boxField(patched, ['moov', 'mvhd'], 20)
    expect(boxField(patched, ['moov', 'mvhd'], 24)).toBe(movieTimescale)
    expect(boxField(patched, ['moov', 'trak', 'tkhd'], 28)).toBe(movieTimescale)
  })

  it('moves chunk offsets when moov precedes mdat (fast start)', async () => {
    const original = await muxAac({ fastStart: 'in-memory' })
    const types = listTopLevelBoxes(original).map((box) => box.type)
    expect(types.indexOf('moov')).toBeLessThan(types.indexOf('mdat'))

    const patched = addAudioPrimingEditListToBuffer(original, edit)!
    expect(patched.byteLength).toBe(original.byteLength + 36)
    const { firstTimestamp, packets } = await readBack(patched)
    expect(firstTimestamp).toBeCloseTo(-2112 / RATE, 9)
    expect(packets).toEqual(Array.from({ length: PACKETS }, (_, i) => i))
  })

  it('patches QuickTime MOV the same way', async () => {
    const patched = addAudioPrimingEditListToBuffer(
      await muxAac({ fastStart: false, mov: true }),
      edit,
    )!
    expect((await readBack(patched)).firstTimestamp).toBeCloseTo(-2112 / RATE, 9)
  })

  it('leaves a file that already has an audio edit list alone', async () => {
    const once = addAudioPrimingEditListToBuffer(await muxAac({ fastStart: false }), edit)!
    expect(addAudioPrimingEditListToBuffer(once, edit)).toBeNull()
    expect(addAudioPrimingEditListToBuffer(new Uint8Array(16), edit)).toBeNull()
  })
})

describe('addAudioPrimingEditListToFile', () => {
  it('rewrites only the trailing moov of a file, like the buffer patch', async () => {
    const original = await muxAac({ fastStart: false })
    let file = original
    const changed = await addAudioPrimingEditListToFile(
      {
        size: file.byteLength,
        read: async (offset, length) => file.slice(offset, offset + length),
        replaceTail: async (offset, data) => {
          const next = new Uint8Array(offset + data.byteLength)
          next.set(file.subarray(0, offset))
          next.set(data, offset)
          file = next
        },
      },
      edit,
    )
    expect(changed).toBe(true)
    expect(file).toEqual(addAudioPrimingEditListToBuffer(original, edit))
  })

  it('does nothing when moov is not the last box', async () => {
    const original = await muxAac({ fastStart: 'in-memory' })
    const changed = await addAudioPrimingEditListToFile(
      {
        size: original.byteLength,
        read: async (offset, length) => original.slice(offset, offset + length),
        replaceTail: async () => {
          throw new Error('must not write')
        },
      },
      edit,
    )
    expect(changed).toBe(false)
  })
})
