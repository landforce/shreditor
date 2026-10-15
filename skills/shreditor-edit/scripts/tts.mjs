// `shred tts`: a scratch voiceover from a script, with the editor's own local
// TTS engines (Supertonic, MOSS) running in the agent service's page
// (POST /v1/tts). The WAV is saved under the project's agent/tts/ folder and
// imported like any file (`shreditor import`: metadata, waveform, transcript),
// as category voiceover, marked in its metadata as generated scratch TTS
// (`generated: { kind: 'tts', scratch: true, engine, voice, text, ... }`, tags
// `scratch-tts`). It is a placeholder for a recorded VO, never the final one.
//
// Long scripts are split by sentence (a blank line ends a paragraph, a line
// break ends a sentence) into requests of at most CHUNK_CHARS characters,
// spoken one after another and joined with a short pause.
//
// Plans (agent/plan.json) carry no voiceover text: a story beat's `sound` is a
// note, and a performance plan's lines are the speaker's recorded take. So
// there is no per-beat mode; pass each line with --text when you need clips
// per line.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {
  DEFAULT_TTS_ENGINE,
  TTS_ENGINES,
  TTS_ENGINE_IDS,
  TTS_MAX_TEXT_CHARS,
  ttsRequestSchema,
} from '../../../headless/lib/tts-contract.mjs'

/** Characters per request: well under the service's limit, short enough to report progress. */
export const CHUNK_CHARS = 600
const GAP_SECONDS = 0.3
const PARAGRAPH_GAP_SECONDS = 0.6

const ABBREVIATIONS =
  /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Ave|Blvd|Inc|Ltd|Co|Corp|vs|etc|e\.g|i\.e|Ph\.D)|\b[A-Z])\.$/

/** A paragraph's sentences: split after . ! ? … (and CJK enders), keeping abbreviations whole. */
export function splitSentences(paragraph) {
  const out = []
  let current = ''
  // After . ! ? … (a closing quote or bracket may follow) and whitespace; after
  // a CJK ender at once (no spaces there). "3.5" and "U.S.A" stay whole, and a
  // lowercase word after the break continues the sentence ("Why?" she asked.).
  const parts = paragraph.split(/(?<=[.!?…]["'”’)\]]?)\s+|(?<=[。！？])/u)
  for (const [index, part] of parts.entries()) {
    current = current ? `${current}${/[。！？]$/u.test(current) ? '' : ' '}${part}` : part
    if (ABBREVIATIONS.test(current) || !/[.!?…。！？]["'”’)\]]*$/u.test(current)) continue
    if (/^\p{Ll}/u.test(parts[index + 1] ?? '')) continue
    out.push(current.trim())
    current = ''
  }
  if (current.trim()) out.push(current.trim())
  return out.filter(Boolean)
}

/** A sentence over `maxChars`: at clause punctuation, then between words, then hard. */
function splitLong(sentence, maxChars) {
  const pieces = []
  let current = ''
  const push = (piece) => {
    const candidate = current ? `${current} ${piece}` : piece
    if (candidate.length <= maxChars) current = candidate
    else {
      if (current) pieces.push(current)
      current = piece
    }
  }
  for (const clause of sentence.split(/(?<=[,;:—–])\s+/u)) {
    if (clause.length <= maxChars) push(clause)
    else
      for (const word of clause.split(/\s+/)) {
        if (word.length <= maxChars) push(word)
        else for (let i = 0; i < word.length; i += maxChars) push(word.slice(i, i + maxChars))
      }
  }
  if (current) pieces.push(current)
  return pieces
}

/**
 * The script as requests: [{ text, paragraphEnd }], each at most `maxChars`.
 * A blank line ends a paragraph (a longer pause), a line break ends a sentence
 * (a period is added when the line has no end punctuation), and sentences are
 * packed together up to `maxChars`.
 */
export function chunkScript(text, { maxChars = CHUNK_CHARS } = {}) {
  const paragraphs = String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((line) => (/[.!?…。！？,;:"'”’)\]]$/u.test(line) ? line : `${line}.`))
        .join(' '),
    )
    .filter(Boolean)
  const chunks = []
  for (const paragraph of paragraphs) {
    let current = ''
    const flush = () => {
      if (current) chunks.push({ text: current, paragraphEnd: false })
      current = ''
    }
    for (const sentence of splitSentences(paragraph)) {
      for (const piece of sentence.length > maxChars ? splitLong(sentence, maxChars) : [sentence]) {
        const candidate = current ? `${current} ${piece}` : piece
        if (candidate.length <= maxChars) current = candidate
        else {
          flush()
          current = piece
        }
      }
    }
    flush()
    if (chunks.length) chunks.at(-1).paragraphEnd = true
  }
  return chunks
}

/** A RIFF/WAVE file's format and sample data (PCM 16-bit or 32-bit float, as the engines write). */
export function parseWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a WAV file')
  let format = null
  let data = null
  for (let at = 12; at + 8 <= buffer.length; ) {
    const id = buffer.toString('ascii', at, at + 4)
    const size = buffer.readUInt32LE(at + 4)
    const body = at + 8
    if (id === 'fmt ')
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      }
    if (id === 'data') data = buffer.subarray(body, Math.min(buffer.length, body + size))
    at = body + size + (size % 2)
  }
  if (!format || !data) throw new Error('WAV without fmt or data chunk')
  return { ...format, data }
}

export const wavDurationSeconds = (wav) => wav.data.length / wav.blockAlign / wav.sampleRate

/** One WAV from several of the same format, with `gaps[i]` seconds of silence after part i. */
export function concatWavs(buffers, gaps = []) {
  const parts = buffers.map(parseWav)
  const [first] = parts
  for (const part of parts)
    if (
      part.audioFormat !== first.audioFormat ||
      part.channels !== first.channels ||
      part.sampleRate !== first.sampleRate ||
      part.bitsPerSample !== first.bitsPerSample
    )
      throw new Error('cannot join WAVs of different formats')
  const pieces = []
  parts.forEach((part, index) => {
    pieces.push(part.data)
    const gap = index < parts.length - 1 ? (gaps[index] ?? 0) : 0
    if (gap > 0) pieces.push(Buffer.alloc(Math.round(gap * first.sampleRate) * first.blockAlign))
  })
  const data = Buffer.concat(pieces)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(first.audioFormat, 20)
  header.writeUInt16LE(first.channels, 22)
  header.writeUInt32LE(first.sampleRate, 24)
  header.writeUInt32LE(first.sampleRate * first.blockAlign, 28)
  header.writeUInt16LE(first.blockAlign, 32)
  header.writeUInt16LE(first.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const USAGE =
  'Usage: shred tts voices [--engine supertonic|moss] [--json]\n' +
  '       shred tts --project <id> (--text "..." | --file script.txt) [--engine supertonic|moss] [--voice v] [--speed x] [--language code] [--name label] [--json]'

/** `shred tts` arguments, checked: { mode: 'voices', engine? } or { mode: 'speak', ... }. */
export function parseTtsArgs(rest, opt, { readFile = (file) => fs.readFileSync(file, 'utf8') } = {}) {
  const [sub, ...extra] = rest
  if (opt.engine !== undefined && !TTS_ENGINE_IDS.includes(opt.engine))
    throw new Error(`--engine must be one of ${TTS_ENGINE_IDS.join(', ')}\n${USAGE}`)
  if (sub === 'voices') {
    if (extra.length) throw new Error(USAGE)
    return { mode: 'voices', engine: opt.engine ?? null, json: Boolean(opt.json) }
  }
  if (sub !== undefined) throw new Error(`Unknown: shred tts ${sub}\n${USAGE}`)
  if (opt.plan !== undefined)
    throw new Error(
      "Plans carry no voiceover text (a beat's `sound` is a note, a performance's lines are the speaker's take): pass the script with --text or --file",
    )
  if (!opt.project) throw new Error(`Pass --project <id>\n${USAGE}`)
  if ((opt.text === undefined) === (opt.file === undefined))
    throw new Error(`Pass the script with exactly one of --text or --file\n${USAGE}`)
  const text = (opt.text ?? readFile(opt.file)).trim()
  if (!text) throw new Error('The script is empty')
  const engine = opt.engine ?? DEFAULT_TTS_ENGINE
  const spec = TTS_ENGINES[engine]
  const speed = opt.speed === undefined ? undefined : Number(opt.speed)
  if (opt.speed !== undefined && !Number.isFinite(speed))
    throw new Error(`--speed must be a number (${spec.speed.min} to ${spec.speed.max})`)
  // The service's own contract decides voice, language and speed.
  const checked = ttsRequestSchema.safeParse({
    text: text.slice(0, TTS_MAX_TEXT_CHARS),
    engine,
    ...(opt.voice !== undefined ? { voice: opt.voice } : {}),
    ...(opt.language !== undefined ? { language: opt.language } : {}),
    ...(speed !== undefined ? { speed } : {}),
  })
  if (!checked.success)
    throw new Error(
      checked.error.issues.map((i) => `--${i.path.join('.') || 'text'}: ${i.message}`).join('\n'),
    )
  return {
    mode: 'speak',
    project: opt.project,
    text,
    engine,
    voice: opt.voice ?? spec.defaultVoice,
    ...(spec.languages.length ? { language: opt.language ?? 'auto' } : {}),
    speed: speed ?? spec.speed.default,
    name: opt.name ?? null,
    json: Boolean(opt.json),
  }
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'vo'

/** The WAV's name: scratch-vo-<label or first words>-<engine>-<voice>-<time>.wav. */
export function scratchFileName({ name, text, engine, voice }, now = new Date()) {
  const label = slug(name ?? text.split(/\s+/).slice(0, 6).join(' '))
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `scratch-vo-${label}-${engine}-${voice.toLowerCase()}-${stamp}.wav`
}

/** POST /v1/tts without a client-side deadline (a first run downloads the model). */
function postTts(service, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body))
    const req = http.request(
      new URL('/v1/tts', service),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': payload.length },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          if (res.statusCode !== 200) {
            let message = `HTTP ${res.statusCode}`
            try {
              const e = JSON.parse(buffer.toString('utf8')).error ?? {}
              const fields = (e.fields ?? []).map((f) => `\n  ${f.path}: ${f.message}`).join('')
              message = `${e.code ?? res.statusCode} ${e.message ?? ''}${fields}`
            } catch {}
            reject(new Error(`POST /v1/tts: ${message}`))
            return
          }
          let info = {}
          try {
            info = JSON.parse(res.headers['x-freecut-tts'] ?? '{}')
          } catch {}
          resolve({ wav: buffer, info })
        })
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

function printVoices({ engine, json }, say) {
  const engines = engine ? { [engine]: TTS_ENGINES[engine] } : TTS_ENGINES
  if (json) return say(JSON.stringify({ defaultEngine: DEFAULT_TTS_ENGINE, engines }, null, 2))
  for (const [id, spec] of Object.entries(engines)) {
    say(
      `${id}  ${spec.label}${id === DEFAULT_TTS_ENGINE ? '  (default engine)' : ''}  runs on ${spec.backends.join(' or ')}, first run downloads ~${Math.round(spec.downloadBytes / 1e6)} MB`,
    )
    say(`  speed ${spec.speed.min}-${spec.speed.max} (default ${spec.speed.default})`)
    say(
      spec.languages.length
        ? `  --language ${spec.languages.join(', ')}`
        : `  language from the text (${spec.spokenLanguages.join(', ')})`,
    )
    if (spec.expressiveTags.length)
      say(`  expressive tags, inline in the text: ${spec.expressiveTags.join(' ')}`)
    for (const voice of spec.voices)
      say(`  ${voice.id.padEnd(8)} ${voice.label}${voice.id === spec.defaultVoice ? '  (default)' : ''}`)
    say()
  }
  say('Preset voices only (no cloning). Generated VO is scratch: a placeholder, never the final.')
}

/**
 * `shred tts ...`. deps: { opt, say, warn, workspace, service, editor, repo, getProject }.
 * getProject checks the project and starts the service when it isn't answering.
 */
export async function ttsCommand(rest, deps) {
  const { say, warn = (line) => process.stderr.write(`${line}\n`) } = deps
  const args = parseTtsArgs(rest, deps.opt)
  if (args.mode === 'voices') return printVoices(args, say)

  await deps.getProject(args.project)
  const chunks = chunkScript(args.text)
  const wavs = []
  let backend = null
  const t0 = Date.now()
  for (const [index, chunk] of chunks.entries()) {
    const { wav, info } = await postTts(deps.service, {
      text: chunk.text,
      engine: args.engine,
      voice: args.voice,
      ...(args.language ? { language: args.language } : {}),
      speed: args.speed,
    })
    backend ??= info.backend ?? null
    wavs.push(wav)
    if (chunks.length > 1 || !args.json)
      warn(
        `tts ${index + 1}/${chunks.length}  ${(info.durationSeconds ?? wavDurationSeconds(parseWav(wav))).toFixed(2)}s  ${args.engine}/${args.voice} on ${info.backend ?? '?'}  (${chunk.text.length} chars)`,
      )
  }
  const joined =
    wavs.length === 1
      ? wavs[0]
      : concatWavs(
          wavs,
          chunks.map((c) => (c.paragraphEnd ? PARAGRAPH_GAP_SECONDS : GAP_SECONDS)),
        )
  const duration = wavDurationSeconds(parseWav(joined))

  const dir = path.join(deps.workspace, 'projects', args.project, 'agent', 'tts')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, scratchFileName(args))
  fs.writeFileSync(file, joined)
  const spec = TTS_ENGINES[args.engine]
  const provenance = {
    generated: {
      kind: 'tts',
      scratch: true,
      tool: 'shred tts',
      engine: args.engine,
      model: spec.model,
      voice: args.voice,
      voiceLabel: spec.voices.find((v) => v.id === args.voice)?.label ?? args.voice,
      ...(args.language ? { language: args.language } : {}),
      speed: args.speed,
      backend,
      chunks: chunks.length,
      text: args.text,
      createdAt: new Date().toISOString(),
    },
    tags: ['ai-generated', 'scratch-tts', `tts-engine:${args.engine}`, `${args.engine}-voice:${args.voice}`],
  }
  const sidecar = file.replace(/\.wav$/, '.json')
  fs.writeFileSync(sidecar, `${JSON.stringify(provenance, null, 2)}\n`)

  // The normal import: metadata, waveform, project link, background transcript.
  const imported = spawnSync(
    process.execPath,
    [
      path.join(deps.repo, 'bin/shreditor.mjs'),
      'import',
      file,
      '--project',
      args.project,
      '--category',
      'voiceover',
      '--generated',
      sidecar,
      '--json',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SHREDITOR_WORKSPACE: deps.workspace,
        SHREDITOR_PORT: new URL(deps.editor).port,
      },
    },
  )
  const lines = (imported.stdout ?? '').trim().split('\n')
  let media = null
  try {
    media = JSON.parse(lines.at(-1)).media[0]
  } catch {}
  if (imported.status || !media?.id)
    throw new Error(
      `import failed for ${file}: ${media?.error ?? imported.stderr?.trim() ?? imported.stdout}`,
    )
  const notes = lines.slice(0, -1).filter(Boolean)
  const result = {
    mediaId: media.id,
    fileName: media.fileName,
    file,
    duration: Number(duration.toFixed(3)),
    engine: args.engine,
    voice: args.voice,
    ...(args.language ? { language: args.language } : {}),
    speed: args.speed,
    backend,
    chunks: chunks.length,
    category: media.category,
    transcription: media.transcription,
    generationMs: Date.now() - t0,
    scratch: true,
  }
  if (args.json) return say(JSON.stringify(result, null, 2))
  for (const line of notes) say(line)
  say(
    `${result.mediaId}  ${result.duration.toFixed(2)}s  ${args.engine}/${args.voice} on ${backend ?? '?'}  [voiceover, scratch TTS]  ${media.fileName}`,
  )
  say(
    'Scratch VO: a placeholder for timing the cut. Say so in summary.md and the hand-over; never present it as the final voiceover.',
  )
}
