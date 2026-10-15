// The agent service's cutout store (docs/background-removal.md): a small HTTP
// server the harness page uses for background removal.
//
//   GET|PUT /fs/file?path=media/<id>/cache/cutout/...   masks and their index.json
//                                                       (the same API as the editor's
//                                                       workspace bridge, so the page
//                                                       code is shared)
//   GET     /models/<file>                              a cutout model, downloaded once
//                                                       from its pinned URL into
//                                                       <workspace>/app/models/cutout/
//                                                       and checked against its SHA-256
//   PUT     /progress?job=<id>                          job progress from the page
//
// Only loopback, only those paths. CORS is open because the harness page is
// served from another port (and runs cross-origin isolated).
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  CUTOUT_MODELS,
  cutoutModelFileName,
  cutoutModelUrl,
} from '../../src/shared/cutout/cutout-core.mjs'
import { HttpError, sendHttpError, serveFile, setHttpTimeouts } from './http-security.mjs'

const STORE_PATH = /^media\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/cache\/cutout\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/
const MAX_BODY = 64 * 1024 * 1024
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, range',
  'Access-Control-Expose-Headers': 'content-length',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cache-Control': 'no-store',
}

/** A workspace-relative cutout path, or a 400. */
export function cutoutStorePath(workspace, rel) {
  if (typeof rel !== 'string' || !STORE_PATH.test(rel) || rel.split('/').includes('..')) {
    throw new HttpError(400, 'BAD_PATH', 'not a cutout store path')
  }
  return path.join(workspace, ...rel.split('/'))
}

/** The model file a cache file name stands for: { model, backend } or null. */
export function modelForFileName(name) {
  for (const model of Object.values(CUTOUT_MODELS)) {
    for (const backend of ['webgpu', 'wasm']) {
      if (cutoutModelFileName(model, backend) === name) return { model, backend }
    }
  }
  return null
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'TOO_LARGE', 'body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmp, bytes)
  fs.renameSync(tmp, file)
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

/**
 * Download (once) and verify one model file. `fetchImpl` is injectable for tests.
 * Returns the cached file's path.
 */
// Exercised by headless/cutout.test.mjs (fake fetch) and headless/cutout-e2e.mjs (real download)
// fallow-ignore-next-line complexity
export async function ensureModelFile(dir, model, backend, { fetchImpl = fetch, log = () => {} } = {}) {
  const expected = model.files[backend].sha256
  const file = path.join(dir, cutoutModelFileName(model, backend))
  if (fs.existsSync(file)) return file
  fs.mkdirSync(dir, { recursive: true })
  const url = cutoutModelUrl(model, backend)
  log(`cutout: downloading ${model.label} (${(model.files[backend].bytes / 1e6).toFixed(0)} MB) from ${url}`)
  const res = await fetchImpl(url)
  if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status} ${url}`)
  const tmp = `${file}.${process.pid}.download`
  const hash = crypto.createHash('sha256')
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => hash.update(chunk))
  await pipeline(body, fs.createWriteStream(tmp))
  const actual = hash.digest('hex')
  if (actual !== expected) {
    fs.rmSync(tmp, { force: true })
    throw new Error(`${model.label}: SHA-256 mismatch (got ${actual}, expected ${expected})`)
  }
  fs.renameSync(tmp, file)
  log(`cutout: ${model.label} verified (sha256 ${expected.slice(0, 12)}…)`)
  return file
}

/**
 * Start the store on an ephemeral loopback port.
 * @returns {Promise<{ base: string, progress: (job: string) => unknown, close: () => Promise<void> }>}
 */
export async function createCutoutStore({ workspace, log = () => {}, fetchImpl } = {}) {
  const modelDir = path.join(workspace, 'app', 'models', 'cutout')
  const downloads = new Map()
  const progress = new Map()
  const verified = new Set()

  const modelFile = (name) => {
    const found = modelForFileName(name)
    if (!found) throw new HttpError(404, 'NOT_FOUND', 'unknown model')
    if (!downloads.has(name)) {
      const job = (async () => {
        const file = await ensureModelFile(modelDir, found.model, found.backend, { fetchImpl, log })
        // A file left by an earlier run is checked once per service start.
        if (!verified.has(name)) {
          const actual = await sha256File(file)
          if (actual !== found.model.files[found.backend].sha256) {
            fs.rmSync(file, { force: true })
            throw new Error(`${found.model.label}: cached file failed its SHA-256 check; removed`)
          }
          verified.add(name)
        }
        return file
      })()
      downloads.set(name, job)
      job.catch(() => downloads.delete(name))
    }
    return downloads.get(name)
  }

  // Exercised end to end by headless/cutout-e2e.mjs
  // fallow-ignore-next-line complexity
  const fileRoute = async (req, res, url) => {
    const file = cutoutStorePath(workspace, url.searchParams.get('path'))
    if (req.method === 'PUT') {
      writeAtomic(file, await readBody(req))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD')
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'method not allowed')
    await serveFile(req, res, file, {
      contentType: file.endsWith('.json') ? 'application/json' : 'image/png',
    })
  }
  const modelRoute = async (req, res, name) => {
    await serveFile(req, res, await modelFile(name), { contentType: 'application/octet-stream' })
  }
  const progressRoute = async (req, res, url) => {
    progress.set(url.searchParams.get('job') ?? 'render', JSON.parse((await readBody(req)).toString('utf8') || '{}'))
    res.writeHead(204)
    res.end()
  }
  // Service routes; exercised by headless/cutout.test.mjs and headless/cutout-e2e.mjs
  // fallow-ignore-next-line complexity
  const routeFor = (req, url) => {
    if (url.pathname === '/fs/file') return fileRoute
    const model = /^\/models\/([A-Za-z0-9_.-]+)$/.exec(url.pathname)
    if (model && (req.method === 'GET' || req.method === 'HEAD'))
      return (rq, rs) => modelRoute(rq, rs, model[1])
    if (url.pathname === '/progress' && req.method === 'PUT') return progressRoute
    return null
  }

  // Exercised end to end by headless/cutout-e2e.mjs
  // fallow-ignore-next-line complexity
  const server = http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value)
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const route = routeFor(req, url)
      if (!route) throw new HttpError(404, 'NOT_FOUND', 'not found')
      await route(req, res, url)
    } catch (error) {
      sendHttpError(res, error)
    }
  })
  setHttpTimeouts(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base,
    progress: (job) => progress.get(job) ?? null,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
