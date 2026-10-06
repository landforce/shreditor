// Media bridge: imports footage into the workspace WITHOUT the browser
// uploading its bytes ("footage stays where it is").
//
// Each imported file gets its own `media/{id}/` folder, filled one of two ways:
//
//   clone  Same volume, copy-on-write filesystem (APFS, btrfs, XFS): an
//          instant clone at media/{id}/{name}. It takes no extra disk space
//          until one side changes.
//   link   Anything else (another volume, a filesystem without clones):
//          media/{id}/source.link.json records the original absolute path.
//          The bridge lists a virtual file named after it in media/{id}/ and
//          serves the original's bytes there, so the editor reads it like any
//          other media. headless/lib/workspace.mjs resolves the same record.
//
// Routes (mounted by workspace-bridge.mjs under /__shreditor/):
//
//   POST media/choose  { mode? }
//     Opens a native macOS file chooser (multiple selection) run by this
//     process, places the chosen files and returns { files: Placed[] }.
//     The editor then probes them and writes their metadata like a normal
//     import. 499 when cancelled, 501 off macOS.
//
//   POST media/import  { paths: string[], projectId?: string, mode? }
//     For agents and scripts: imports files by absolute path, writes
//     metadata.json (ffprobe) and a thumbnail (ffmpeg) when those tools are
//     installed, and adds the media to projects/{projectId}/media-links.json.
//     A file already in the workspace (same name, size and modified time) is
//     reused rather than imported twice. Returns { media: Imported[] }.
//       curl -X POST http://localhost:5273/__shreditor/media/import \
//         -d '{"paths":["/Volumes/Card/A001.mov"],"projectId":"<project id>"}'
//     Also available as `shreditor import <file...> [--project <id>]`.
//     Optional `category` (see below) is written into each file's metadata.
//
//   POST media/category  { items: [{ mediaId, category }] }
//     Sets each media's category in media/{id}/metadata.json: 'speaker',
//     'b-roll', 'graphics', 'overlay', 'voiceover', 'music', 'sfx', 'other',
//     or null to clear it. All items are checked before anything is written.
//     Returns { changed: [{ mediaId, from, to }], unchanged: [{ mediaId, category }] }.
//     Also available as `shreditor categorize <mediaId>=<category>...`.
//
//   GET media/version?projectId=<id>
//     A cheap change stamp for a project's media (media-links.json plus each
//     linked metadata.json). The open editor polls it to pick up imports and
//     category changes made outside the tab.
//
// `mode` is 'auto' (default: clone, else link), 'clone' (fail if cloning is
// unavailable) or 'link' (always reference the original).
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareCompatibleMedia } from './media-compatibility.mjs'
import { resolveMediaFile } from '../headless/lib/workspace.mjs'
import { autoTranscribe } from './transcription.mjs'

const SOURCE_LINK_FILENAME = 'source.link.json'

// Files in media/{id}/ that are not the source (mirrors NON_SOURCE_NAMES in
// src/infrastructure/storage/workspace-fs/media-source.ts).
const NON_SOURCE_NAMES = new Set(['metadata.json', 'thumbnail.jpg', 'thumbnail.meta.json', SOURCE_LINK_FILENAME, 'cache'])

// Extensions the editor's importer accepts (media-file-picker.ts), plus a few
// extra audio containers the media worker can read.
const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/lottie+json',
  '.lottie': 'application/lottie+json',
}

const MODES = new Set(['auto', 'clone', 'link'])

// Mirrors MediaCategory in src/types/storage.ts.
export const MEDIA_CATEGORIES = ['speaker', 'b-roll', 'graphics', 'overlay', 'voiceover', 'music', 'sfx', 'other']
const CATEGORY_SET = new Set(MEDIA_CATEGORIES)

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

class MediaBridgeError extends Error {
  constructor(status, name, message) {
    super(message)
    this.status = status
    this.name = name
  }
}

/* ───────────────────────────── File names ───────────────────────────── */

// Mirrors sanitizeWorkspaceFileName in workspace-fs/paths.ts so the bridge
// and the editor agree on the name inside media/{id}/.
// eslint-disable-next-line no-control-regex -- control chars are exactly what we strip
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

function sanitizeFileName(fileName) {
  const trimmed = String(fileName ?? '').replace(/^\s+|[\s.]+$/g, '')
  if (!trimmed) return 'source.bin'
  const cleaned = trimmed.replace(INVALID_FILENAME_CHARS, '_')
  const dot = cleaned.lastIndexOf('.')
  const hasExt = dot > 0 && dot < cleaned.length - 1
  const stem = hasExt ? cleaned.slice(0, dot) : cleaned
  const ext = hasExt ? cleaned.slice(dot) : ''
  const budget = Math.max(1, 200 - ext.length)
  const bounded = stem.length > budget ? stem.slice(0, budget) : stem
  const name = `${WINDOWS_RESERVED.test(bounded) ? `${bounded}_` : bounded}${ext}`
  // Never shadow a reserved sibling such as metadata.json.
  return NON_SOURCE_NAMES.has(name) ? `source-${name}` : name || 'source.bin'
}

function expandHome(p) {
  return String(p).replace(/^~(?=$|\/)/, os.homedir())
}

/* ──────────────────────────── Link records ──────────────────────────── */

function writeFileAtomic(target, data) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`)
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, target)
}

function writeJsonAtomic(target, value) {
  writeFileAtomic(target, `${JSON.stringify(value, null, 2)}\n`)
}

/** The source.link.json record in a media folder, or null. */
function readSourceLink(mediaDirPath) {
  try {
    const link = JSON.parse(fs.readFileSync(path.join(mediaDirPath, SOURCE_LINK_FILENAME), 'utf8'))
    if (typeof link?.path !== 'string' || !path.isAbsolute(link.path) || typeof link.fileName !== 'string') return null
    return link
  } catch {
    return null
  }
}

/**
 * A request path that names the virtual source file of a linked media
 * folder: `media/{id}/{fileName}` with no real file there and a link record
 * whose fileName matches. Returns the record, or null.
 */
function virtualLinkFor(root, rel, resolveInside) {
  const match = /^media\/([^/]+)\/([^/]+)$/.exec(String(rel).replace(/^\/+|\/+$/g, ''))
  if (!match) return null
  const full = resolveInside(root, rel)
  if (fs.existsSync(full)) return null
  const link = readSourceLink(path.dirname(full))
  return link && link.fileName === match[2] ? link : null
}

/* ────────────────────────────── Placement ───────────────────────────── */

// clonefile(2) through JavaScript for Automation. Node can't force a clone
// on macOS (COPYFILE_FICLONE_FORCE is ENOSYS there, and plain FICLONE falls
// back to a full copy), and clonefile fails rather than copying, which is
// exactly the clone-or-link decision we need.
const CLONEFILE_JXA = `function run(argv) {
  ObjC.bindFunction('clonefile', ['int', ['char *', 'char *', 'unsigned int']])
  return $.clonefile(argv[0], argv[1], 0) === 0 ? 'ok' : 'failed'
}`

async function cloneFile(source, target) {
  if (process.platform === 'darwin') {
    const out = await run('osascript', ['-l', 'JavaScript', '-e', CLONEFILE_JXA, source, target]).catch(() => '')
    if (out.trim() !== 'ok') {
      const error = new Error('clonefile failed (another volume, or a filesystem without clones)')
      error.code = 'ECLONE'
      throw error
    }
  } else {
    // Elsewhere FICLONE_FORCE fails instead of silently doing a full copy.
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE_FORCE)
  }
  // Keep the original's modified time: the editor uses name + size + mtime
  // to recognise a file it has seen before.
  const st = fs.statSync(source)
  fs.utimesSync(target, st.atime, st.mtime)
}

function describeSource(sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    throw new MediaBridgeError(400, 'TypeError', 'Each path must be a non-empty string')
  }
  const expanded = expandHome(sourcePath.trim())
  if (!path.isAbsolute(expanded)) throw new MediaBridgeError(400, 'TypeError', `Not an absolute path: ${sourcePath}`)
  let real
  try {
    real = fs.realpathSync(expanded)
  } catch {
    throw new MediaBridgeError(404, 'NotFoundError', `File not found: ${expanded}`)
  }
  const st = fs.statSync(real)
  if (!st.isFile()) throw new MediaBridgeError(400, 'TypeMismatchError', `Not a file: ${expanded}`)
  if (st.size === 0) throw new MediaBridgeError(400, 'TypeError', `Empty file: ${expanded}`)
  const ext = path.extname(real).toLowerCase()
  const mimeType = MIME_BY_EXT[ext]
  if (!mimeType) throw new MediaBridgeError(415, 'NotSupportedError', `Unsupported media type: ${path.basename(real)}`)
  // Use the name the user picked (a symlink's own name), but read the real file.
  return { real, fileName: path.basename(expanded), size: st.size, mtimeMs: Math.round(st.mtimeMs), mimeType }
}

/**
 * Put one file into a new media/{id}/ folder by clone or link.
 * @returns {Promise<{ id: string, fileName: string, entryName: string, path: string,
 *   method: 'clone' | 'link', size: number, mtimeMs: number, mimeType: string,
 *   sourcePath: string, cloneError?: string }>}
 */
async function placeMediaSource(root, sourcePath, { mode = 'auto' } = {}) {
  if (!MODES.has(mode)) throw new MediaBridgeError(400, 'TypeError', `mode must be one of ${[...MODES].join(', ')}`)
  const source = describeSource(sourcePath)
  const id = crypto.randomUUID()
  const dir = path.join(root, 'media', id)
  const entryName = sanitizeFileName(source.fileName)
  fs.mkdirSync(dir, { recursive: true })

  let method = 'link'
  let cloneError
  try {
    if (mode !== 'link') {
      const target = path.join(dir, entryName)
      try {
        await cloneFile(source.real, target)
        method = 'clone'
      } catch (error) {
        fs.rmSync(target, { force: true })
        if (mode === 'clone') {
          throw new MediaBridgeError(409, 'NotSupportedError', `Cannot clone ${source.fileName}: ${error.code ?? error.message}`)
        }
        cloneError = error.code ?? error.message
      }
    }
    if (method === 'link') {
      writeJsonAtomic(path.join(dir, SOURCE_LINK_FILENAME), {
        version: 1,
        path: source.real,
        fileName: entryName,
        originalName: source.fileName,
        size: source.size,
        mtimeMs: source.mtimeMs,
        linkedAt: Date.now(),
      })
    }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }

  return {
    id,
    fileName: source.fileName,
    entryName,
    path: `media/${id}/${entryName}`,
    method,
    size: source.size,
    mtimeMs: source.mtimeMs,
    mimeType: source.mimeType,
    sourcePath: source.real,
    ...(cloneError ? { cloneError } : {}),
  }
}

/* ───────────────────────── Finder file chooser ──────────────────────── */

const CHOOSE_FILES_SCRIPT = `
set picked to choose file with prompt "Import media into Shreditor" with multiple selections allowed
set out to ""
repeat with f in picked
  set out to out & POSIX path of f & linefeed
end repeat
return out`

function chooseFiles() {
  if (process.platform !== 'darwin') {
    return Promise.reject(new MediaBridgeError(501, 'NotSupportedError', 'The file chooser needs macOS'))
  }
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', CHOOSE_FILES_SCRIPT], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        // -128 is "user cancelled".
        if (String(error.message).includes('-128')) reject(new MediaBridgeError(499, 'AbortError', 'Cancelled'))
        else reject(new MediaBridgeError(500, 'UnknownError', error.message))
        return
      }
      resolve(stdout.split('\n').map((line) => line.trim()).filter(Boolean))
    })
  })
}

/* ────────────────────── Agent import (with metadata) ─────────────────── */

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}

// ffprobe codec names -> the names the editor's media worker (mediabunny) stores.
const CODEC_NAMES = { h264: 'avc', mpeg4: 'mpeg4', pcm_s16le: 'pcm-s16', pcm_s24le: 'pcm-s24', pcm_f32le: 'pcm-f32' }
const UNSUPPORTED_AUDIO = ['ac3', 'eac3', 'ec-3', 'ac-3', 'dts', 'truehd', 'mlp']

function parseRate(rate) {
  const [num, den] = String(rate ?? '').split('/').map(Number)
  return den ? num / den : num || 0
}

async function probe(file) {
  try {
    return JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]))
  } catch {
    return null
  }
}

function metadataFromProbe(probed, mimeType) {
  const streams = probed?.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.find((s) => s.codec_type === 'audio')
  const duration = Number(probed?.format?.duration) || Number(video?.duration) || Number(audio?.duration) || 0
  const codecOf = (s) => (s ? (CODEC_NAMES[s.codec_name] ?? s.codec_name) : undefined)
  const bitrate = Number(probed?.format?.bit_rate) || 0
  if (mimeType.startsWith('video/') && video) {
    const rotated = Math.abs(Number(video.side_data_list?.find((d) => 'rotation' in d)?.rotation ?? 0)) % 180 === 90
    const audioCodec = codecOf(audio)
    const codec = codecOf(video)
    return {
      duration,
      width: (rotated ? video.height : video.width) ?? 0,
      height: (rotated ? video.width : video.height) ?? 0,
      fps: Number(parseRate(video.avg_frame_rate || video.r_frame_rate).toFixed(3)) || 30,
      codec: codec ?? 'unknown',
      bitrate,
      audioCodec,
      audioCodecSupported: !audioCodec || !UNSUPPORTED_AUDIO.some((c) => audioCodec.toLowerCase().includes(c)),
      videoCodecSupported: codec !== 'prores',
    }
  }
  if (mimeType.startsWith('audio/')) {
    return { duration, width: 0, height: 0, fps: 0, codec: codecOf(audio) ?? 'unknown', bitrate }
  }
  return { duration: 0, width: video?.width ?? 0, height: video?.height ?? 0, fps: 0, codec: 'unknown', bitrate: 0 }
}

async function writeThumbnail(file, dir, metadata, mimeType) {
  if (!mimeType.startsWith('video/') && !(mimeType.startsWith('image/') && mimeType !== 'image/svg+xml')) return false
  const out = path.join(dir, `.thumbnail.jpg.${crypto.randomUUID()}.tmp`)
  const seek = mimeType.startsWith('video/') ? Math.min(1, Math.max(0, metadata.duration / 2)) : 0
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(seek), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', '-c:v', 'mjpeg', '-f', 'image2', out])
    fs.renameSync(out, path.join(dir, 'thumbnail.jpg'))
    return true
  } catch {
    fs.rmSync(out, { force: true })
    return false
  }
}

function listMediaMetadata(root) {
  const mediaRoot = path.join(root, 'media')
  if (!fs.existsSync(mediaRoot)) return []
  const out = []
  for (const entry of fs.readdirSync(mediaRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(mediaRoot, entry.name, 'metadata.json'), 'utf8')))
    } catch {
      // no metadata yet (import in progress) or unreadable
    }
  }
  return out
}

function associateWithProject(root, projectId, mediaId, resolveInside) {
  const projectDir = resolveInside(root, `projects/${projectId}`)
  if (!fs.existsSync(path.join(projectDir, 'project.json'))) {
    throw new MediaBridgeError(404, 'NotFoundError', `Project not found: ${projectId}`)
  }
  const linksFile = path.join(projectDir, 'media-links.json')
  let links = { version: '1.0', mediaIds: [] }
  try {
    const parsed = JSON.parse(fs.readFileSync(linksFile, 'utf8'))
    if (Array.isArray(parsed?.mediaIds)) links = parsed
  } catch {
    // first media for this project
  }
  if (!links.mediaIds.some((entry) => (typeof entry === 'string' ? entry : entry.id) === mediaId)) {
    links.mediaIds.push({ id: mediaId, addedAt: Date.now() })
    writeJsonAtomic(linksFile, links)
  }
}

/**
 * Import files by absolute path: place each one (clone or link), write its
 * metadata.json and thumbnail, and associate it with `projectId` if given.
 * Used by the HTTP route and by `shreditor import`.
 */
export async function importMediaByPath(root, paths, { projectId, mode = 'auto', category, resolveInside } = {}) {
  if (!Array.isArray(paths) || paths.length === 0) throw new MediaBridgeError(400, 'TypeError', 'paths must be a non-empty array')
  if (category !== undefined && category !== null && !CATEGORY_SET.has(category)) {
    throw new MediaBridgeError(400, 'TypeError', `category must be one of ${MEDIA_CATEGORIES.join(', ')}`)
  }
  const inside = resolveInside ?? defaultResolveInside
  if (projectId) {
    // Fail before placing anything when the project doesn't exist.
    if (!fs.existsSync(path.join(inside(root, `projects/${projectId}`), 'project.json'))) {
      throw new MediaBridgeError(404, 'NotFoundError', `Project not found: ${projectId}`)
    }
  }
  const existing = listMediaMetadata(root)
  const results = []
  for (const sourcePath of paths) {
    try {
      const source = describeSource(sourcePath)
      const duplicate = existing.find(
        (m) => m.fileName === source.fileName && m.fileSize === source.size && Math.round(m.fileLastModified ?? -1) === source.mtimeMs,
      )
      if (duplicate) {
        if (projectId) associateWithProject(root, projectId, duplicate.id, inside)
        if (category && duplicate.category !== category) {
          setMediaCategories(root, [{ mediaId: duplicate.id, category }], { resolveInside: inside })
          duplicate.category = category
        }
        results.push({ id: duplicate.id, fileName: duplicate.fileName, duplicate: true, sourcePath: source.real, metadata: duplicate })
        continue
      }

      const placed = await placeMediaSource(root, sourcePath, { mode })
      const dir = path.join(root, 'media', placed.id)
      try {
        const readable = placed.method === 'clone' ? path.join(dir, placed.entryName) : placed.sourcePath
        const probed = await probe(readable)
        const prepared = placed.mimeType.startsWith('video/') && probed
          ? await prepareCompatibleMedia(readable, dir) : null
        const effectiveMime = prepared ? (prepared.manifest.policy.alpha ? 'video/quicktime' : 'video/mp4') : placed.mimeType
        const details = metadataFromProbe(prepared?.manifest.probe ?? probed, effectiveMime)
        const hasThumbnail = await writeThumbnail(readable, dir, details, placed.mimeType)
        const now = Date.now()
        const metadata = {
          id: placed.id,
          storageType: 'workspace',
          fileName: placed.fileName,
          fileSize: placed.size,
          fileLastModified: placed.mtimeMs,
          mimeType: effectiveMime,
          ...details,
          ...(prepared ? { compatibility: { version: 1, backend: 'native', reason: prepared.manifest.policy.reason, alpha: prepared.manifest.policy.alpha, originalMimeType: placed.mimeType } } : {}),
          ...(hasThumbnail ? { thumbnailId: crypto.randomUUID() } : {}),
          tags: [],
          ...(category ? { category } : {}),
          createdAt: now,
          updatedAt: now,
        }
        writeJsonAtomic(path.join(dir, 'metadata.json'), metadata)
        if (projectId) associateWithProject(root, projectId, placed.id, inside)
        existing.push(metadata)
        autoTranscribe(root, placed.id)
        results.push({
          id: placed.id,
          fileName: placed.fileName,
          method: placed.method,
          path: placed.path,
          sourcePath: placed.sourcePath,
          duplicate: false,
          probed: Boolean(probed),
          ...(placed.cloneError ? { cloneError: placed.cloneError } : {}),
          metadata,
        })
      } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true })
        throw error
      }
    } catch (error) {
      results.push({ sourcePath, error: { name: error.name, message: error.message } })
    }
  }
  return results
}

/**
 * Set (or clear, with null) the category of each media. Every item is
 * validated, and every media must exist, before any metadata.json is
 * written. Used by the HTTP route and by `shreditor categorize`.
 * @param {Array<{ mediaId: string, category: string | null }>} items
 */
export function setMediaCategories(root, items, { resolveInside } = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new MediaBridgeError(400, 'TypeError', 'items must be a non-empty array')
  const inside = resolveInside ?? defaultResolveInside
  const planned = new Map()
  items.forEach((item, index) => {
    const mediaId = item?.mediaId
    if (typeof mediaId !== 'string' || !ID_PATTERN.test(mediaId)) {
      throw new MediaBridgeError(400, 'TypeError', `items[${index}].mediaId is invalid`)
    }
    const category = item.category ?? null
    if (category !== null && !CATEGORY_SET.has(category)) {
      throw new MediaBridgeError(400, 'TypeError', `items[${index}].category must be one of ${MEDIA_CATEGORIES.join(', ')} (or null to clear)`)
    }
    const file = path.join(inside(root, `media/${mediaId}`), 'metadata.json')
    if (!fs.existsSync(file)) throw new MediaBridgeError(404, 'NotFoundError', `Media not found: ${mediaId}`)
    planned.set(mediaId, { category, file })
  })
  const changed = []
  const unchanged = []
  for (const [mediaId, { category, file }] of planned) {
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
    const from = metadata.category ?? null
    if (from === category) {
      unchanged.push({ mediaId, category })
      continue
    }
    const next = { ...metadata, updatedAt: Date.now() }
    if (category) next.category = category
    else delete next.category
    writeJsonAtomic(file, next)
    changed.push({ mediaId, from, to: category })
  }
  return { changed, unchanged }
}

/**
 * Change stamp for a project's media: the newest modified time and count of
 * media-links.json plus every linked metadata.json. Any import, removal or
 * metadata write (a category change) moves it.
 */
export function projectMediaVersion(root, projectId, { resolveInside } = {}) {
  const inside = resolveInside ?? defaultResolveInside
  const projectDir = inside(root, `projects/${projectId}`)
  if (!fs.existsSync(path.join(projectDir, 'project.json'))) {
    throw new MediaBridgeError(404, 'NotFoundError', `Project not found: ${projectId}`)
  }
  const mtime = (file) => fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0
  const linksFile = path.join(projectDir, 'media-links.json')
  let ids = []
  try {
    const links = JSON.parse(fs.readFileSync(linksFile, 'utf8'))
    if (Array.isArray(links?.mediaIds)) ids = links.mediaIds.map((entry) => (typeof entry === 'string' ? entry : entry?.id))
  } catch {
    // no media yet
  }
  let newest = mtime(linksFile)
  let present = 0
  for (const id of ids) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) continue
    const at = mtime(path.join(root, 'media', id, 'metadata.json'))
    if (at) present += 1
    newest = Math.max(newest, at)
  }
  return `${ids.length}.${present}.${Math.round(newest)}`
}

function defaultResolveInside(root, rel) {
  const full = path.join(root, ...String(rel).split('/').filter(Boolean))
  if (full !== root && !full.startsWith(root + path.sep)) throw new MediaBridgeError(403, 'SecurityError', 'Outside the workspace')
  return full
}

/* ──────────────────────────────── Routes ─────────────────────────────── */

/**
 * Build the media route handler. `kit` carries the workspace bridge's own
 * helpers so path checks and responses behave exactly like its other routes.
 * The handler returns true when it answered the request.
 */
export function createMediaRoutes({ resolveInside, sendJson, readBody, serveFile }) {
  const readJson = async (req) => {
    try {
      return JSON.parse((await readBody(req)).toString() || '{}')
    } catch {
      throw new MediaBridgeError(400, 'SyntaxError', 'Body must be JSON')
    }
  }
  const projectIdOf = (value) => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
      throw new MediaBridgeError(400, 'TypeError', 'Invalid projectId')
    }
    return value
  }

  return async function handleMediaRoute(req, res, { route, rel, root, query }) {
    switch (route) {
      case 'POST media/choose': {
        const { mode = 'auto' } = await readJson(req)
        const picked = await chooseFiles()
        const files = []
        const skipped = []
        for (const file of picked) {
          try {
            files.push(await placeMediaSource(root, file, { mode }))
          } catch (error) {
            skipped.push({ sourcePath: file, error: { name: error.name, message: error.message } })
          }
        }
        sendJson(res, 200, { files, skipped })
        return true
      }
      case 'POST media/import': {
        const body = await readJson(req)
        const paths = typeof body.path === 'string' ? [body.path] : body.paths
        const media = await importMediaByPath(root, paths, {
          projectId: projectIdOf(body.projectId),
          mode: body.mode ?? 'auto',
          category: body.category,
          resolveInside,
        })
        sendJson(res, media.some((m) => !m.error) ? 200 : 422, { media })
        return true
      }
      case 'POST media/prepare': {
        const body = await readJson(req)
        if (typeof body.mediaId !== 'string' || !ID_PATTERN.test(body.mediaId)) throw new MediaBridgeError(400, 'TypeError', 'Invalid mediaId')
        const source = resolveMediaFile(root, body.mediaId, { original: true })
        if (!source) throw new MediaBridgeError(404, 'NotFoundError', 'Media source is missing')
        const controller = new AbortController()
        const cancel = () => { if (!res.writableEnded) controller.abort() }
        res.once('close', cancel)
        try {
          const prepared = await prepareCompatibleMedia(source, path.join(root, 'media', body.mediaId), { force: body.force === true, signal: controller.signal })
          if (prepared) {
            const metadataPath = path.join(root, 'media', body.mediaId, 'metadata.json')
            if (fs.existsSync(metadataPath)) {
              const previous = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
              const mimeType = prepared.manifest.policy.alpha ? 'video/quicktime' : 'video/mp4'
              writeJsonAtomic(metadataPath, { ...previous, ...metadataFromProbe(prepared.manifest.probe, mimeType), mimeType,
                compatibility: { version: 1, backend: 'native', reason: prepared.manifest.policy.reason, alpha: prepared.manifest.policy.alpha },
                updatedAt: Date.now() })
            }
          }
          sendJson(res, 200, prepared ? {
            prepared: true, cached: prepared.cached,
            url: `/__shreditor/fs/file?path=${encodeURIComponent(`media/${body.mediaId}/cache/compatibility/${prepared.manifest.file}`)}`,
            alpha: prepared.manifest.policy.alpha,
          } : { prepared: false })
        } finally { res.off('close', cancel) }
        return true
      }
      case 'POST media/category': {
        const body = await readJson(req)
        sendJson(res, 200, setMediaCategories(root, body.items, { resolveInside }))
        return true
      }
      case 'GET media/version': {
        const projectId = projectIdOf(query?.get('projectId'))
        if (!projectId) throw new MediaBridgeError(400, 'TypeError', 'projectId is required')
        sendJson(res, 200, { version: projectMediaVersion(root, projectId, { resolveInside }) })
        return true
      }
      // Linked media: answer for the virtual source file in media/{id}/.
      case 'GET fs/stat': {
        const link = virtualLinkFor(root, rel, resolveInside)
        if (!link) return false
        const st = fs.statSync(link.path, { throwIfNoEntry: false })
        if (!st?.isFile()) sendJson(res, 200, { exists: false })
        else sendJson(res, 200, { exists: true, kind: 'file', size: st.size, mtimeMs: Math.round(st.mtimeMs), linked: true })
        return true
      }
      case 'GET fs/file': {
        const link = virtualLinkFor(root, rel, resolveInside)
        if (!link) return false
        const st = fs.statSync(link.path, { throwIfNoEntry: false })
        if (!st?.isFile()) throw new MediaBridgeError(404, 'NotFoundError', `Linked file is missing: ${link.path}`)
        serveFile(req, res, link.path, st)
        return true
      }
      case 'GET fs/list': {
        if (!/^media\/[^/]+$/.test(String(rel).replace(/^\/+|\/+$/g, ''))) return false
        const full = resolveInside(root, rel)
        const link = readSourceLink(full)
        if (!link) return false
        const entries = fs
          .readdirSync(full, { withFileTypes: true })
          .filter((d) => d.isFile() || d.isDirectory())
          .filter((d) => !/^\..*\.tmp$/.test(d.name))
          .map((d) => ({ name: d.name, kind: d.isDirectory() ? 'directory' : 'file' }))
        if (!entries.some((e) => e.name === link.fileName) && fs.existsSync(link.path)) {
          entries.push({ name: link.fileName, kind: 'file' })
        }
        sendJson(res, 200, entries)
        return true
      }
      case 'DELETE fs/entry': {
        // Removing the virtual source removes the link, never the original.
        const link = virtualLinkFor(root, rel, resolveInside)
        if (!link) return false
        fs.rmSync(path.join(path.dirname(resolveInside(root, rel)), SOURCE_LINK_FILENAME), { force: true })
        sendJson(res, 200, { ok: true })
        return true
      }
      default:
        return false
    }
  }
}
