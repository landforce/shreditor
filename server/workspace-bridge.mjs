// Workspace bridge: serves one folder on disk to the editor over loopback, so
// the editor and the agent read and write the same files with no browser
// folder picker or permission prompts.
//
// Mounted by the Vite dev server (see vite.config.ts) and by `bin/shreditor.mjs`.
// All routes live under /__shreditor/. Paths are relative to the workspace
// root and may not escape it.
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMediaRoutes } from './media-bridge.mjs'

const PREFIX = '/__shreditor/'
const CONFIG_DIR = path.join(os.homedir(), '.shreditor')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
export const DEFAULT_WORKSPACE = path.join(os.homedir(), 'Movies', 'Shreditor')
const MAX_RECENT = 8

class HttpError extends Error {
  constructor(status, name, message) {
    super(message)
    this.status = status
    this.name = name
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2))
  fs.renameSync(tmp, CONFIG_FILE)
}

export function currentWorkspace() {
  return path.resolve(process.env.SHREDITOR_WORKSPACE || readConfig().workspace || DEFAULT_WORKSPACE)
}

/** Make `dir` the workspace (creating it) and remember it in the recent list. */
export function setWorkspace(dir) {
  const resolved = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()))
  fs.mkdirSync(resolved, { recursive: true })
  if (!fs.statSync(resolved).isDirectory()) throw new HttpError(400, 'TypeMismatchError', `${resolved} is not a folder`)
  const config = readConfig()
  const recent = [resolved, ...(config.recent ?? []).filter((p) => p !== resolved)].slice(0, MAX_RECENT)
  writeConfig({ ...config, workspace: resolved, recent })
  return resolved
}

// Native macOS folder chooser, run by this process so it works in any browser.
function chooseFolder(startIn) {
  if (process.platform !== 'darwin') {
    return Promise.reject(new HttpError(501, 'NotSupportedError', 'The folder chooser needs macOS; pass a path instead'))
  }
  const location = startIn && fs.existsSync(startIn) ? ` default location POSIX file ${JSON.stringify(startIn)}` : ''
  const script = `POSIX path of (choose folder with prompt "Choose a Shreditor workspace folder"${location})`
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (error, stdout) => {
      if (error) {
        // -128 is "user cancelled".
        if (String(error.message).includes('-128')) reject(new HttpError(499, 'AbortError', 'Cancelled'))
        else reject(new HttpError(500, 'UnknownError', error.message))
        return
      }
      resolve(stdout.trim().replace(/\/$/, ''))
    })
  })
}

function resolveInside(root, rel = '') {
  const parts = String(rel).split('/').filter(Boolean)
  if (parts.some((p) => p === '..' || p === '.' || p.includes('\\') || p.includes('\0'))) {
    throw new HttpError(400, 'SecurityError', 'Invalid path')
  }
  const full = path.join(root, ...parts)
  if (full !== root && !full.startsWith(root + path.sep)) throw new HttpError(403, 'SecurityError', 'Outside the workspace')
  return full
}

function statOrNull(p) {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

function notFound(rel) {
  return new HttpError(404, 'NotFoundError', `Not found: ${rel}`)
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

// Stream the request body to a temp file beside the target, then rename, so
// readers (the agent, the watcher) never see a half-written file.
async function writeAtomic(target, req) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`)
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp)
      req.pipe(out)
      out.on('finish', resolve)
      out.on('error', reject)
      req.on('error', reject)
    })
    fs.renameSync(tmp, target)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

function serveFile(req, res, full, st) {
  const headers = {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
    'accept-ranges': 'bytes',
    'x-mtime': String(Math.round(st.mtimeMs)),
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1
    start = Math.max(0, start)
    end = Math.min(st.size - 1, end)
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 })
    fs.createReadStream(full, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'content-length': st.size })
  fs.createReadStream(full).pipe(res)
}

/**
 * Connect/Express-style middleware. Calls `next()` for anything outside
 * /__shreditor/ so it can sit in front of the app.
 */
export function createWorkspaceBridge() {
  // In-place media import and linked media sources (see media-bridge.mjs).
  const mediaRoutes = createMediaRoutes({ resolveInside, sendJson, readBody, serveFile })
  return async function workspaceBridge(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(PREFIX)) return next?.()
    const route = `${req.method} ${url.pathname.slice(PREFIX.length)}`
    const rel = url.searchParams.get('path') ?? ''
    try {
      const root = currentWorkspace()
      fs.mkdirSync(root, { recursive: true })
      if (await mediaRoutes(req, res, { route, rel, root })) return
      switch (route) {
        case 'GET info': {
          const config = readConfig()
          return sendJson(res, 200, { version: 1, root, name: path.basename(root), recent: config.recent ?? [root], platform: process.platform })
        }
        case 'POST workspace': {
          const { path: dir } = JSON.parse((await readBody(req)).toString() || '{}')
          if (!dir) throw new HttpError(400, 'TypeError', 'path is required')
          return sendJson(res, 200, { root: setWorkspace(dir) })
        }
        case 'POST workspace/choose': {
          const picked = await chooseFolder(root)
          return sendJson(res, 200, { root: setWorkspace(picked) })
        }
        case 'GET fs/stat': {
          // A missing entry is an ordinary answer here, not an error.
          const st = statOrNull(resolveInside(root, rel))
          if (!st) return sendJson(res, 200, { exists: false })
          return sendJson(res, 200, { exists: true, kind: st.isDirectory() ? 'directory' : 'file', size: st.size, mtimeMs: Math.round(st.mtimeMs) })
        }
        case 'GET fs/list': {
          const full = resolveInside(root, rel)
          if (!statOrNull(full)?.isDirectory()) throw notFound(rel)
          const entries = fs
            .readdirSync(full, { withFileTypes: true })
            .filter((d) => d.isFile() || d.isDirectory())
            .filter((d) => !/^\..*\.tmp$/.test(d.name))
            .map((d) => ({ name: d.name, kind: d.isDirectory() ? 'directory' : 'file' }))
          return sendJson(res, 200, entries)
        }
        case 'POST fs/mkdir': {
          const full = resolveInside(root, rel)
          const st = statOrNull(full)
          if (st && !st.isDirectory()) throw new HttpError(409, 'TypeMismatchError', `${rel} is a file`)
          fs.mkdirSync(full, { recursive: true })
          return sendJson(res, 200, { ok: true })
        }
        case 'POST fs/touch': {
          const full = resolveInside(root, rel)
          const st = statOrNull(full)
          if (st?.isDirectory()) throw new HttpError(409, 'TypeMismatchError', `${rel} is a folder`)
          if (!st) {
            fs.mkdirSync(path.dirname(full), { recursive: true })
            fs.writeFileSync(full, '')
          }
          return sendJson(res, 200, { ok: true })
        }
        case 'GET fs/file': {
          const full = resolveInside(root, rel)
          const st = statOrNull(full)
          if (!st?.isFile()) throw notFound(rel)
          return serveFile(req, res, full, st)
        }
        case 'PUT fs/file': {
          const full = resolveInside(root, rel)
          if (statOrNull(full)?.isDirectory()) throw new HttpError(409, 'TypeMismatchError', `${rel} is a folder`)
          await writeAtomic(full, req)
          const st = fs.statSync(full)
          return sendJson(res, 200, { size: st.size, mtimeMs: Math.round(st.mtimeMs) })
        }
        case 'DELETE fs/entry': {
          const full = resolveInside(root, rel)
          const st = statOrNull(full)
          if (!st) throw notFound(rel)
          if (st.isDirectory() && fs.readdirSync(full).length && url.searchParams.get('recursive') !== '1') {
            throw new HttpError(409, 'InvalidModificationError', `${rel} is not empty`)
          }
          fs.rmSync(full, { recursive: true, force: true })
          return sendJson(res, 200, { ok: true })
        }
        case 'POST fs/move': {
          const { from, to } = JSON.parse((await readBody(req)).toString() || '{}')
          const src = resolveInside(root, from)
          const dst = resolveInside(root, to)
          if (!statOrNull(src)) throw notFound(from)
          fs.mkdirSync(path.dirname(dst), { recursive: true })
          fs.renameSync(src, dst)
          return sendJson(res, 200, { ok: true })
        }
        default:
          throw new HttpError(404, 'NotFoundError', `Unknown route ${route}`)
      }
    } catch (error) {
      if (res.headersSent) return res.end()
      sendJson(res, error.status ?? 500, { name: error.name ?? 'UnknownError', message: error.message })
    }
  }
}
