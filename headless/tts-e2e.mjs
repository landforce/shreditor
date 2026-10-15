// End to end: `shred tts` against a real service (headless Chrome, the built
// harness), with Supertonic, the fastest engine (WebGPU when the machine has it).
//
// Gated: the first run downloads ~400 MB of model weights, so it only runs with
// FREECUT_TTS_E2E=1 (npm run headless:test:tts). The weights land in the model
// cache ($SHREDITOR_MODEL_CACHE, else ~/.shreditor/models) and later runs reuse
// them. Needs `npm run build` first. Uses a temp workspace and a random port.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

if (process.env.FREECUT_TTS_E2E !== '1') {
  console.log('tts e2e skipped: set FREECUT_TTS_E2E=1 to run it (downloads ~400 MB once)')
  process.exit(0)
}

const root = path.resolve(import.meta.dirname, '..')
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-tts-e2e-'))
const port = 20_000 + Math.floor(Math.random() * 20_000)
const service = `http://127.0.0.1:${port}`

const child = spawn(
  process.execPath,
  ['headless/serve.mjs', '--workspace', workspace, '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
)
let serviceLog = ''
child.stdout.on('data', (chunk) => (serviceLog += chunk))
child.stderr.on('data', (chunk) => (serviceLog += chunk))

const shred = (args) => {
  const result = spawnSync(
    process.execPath,
    ['skills/shreditor-edit/scripts/shred.mjs', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SHRED_WORKSPACE: workspace,
        SHRED_SERVICE: service,
        // No editor here: nothing to start, transcripts wait in the queue.
        SHRED_EDITOR: `http://localhost:${port + 1}`,
        SHRED_AUTOSTART: '0',
      },
    },
  )
  assert.equal(result.status, 0, `${result.stderr}\n${serviceLog}`)
  return result.stdout
}

try {
  let ready = false
  for (let attempt = 0; attempt < 120 && !ready; attempt++) {
    ready = await fetch(`${service}/health`).then(
      (r) => r.ok,
      () => false,
    )
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.equal(ready, true, serviceLog)

  const created = await fetch(`${service}/v1/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'tts-e2e' },
    body: JSON.stringify({ id: 'ttsdemo', name: 'TTS demo' }),
  })
  assert.equal(created.status, 201)

  const t0 = Date.now()
  const result = JSON.parse(
    shred([
      'tts',
      '--project',
      'ttsdemo',
      '--text',
      // Two paragraphs: two requests, joined with a pause.
      'This is a scratch voiceover.\n\nIt times the cut until the real one is recorded.',
      '--voice',
      'F1',
      '--json',
    ]),
  )
  console.log(`shred tts: ${JSON.stringify(result)} (${Date.now() - t0}ms)`)
  assert.match(result.mediaId, /^[0-9a-f-]{36}$/)
  assert.ok(result.duration > 1 && result.duration < 20, `duration ${result.duration}`)
  assert.ok(['webgpu', 'wasm'].includes(result.backend), result.backend)
  assert.equal(result.chunks, 2)
  assert.equal(result.category, 'voiceover')

  const metadata = JSON.parse(
    fs.readFileSync(path.join(workspace, 'media', result.mediaId, 'metadata.json'), 'utf8'),
  )
  assert.equal(metadata.mimeType, 'audio/wav')
  assert.ok(Math.abs(metadata.duration - result.duration) < 0.05)
  assert.equal(metadata.generated.kind, 'tts')
  assert.equal(metadata.generated.scratch, true)
  assert.equal(metadata.generated.voice, 'F1')
  assert.ok(metadata.tags.includes('scratch-tts'))
  const links = JSON.parse(
    fs.readFileSync(path.join(workspace, 'projects', 'ttsdemo', 'media-links.json'), 'utf8'),
  )
  assert.ok(links.mediaIds.some((entry) => entry.id === result.mediaId))
  console.log('tts e2e passed')
} finally {
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
  fs.rmSync(workspace, { recursive: true, force: true })
}
