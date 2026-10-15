import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { capabilities, ContractValidationError, validate } from './lib/contract.mjs'
import {
  TTS_ENGINES,
  TTS_MAX_TEXT_CHARS,
  resolveTtsRequest,
  ttsRequestSchema,
} from './lib/tts-contract.mjs'
import {
  cachePathFor,
  createModelCacheServer,
  isModelHostUrl,
  modelCacheDir,
} from './lib/tts-model-cache.mjs'

const fieldsOf = (body) => {
  try {
    validate(ttsRequestSchema, body)
  } catch (error) {
    assert.ok(error instanceof ContractValidationError)
    return error.fields.map((f) => `${f.path}: ${f.message}`)
  }
  return []
}

test('POST /v1/tts is listed in capabilities with its engines, voices and schema', () => {
  const caps = capabilities()
  assert.ok(caps.lifecycle.routes.includes('POST /v1/tts'))
  assert.equal(caps.tts.route, 'POST /v1/tts')
  assert.equal(caps.tts.defaultEngine, 'supertonic')
  assert.equal(caps.tts.voiceCloning, false)
  assert.deepEqual(Object.keys(caps.tts.engines), ['supertonic', 'moss'])
  for (const [id, spec] of Object.entries(TTS_ENGINES))
    assert.deepEqual(caps.tts.engines[id], {
      voices: spec.voices.map((v) => v.id),
      defaultVoice: spec.defaultVoice,
      languages: spec.languages,
      speed: spec.speed,
      expressiveTags: spec.expressiveTags,
      backends: spec.backends,
    })
  assert.equal(caps.tts.engines.supertonic.defaultVoice, 'M3')
  assert.equal(caps.tts.engines.moss.defaultVoice, 'Ava')
  assert.deepEqual(caps.schemas.tts.properties.engine.enum, ['supertonic', 'moss'])
  assert.equal(caps.schemas.tts.additionalProperties, false)
  // Every engine's default voice is one of its voices.
  for (const spec of Object.values(TTS_ENGINES))
    assert.ok(spec.voices.some((v) => v.id === spec.defaultVoice))
})

test('a tts request fills the engine defaults', () => {
  assert.deepEqual(resolveTtsRequest(validate(ttsRequestSchema, { text: ' Hi. ' })), {
    text: 'Hi.',
    engine: 'supertonic',
    voice: 'M3',
    language: 'auto',
    speed: 1,
  })
  assert.deepEqual(
    resolveTtsRequest(validate(ttsRequestSchema, { text: 'Hi', engine: 'moss', speed: 2 })),
    { text: 'Hi', engine: 'moss', voice: 'Ava', speed: 2 },
  )
})

test('a tts request is checked against its engine', () => {
  assert.deepEqual(fieldsOf({ text: 'Hi', voice: 'F1', language: 'fr', speed: 1.3 }), [])
  assert.match(fieldsOf({ text: '' })[0], /^text: /)
  assert.match(fieldsOf({ text: 'x'.repeat(TTS_MAX_TEXT_CHARS + 1) })[0], /^text: /)
  assert.match(fieldsOf({ text: 'Hi', engine: 'kokoro' })[0], /^engine: /)
  assert.deepEqual(fieldsOf({ text: 'Hi', voice: 'Ava' }), [
    'voice: voice must be one of F1, F2, F3, F4, F5, M1, M2, M3, M4, M5',
  ])
  assert.match(fieldsOf({ text: 'Hi', engine: 'moss', voice: 'M3' })[0], /^voice: .*Junhao/)
  assert.deepEqual(fieldsOf({ text: 'Hi', engine: 'moss', language: 'en' }), [
    'language: MOSS Nano (multilingual) takes its language from the text: leave language out',
  ])
  assert.deepEqual(fieldsOf({ text: 'Hi', speed: 0.5 }), ['speed: speed must be between 0.8 and 1.3'])
  assert.deepEqual(fieldsOf({ text: 'Hi', engine: 'moss', speed: 0.5 }), [])
  assert.match(fieldsOf({ text: 'Hi', clone: 'me.wav' })[0], /Unrecognized key/)
})

test('the model cache lives in ~/.shreditor/models unless SHREDITOR_MODEL_CACHE says', () => {
  assert.equal(modelCacheDir({}), path.join(os.homedir(), '.shreditor', 'models'))
  assert.equal(modelCacheDir({ SHREDITOR_MODEL_CACHE: '/tmp/m' }), path.resolve('/tmp/m'))
  assert.equal(isModelHostUrl('https://huggingface.co/a/resolve/main/x.onnx'), true)
  assert.equal(isModelHostUrl('http://huggingface.co/x'), false)
  assert.equal(isModelHostUrl('https://cdn.jsdelivr.net/x.wasm'), false)
  assert.equal(isModelHostUrl('not a url'), false)
  const a = cachePathFor('/c', 'https://huggingface.co/r/resolve/main/model.onnx?download=1')
  assert.match(a, /^\/c\/huggingface\.co\/[0-9a-f]{24}-model\.onnx$/)
  assert.notEqual(a, cachePathFor('/c', 'https://huggingface.co/r/resolve/main/model.onnx'))
})

test('the model cache server downloads once, then serves from disk', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-model-cache-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const upstream = []
  const fetchImpl = async (url) => {
    upstream.push(url)
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (url.endsWith('missing.onnx')) return new Response('nope', { status: 404 })
    return new Response(`bytes of ${url}`, { headers: { 'content-type': 'application/x-onnx' } })
  }
  const cache = await createModelCacheServer({ dir, fetchImpl })
  t.after(() => cache.close())
  const model = 'https://huggingface.co/r/resolve/main/model.onnx'

  // Two requests racing on a cold file share one download.
  const [first, second] = await Promise.all([fetch(cache.urlFor(model)), fetch(cache.urlFor(model))])
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('access-control-allow-origin'), '*')
  assert.equal(first.headers.get('cross-origin-resource-policy'), 'cross-origin')
  assert.equal(first.headers.get('content-type'), 'application/x-onnx')
  assert.equal(await first.text(), `bytes of ${model}`)
  assert.equal(await second.text(), `bytes of ${model}`)
  assert.deepEqual(upstream, [model])

  // A new server on the same folder (the next service run) needs no download.
  const next = await createModelCacheServer({ dir, fetchImpl })
  t.after(() => next.close())
  assert.equal(await (await fetch(next.urlFor(model))).text(), `bytes of ${model}`)
  assert.deepEqual(upstream, [model])
  assert.deepEqual(next.stats, { hits: 1, misses: 0, downloadedBytes: 0 })

  // Upstream errors pass through and are not cached; other hosts are refused.
  const missing = 'https://huggingface.co/r/resolve/main/missing.onnx'
  assert.equal((await fetch(cache.urlFor(missing))).status, 404)
  assert.equal(fs.existsSync(cachePathFor(dir, missing)), false)
  assert.equal((await fetch(cache.urlFor('https://example.com/x'))).status, 404)
  assert.equal((await fetch(`${cache.base}/model`, { method: 'OPTIONS' })).status, 204)
})
