import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHUNK_CHARS,
  chunkScript,
  concatWavs,
  parseTtsArgs,
  parseWav,
  scratchFileName,
  splitSentences,
  wavDurationSeconds,
} from '../skills/shreditor-edit/scripts/tts.mjs'

const speak = (opt, rest = []) => parseTtsArgs(rest, opt, { readFile: (f) => `script from ${f}` })

test('tts voices takes an optional engine', () => {
  assert.deepEqual(speak({}, ['voices']), { mode: 'voices', engine: null, json: false })
  assert.deepEqual(speak({ engine: 'moss', json: true }, ['voices']), {
    mode: 'voices',
    engine: 'moss',
    json: true,
  })
  assert.throws(() => speak({ engine: 'kokoro' }, ['voices']), /--engine must be one of supertonic, moss/)
  assert.throws(() => speak({}, ['voices', 'extra']), /Usage: shred tts voices/)
})

test('tts fills the engine defaults', () => {
  assert.deepEqual(speak({ project: 'p1', text: '  Hello there.  ' }), {
    mode: 'speak',
    project: 'p1',
    text: 'Hello there.',
    engine: 'supertonic',
    voice: 'M3',
    language: 'auto',
    speed: 1,
    name: null,
    json: false,
  })
  const moss = speak({ project: 'p1', text: 'Hi.', engine: 'moss', speed: '1.5', name: 'intro' })
  assert.equal(moss.voice, 'Ava')
  assert.equal(moss.speed, 1.5)
  assert.equal(moss.name, 'intro')
  assert.ok(!('language' in moss), 'MOSS has no language option')
  assert.equal(speak({ project: 'p1', file: 'vo.txt' }).text, 'script from vo.txt')
})

test('tts refuses what it cannot do, saying why', () => {
  assert.throws(() => speak({ text: 'Hi' }), /Pass --project <id>/)
  assert.throws(() => speak({ project: 'p' }), /exactly one of --text or --file/)
  assert.throws(
    () => speak({ project: 'p', text: 'a', file: 'b.txt' }),
    /exactly one of --text or --file/,
  )
  assert.throws(() => speak({ project: 'p', text: '   ' }), /script is empty/)
  assert.throws(() => speak({ project: 'p', text: 'Hi', voice: 'Ava' }), /--voice: voice must be one of F1/)
  assert.throws(
    () => speak({ project: 'p', text: 'Hi', engine: 'moss', language: 'en' }),
    /--language: .*takes its language from the text/,
  )
  assert.throws(() => speak({ project: 'p', text: 'Hi', language: 'xx' }), /--language: language must be one of auto, en/)
  assert.throws(() => speak({ project: 'p', text: 'Hi', speed: '2' }), /--speed: speed must be between 0.8 and 1.3/)
  assert.throws(() => speak({ project: 'p', text: 'Hi', speed: 'fast' }), /--speed must be a number/)
  assert.throws(() => speak({ project: 'p', plan: 'x' }), /Plans carry no voiceover text/)
  assert.throws(() => speak({ project: 'p', text: 'Hi' }, ['lines']), /Unknown: shred tts lines/)
})

test('sentences split at their ends, not inside abbreviations, numbers or quotes', () => {
  assert.deepEqual(
    splitSentences('Dr. Smith paid 3.5 dollars. Wow! "Really?" she asked. See e.g. this one… 今日は。明日も！'),
    [
      'Dr. Smith paid 3.5 dollars.',
      'Wow!',
      '"Really?" she asked.',
      'See e.g. this one…',
      '今日は。',
      '明日も！',
    ],
  )
})

test('chunkScript packs sentences up to the limit and marks paragraph ends', () => {
  const chunks = chunkScript('One two. Three four.\nFive six\n\n\nNew paragraph here.', {
    maxChars: 22,
  })
  assert.deepEqual(chunks, [
    { text: 'One two. Three four.', paragraphEnd: false },
    { text: 'Five six.', paragraphEnd: true },
    { text: 'New paragraph here.', paragraphEnd: true },
  ])
})

test('chunkScript splits a long sentence at clauses, then words, never over the limit', () => {
  const sentence = `${'word '.repeat(30).trim()}, ${'more '.repeat(30).trim()}.`
  const chunks = chunkScript(sentence, { maxChars: 80 })
  assert.ok(chunks.length > 2)
  for (const chunk of chunks) assert.ok(chunk.text.length <= 80, chunk.text)
  assert.equal(chunks.map((c) => c.text).join(' '), sentence)
  const blob = chunkScript('x'.repeat(250), { maxChars: 100 })
  assert.deepEqual(
    blob.map((c) => c.text.length),
    [100, 100, 51],
    'a line with no end punctuation gets a period',
  )
})

test('chunkScript keeps a short script in one request, and the default fits the service', () => {
  assert.deepEqual(chunkScript('Just one line'), [{ text: 'Just one line.', paragraphEnd: true }])
  assert.deepEqual(chunkScript(' \n\n '), [])
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
  for (const chunk of chunkScript(long)) assert.ok(chunk.text.length <= CHUNK_CHARS)
})

function wav({ samples, sampleRate = 8000, channels = 1, float = false }) {
  const bytes = float ? 4 : 2
  const data = Buffer.alloc(samples.length * bytes)
  samples.forEach((v, i) =>
    float ? data.writeFloatLE(v, i * 4) : data.writeInt16LE(Math.round(v * 32767), i * 2),
  )
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(float ? 3 : 1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * bytes, 28)
  header.writeUInt16LE(channels * bytes, 32)
  header.writeUInt16LE(bytes * 8, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

test('concatWavs joins same-format WAVs with silence between, none after the last', () => {
  const a = wav({ samples: new Array(800).fill(0.5) })
  const b = wav({ samples: new Array(400).fill(-0.5) })
  const joined = parseWav(concatWavs([a, b, a], [0.1, 0.25, 9]))
  assert.equal(joined.audioFormat, 1)
  assert.equal(joined.sampleRate, 8000)
  assert.equal(joined.data.length / 2, 800 + 800 + 400 + 2000 + 800)
  assert.equal(joined.data.readInt16LE(800 * 2), 0, 'the gap is silent')
  assert.equal(wavDurationSeconds(joined), 4800 / 8000)
})

test('concatWavs keeps 32-bit float stereo, and refuses mixed formats', () => {
  const f = wav({ samples: [0.25, -0.25, 0.5, -0.5], channels: 2, float: true, sampleRate: 48000 })
  const joined = parseWav(concatWavs([f, f], [0]))
  assert.deepEqual(
    [joined.audioFormat, joined.channels, joined.bitsPerSample, joined.data.readFloatLE(4)],
    [3, 2, 32, -0.25],
  )
  assert.throws(() => concatWavs([f, wav({ samples: [0] })]), /different formats/)
  assert.throws(() => parseWav(Buffer.from('not a wav at all, clearly')), /not a WAV/)
})

test('scratch file names say what they are', () => {
  const at = new Date('2026-10-15T09:08:07Z')
  assert.equal(
    scratchFileName({ name: null, text: 'We drove up the coast at dawn, before', engine: 'supertonic', voice: 'M3' }, at),
    'scratch-vo-we-drove-up-the-coast-at-supertonic-m3-20261015-090807.wav',
  )
  assert.equal(
    scratchFileName({ name: 'Hook / take 2', text: 'x', engine: 'moss', voice: 'Ava' }, at),
    'scratch-vo-hook-take-2-moss-ava-20261015-090807.wav',
  )
})
