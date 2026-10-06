import { describe, expect, it } from 'vite-plus/test'
import { opusCodecDelayPatch } from './matroska-opus-codec-delay'

// The first 357 bytes of a Mediabunny WebM export (VP9 + Opus, up to the first
// Cluster): the Opus TrackEntry has CodecDelay 0, SeekPreRoll 6.5 ms and an
// OpusHead with pre-skip 312.
const MEDIABUNNY_WEBM_HEAD =
  '1a45dfa31000001f4286810142f7810142f2810442f381084282847765626d428781024285810218538067040000016458114d9b741000003f4dbb1000000f53ab841c53bb6b53ac8500000163da4dbb1000000f53ab841549a96653ac8500000000474dbb1000000f53ab841654ae6b53ac85000000007b1549a9661000002c2ad7b1830f42404d808a4d6564696162756e6e7957418a4d6564696162756e6e7944898840b0f400000000001654ae6b100000b1ae1000005dd7810173c581018381019c810022b59c83756e648685565f56503963a28c01010002011f03010804010156aa810056bb810023e3838401fca055e01000001eb0820168ba82028055b01000001055b1810155ba810d55bb810155b98101ae1000004ad7810273c581028381029c810022b59c83756e648686415f4f50555363a2934f707573486561640102380180bb000000000056aa810056bb83632ea0e110000009b584473b80009f8102'

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))
const hex = (data: Uint8Array) => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('')
const apply = (head: Uint8Array, patch: { offset: number; bytes: Uint8Array }) => {
  const out = head.slice()
  out.set(patch.bytes, patch.offset)
  return out
}

describe('opusCodecDelayPatch', () => {
  it('sets CodecDelay to the pre-skip and SeekPreRoll to 80 ms without moving anything', () => {
    const head = bytes(MEDIABUNNY_WEBM_HEAD)
    const patch = opusCodecDelayPatch(head)!
    expect(patch).not.toBeNull()
    const audioEntry = MEDIABUNNY_WEBM_HEAD.lastIndexOf('ae1000004a') / 2
    expect(patch.offset).toBe(audioEntry + 5)
    expect(patch.bytes.length).toBe(0x4a)
    const out = hex(apply(head, patch))
    expect(out.length).toBe(MEDIABUNNY_WEBM_HEAD.length)
    // Video track and everything outside the audio TrackEntry unchanged.
    expect(out.slice(0, patch.offset * 2)).toBe(MEDIABUNNY_WEBM_HEAD.slice(0, patch.offset * 2))
    const after = (patch.offset + patch.bytes.length) * 2
    expect(out.slice(after)).toBe(MEDIABUNNY_WEBM_HEAD.slice(after))
    const entry = hex(patch.bytes)
    expect(entry).toContain('56aa83632ea0') // CodecDelay 6 500 000 ns
    expect(entry).toContain('56bb8404c4b400') // SeekPreRoll 80 000 000 ns
    expect(entry).toContain('63a2934f707573486561640102380180bb0000000000') // OpusHead kept
    expect(entry).toContain('8686415f4f505553') // CodecID A_OPUS kept
    expect(entry).toContain('e110000009b584473b80009f8102') // Audio kept
    expect(entry).not.toContain('9c8100') // FlagLacing 0 dropped to make room
    expect(opusCodecDelayPatch(apply(head, patch))).toBeNull()
  })

  it('keeps FlagLacing 1 and gives up SeekPreRoll for the room instead', () => {
    const head = bytes(
      MEDIABUNNY_WEBM_HEAD.replace('9c810022b59c83756e648686', '9c810122b59c83756e648686'),
    )
    const entry = hex(opusCodecDelayPatch(head)!.bytes)
    expect(entry).toContain('9c8101')
    expect(entry).toContain('56aa83632ea0')
    expect(entry).not.toContain('56bb')
    expect(entry.endsWith('ec82' + '0000')).toBe(true) // Void fills the rest
  })

  it('leaves files without an Opus track, or not Matroska, alone', () => {
    const noOpus = bytes(MEDIABUNNY_WEBM_HEAD.replace('415f4f505553', '415f564f5242')) // A_VORB
    expect(opusCodecDelayPatch(noOpus)).toBeNull()
    expect(opusCodecDelayPatch(bytes('0000001c66747970'))).toBeNull()
    expect(opusCodecDelayPatch(bytes(MEDIABUNNY_WEBM_HEAD.slice(0, 400)))).toBeNull()
  })
})
