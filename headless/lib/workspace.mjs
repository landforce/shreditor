import { resolveCompatibleMedia } from '../../server/media-compatibility.mjs'
// Read a FreeCut workspace folder from disk (plain fs, no File System Access
// API). Locates a project's JSON and maps the media it references to source
// files on disk, mirroring workspace-fs's `media/{id}/{filename}` layout.
import fs from 'node:fs'
import path from 'node:path'
import { assertSinglePathComponent, HttpError, resolveContained } from './http-security.mjs'
import { collectLuts } from './luts.mjs'

// Files in media/{id}/ that are NOT the source blob (mirrors
// NON_SOURCE_NAMES in workspace-fs/media-source.ts).
const NON_SOURCE_NAMES = new Set([
  'metadata.json',
  'thumbnail.jpg',
  'thumbnail.meta.json',
  'source.link.json',
  'cache',
])

const MEDIA_ITEM_TYPES = new Set(['video', 'audio', 'image'])

function readProject(projectJsonPath) {
  if (!fs.existsSync(projectJsonPath)) {
    throw new Error(`Project file not found: ${projectJsonPath}`)
  }
  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'))
  return { project, projectJsonPath }
}

/** CLI-only direct file loader. Direct paths must never be accepted by the HTTP service. */
export function loadProjectFile(projectFile) {
  return readProject(path.resolve(projectFile))
}

/** Workspace-scoped loader for HTTP/API project ids. */
export function loadProjectById(workspaceDir, projectId) {
  assertSinglePathComponent(projectId, 'project id')
  const projectsDir = path.join(workspaceDir, 'projects')
  const projectJsonPath = resolveContained(projectsDir, path.join(projectId, 'project.json'))
  if (!fs.existsSync(projectJsonPath))
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  return readProject(projectJsonPath)
}

/** Backward-compatible CLI loader: id under workspace or an explicit JSON file. */
export function loadProject(workspaceDir, projectIdOrFile) {
  return projectIdOrFile.endsWith('.json')
    ? loadProjectFile(projectIdOrFile)
    : loadProjectById(workspaceDir, projectIdOrFile)
}

/** List projects using the actionable directory name as id; projectId is the JSON's internal id. */
export function listProjects(workspaceDir) {
  const projectsDir = path.join(workspaceDir, 'projects')
  if (!fs.existsSync(projectsDir)) return []
  const out = []
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const jsonPath = path.join(projectsDir, entry.name, 'project.json')
    if (!fs.existsSync(jsonPath)) continue
    try {
      const p = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      out.push({
        id: entry.name,
        projectId: p.id ?? entry.name,
        name: p.name ?? '(unnamed)',
        updatedAt: p.updatedAt ?? 0,
      })
    } catch {
      // skip unreadable project
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Collect media ids referenced by the project's timeline.
 *
 * When `range` ({ inFrame, outFrame } in project frames) is given, only media
 * for top-level items overlapping the range is collected — and for a
 * composition (compound clip) item that overlaps, all media inside its
 * sub-composition. This avoids fetching media that a sliced render never
 * touches (e.g. a multi-hour clip far outside the range).
 */
export function collectMediaIds(project, range = null) {
  const timeline = project.timeline
  if (!timeline) return []

  const ids = new Set()
  const compsById = new Map((timeline.compositions ?? []).map((c) => [c.id, c]))

  const overlaps = (item) => {
    if (!range) return true
    const start = item.from ?? 0
    const end = start + (item.durationInFrames ?? 0)
    const lo = range.inFrame ?? 0
    const hi = range.outFrame ?? Number.POSITIVE_INFINITY
    return end > lo && start < hi
  }

  // Recurse into a sub-composition, collecting its media and following nested
  // composition items (compound clips can reference other compound clips).
  const expandComp = (compId, visited) => {
    if (!compId || visited.has(compId)) return
    visited.add(compId)
    const comp = compsById.get(compId)
    for (const sub of comp?.items ?? []) {
      if (sub.mediaId && MEDIA_ITEM_TYPES.has(sub.type)) ids.add(sub.mediaId)
      if (sub.type === 'composition' && sub.compositionId) expandComp(sub.compositionId, visited)
    }
  }

  for (const item of timeline.items ?? []) {
    if (!overlaps(item)) continue
    if (item.mediaId && MEDIA_ITEM_TYPES.has(item.type)) ids.add(item.mediaId)
    if (item.type === 'composition' && item.compositionId) {
      expandComp(item.compositionId, new Set())
    }
  }
  return [...ids]
}

/** Read a media's MediaMetadata (media/{id}/metadata.json), or null if absent/unreadable. */
export function readMediaMetadata(workspaceDir, mediaId) {
  assertSinglePathComponent(mediaId, 'media id')
  const metaPath = resolveContained(
    path.join(workspaceDir, 'media'),
    path.join(mediaId, 'metadata.json'),
  )
  if (!fs.existsSync(metaPath)) return null
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Why a media can't be placed yet, or null: the bridge is still making its
 * working copy (server/media-preparation.mjs), or couldn't.
 */
const NOT_READY = {
  preparing: (m, c) =>
    `${m.fileName} is still getting a playable working copy (${Math.round((c.progress ?? 0) * 100)}%). Wait for it: shred media ${m.id} --wait`,
  failed: (m, c) =>
    `${m.fileName} has no playable working copy: ${c.error ?? 'preparation failed'}. Retry: shred media ${m.id} --retry`,
}

function mediaNotReadyReason(metadata) {
  const c = metadata?.compatibility
  return c && Object.hasOwn(NOT_READY, c.status) ? NOT_READY[c.status](metadata, c) : null
}

/** Collect `{ mediaId, metadata }` for media referenced by addClip ops (deduped). */
export function collectAddClipMedia(workspaceDir, ops) {
  const ids = [...new Set(ops.filter((o) => o.op === 'addClip' && o.mediaId).map((o) => o.mediaId))]
  return ids.map((mediaId) => {
    const metadata = readMediaMetadata(workspaceDir, mediaId) ?? undefined
    const notReady = mediaNotReadyReason(metadata)
    if (notReady) throw new HttpError(409, 'MEDIA_NOT_READY', notReady)
    return { mediaId, metadata }
  })
}

/**
 * Everything from the workspace an op batch needs besides the project, for
 * the browser's edit input: metadata for addClip media and the text of the
 * LUTs addLut ops name. Every caller of window.freecut.editProject spreads
 * this in, so none can forget a kind.
 */
export function collectEditResources(workspaceDir, ops) {
  return { media: collectAddClipMedia(workspaceDir, ops), luts: collectLuts(workspaceDir, ops) }
}

/**
 * Follow media/{id}/source.link.json, written when footage was imported in
 * place from a volume the workspace can't clone onto (see
 * server/media-bridge.mjs). Returns the original's absolute path when it is
 * still a regular file, else null.
 */
const readJsonOrNull = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const isAbsoluteFile = (file) =>
  typeof file === 'string' &&
  path.isAbsolute(file) &&
  fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true

function resolveSourceLink(mediaDir) {
  const target = readJsonOrNull(path.join(mediaDir, 'source.link.json'))?.path
  return isAbsoluteFile(target) ? target : null
}

/**
 * Resolve a media id to its source file: the first non-reserved file under
 * media/{id}/, else the original a source.link.json points at.
 */
export function resolveMediaFile(workspaceDir, mediaId, { original = false } = {}) {
  assertSinglePathComponent(mediaId, 'media id')
  const mediaRoot = path.join(workspaceDir, 'media')
  const mediaDir = resolveContained(mediaRoot, mediaId)
  if (!fs.existsSync(mediaDir)) return null
  for (const entry of fs.readdirSync(mediaDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    // Dotfiles are atomic-write temporaries (metadata.json progress writes).
    if (NON_SOURCE_NAMES.has(entry.name) || entry.name.startsWith('.')) continue
    const source = resolveContained(mediaRoot, path.join(mediaId, entry.name))
    return original ? source : (resolveCompatibleMedia(source, mediaDir) ?? source)
  }
  const source = resolveSourceLink(mediaDir)
  return source && !original ? (resolveCompatibleMedia(source, mediaDir) ?? source) : source
}

/**
 * Resolve media ids to absolute source-file paths.
 * @returns {{ files: Map<string,string>, missing: string[] }}
 */
export function resolveMediaFiles(workspaceDir, mediaIds) {
  const files = new Map()
  const missing = []
  for (const mediaId of mediaIds) {
    const filePath = resolveMediaFile(workspaceDir, mediaId)
    if (filePath) files.set(mediaId, filePath)
    else missing.push(mediaId)
  }
  return { files, missing }
}
