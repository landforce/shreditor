// On-disk model cache for the TTS engines the harness page runs.
//
// The editor keeps ONNX weights in the browser's Cache Storage (Supertonic,
// src/shared/utils/onnx-model-cache.ts) and OPFS (MOSS). The agent service's
// Chrome runs on a fresh, throwaway profile, so both are empty on every start
// and each run would download hundreds of MB again. Instead, the page's
// requests to the model hosts are answered from files on disk: a request to
// huggingface.co is redirected to a loopback server that serves the cached file,
// downloading it once on a miss. The page code is unchanged (it still fetches
// the Hugging Face URL and caches the bytes its own way for the session).
//
// Cache folder: $SHREDITOR_MODEL_CACHE, else ~/.shreditor/models. Files are
// keyed by the sha256 of their URL; delete the folder to re-download.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Hosts whose GETs are cached (model weights, configs, voice styles, repo listings). */
const MODEL_HOSTS = ['huggingface.co']

export function modelCacheDir(env = process.env) {
  return env.SHREDITOR_MODEL_CACHE
    ? path.resolve(env.SHREDITOR_MODEL_CACHE)
    : path.join(os.homedir(), '.shreditor', 'models')
}

/** The cached file for a URL: <dir>/<host>/<sha256 of the URL>-<last path segment>. */
export function cachePathFor(dir, url) {
  const parsed = new URL(url)
  const hash = crypto.createHash('sha256').update(parsed.href).digest('hex')
  const base = (parsed.pathname.split('/').filter(Boolean).at(-1) ?? 'index').replace(
    /[^\w.-]+/g,
    '_',
  )
  return path.join(dir, parsed.hostname, `${hash.slice(0, 24)}-${base.slice(-80)}`)
}

export const isModelHostUrl = (url, hosts = MODEL_HOSTS) => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && hosts.includes(parsed.hostname)
  } catch {
    return false
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
  // The harness page is cross-origin isolated (COEP require-corp).
  'Cross-Origin-Resource-Policy': 'cross-origin',
}

const storedContentType = (file) => {
  try {
    return JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')).contentType || 'application/octet-stream'
  } catch {
    return 'application/octet-stream'
  }
}

const sendEmpty = (res, status) => {
  res.writeHead(status, CORS)
  res.end()
}

/** An upstream status passes through (a 404 stays a 404); anything else is a 502. */
function failResponse(res, error) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(error.status >= 400 && error.status < 600 ? error.status : 502, CORS)
  res.end(error.message)
}

/**
 * A loopback server that answers GET /model?u=<model URL> from the cache,
 * downloading (once, even for concurrent requests) on a miss. `stats` counts
 * hits, misses and downloaded bytes.
 */
export async function createModelCacheServer({
  dir = modelCacheDir(),
  hosts = MODEL_HOSTS,
  fetchImpl = globalThis.fetch,
  log = () => {},
} = {}) {
  const stats = { hits: 0, misses: 0, downloadedBytes: 0 }
  const inFlight = new Map()

  const download = (url, file) => {
    if (inFlight.has(file)) return inFlight.get(file)
    const job = (async () => {
      const t0 = Date.now()
      const response = await fetchImpl(url, { redirect: 'follow' })
      if (!response.ok || !response.body) {
        const error = new Error(`${url}: HTTP ${response.status}`)
        error.status = response.status
        throw error
      }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const part = `${file}.part-${process.pid}-${crypto.randomUUID().slice(0, 8)}`
      try {
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(part))
        const meta = { url, contentType: response.headers.get('content-type'), savedAt: Date.now() }
        fs.writeFileSync(`${file}.json`, `${JSON.stringify(meta)}\n`)
        fs.renameSync(part, file)
      } catch (error) {
        fs.rmSync(part, { force: true })
        throw error
      }
      const size = fs.statSync(file).size
      stats.downloadedBytes += size
      log(`model cache: downloaded ${url} (${(size / 1e6).toFixed(1)} MB) in ${Date.now() - t0}ms`)
    })().finally(() => inFlight.delete(file))
    inFlight.set(file, job)
    return job
  }

  /** The model URL a request asks for (GET /model?u=<url>), or null. */
  const requestedModel = (req) => {
    const url = new URL(req.url, 'http://localhost')
    const upstream = url.searchParams.get('u')
    const ok = req.method === 'GET' && url.pathname === '/model' && isModelHostUrl(upstream, hosts)
    return ok ? upstream : null
  }

  /** The cached file for a model URL, downloaded first on a miss. */
  const cachedFile = async (upstream) => {
    const file = cachePathFor(dir, upstream)
    const hit = fs.existsSync(file)
    stats[hit ? 'hits' : 'misses'] += 1
    if (!hit) await download(upstream, file)
    return file
  }

  const serveModel = async (req, res) => {
    const upstream = requestedModel(req)
    if (!upstream) return sendEmpty(res, 404)
    const file = await cachedFile(upstream)
    res.writeHead(200, {
      ...CORS,
      'Content-Type': storedContentType(file),
      'Content-Length': fs.statSync(file).size,
    })
    await pipeline(fs.createReadStream(file), res)
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') return sendEmpty(res, 204)
    serveModel(req, res).catch((error) => {
      log(`model cache: ${error.message}`)
      failResponse(res, error)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    dir,
    base,
    stats,
    urlFor: (upstream) => `${base}/model?u=${encodeURIComponent(upstream)}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

const routed = new WeakSet()

/**
 * Send a browser context's GETs to the model hosts through the cache server
 * (a redirect the page follows like any other). Once per context.
 */
export async function routeModelDownloads(context, cache, hosts = MODEL_HOSTS) {
  if (routed.has(context)) return
  routed.add(context)
  await context.route(
    (url) => isModelHostUrl(url.href, hosts),
    (route) => {
      const request = route.request()
      if (request.method() !== 'GET') return route.continue()
      return route.fulfill({
        status: 302,
        headers: { Location: cache.urlFor(request.url()), ...CORS },
      })
    },
  )
}
