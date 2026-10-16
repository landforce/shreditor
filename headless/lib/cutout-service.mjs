// Background removal in the agent service (docs/background-removal.md).
//
//   POST /v1/cutout { project, itemIds?, wait? }   analyse what the project's cut-out
//        clips need (on the warm page, one job at a time). Answers at once with the
//        job id unless `wait`; then when it is done.
//   GET  /v1/cutout?project=<id>[&job=<id>]        per-clip status from the workspace
//        (what is stored) plus the running job's progress.
//
// Status is computed here in Node from the project, each media's metadata.json
// and its cutout index.json, so it answers while the page is busy analysing.
import fs from 'node:fs'
import path from 'node:path'
import {
  CUTOUT_INDEX_FILE,
  cutoutCoverage,
  cutoutRegionKey,
  cutoutDirSegments,
  findCutoutEntry,
  isCutoutActive,
  itemSourceRange,
  maxSampleIndex,
  mediaFingerprint,
  parseCutoutIndex,
  resolveCutoutRate,
  sampleRangeFor,
} from '../../src/shared/cutout/cutout-core.mjs'
import {
  cutoutStrokeHash,
  isSmartStroke,
  regionCovers,
  regionTrackRange,
} from '../../src/shared/cutout/cutout-strokes.mjs'
import { loadProjectById, readMediaMetadata } from './workspace.mjs'
import { HttpError, readJsonBody } from './http-security.mjs'
import { resolveProjectMedia } from './render-core.mjs'
import { assertPortableId } from './lifecycle-store.mjs'

function readIndex(workspace, mediaId) {
  try {
    const file = path.join(workspace, ...cutoutDirSegments(mediaId), CUTOUT_INDEX_FILE)
    return parseCutoutIndex(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return parseCutoutIndex(null)
  }
}

/** How many of a clip's smart strokes have their region tracked over everything the clip plays. */
function regionStatus(index, item, { fingerprint, rate, padded, max }) {
  const smart = (item.cutout.strokes ?? []).filter(isSmartStroke)
  const tracked = smart.filter((stroke) => {
    const key = cutoutRegionKey({ fingerprint, rate, hash: cutoutStrokeHash(stroke) })
    const range = regionTrackRange(stroke, rate, padded, max)
    return regionCovers(index.regions[key], range.first, range.last)
  })
  return { strokes: item.cutout.strokes?.length ?? 0, regions: smart.length, regionsTracked: tracked.length }
}

/** One cut-out clip's status against what its media has stored. */
// Node side, covered by headless/cutout.test.mjs (node --test coverage is not measured)
// fallow-ignore-next-line complexity
function itemStatus(workspace, item, fps) {
  const meta = item.mediaId ? readMediaMetadata(workspace, item.mediaId) : null
  if (!meta) return { itemId: item.id, mediaId: item.mediaId, state: 'no-media', subject: item.cutout.subject }
  const fingerprint = mediaFingerprint(meta)
  const rate = resolveCutoutRate(item.cutout.sampleRate, meta.fps)
  const range = itemSourceRange(item, fps)
  const max = maxSampleIndex(meta.duration, rate)
  const padded = range && sampleRangeFor(range, rate, max)
  const index = readIndex(workspace, item.mediaId)
  const found = findCutoutEntry(index, { fingerprint, subject: item.cutout.subject, rate })
  const { needed, done } = cutoutCoverage(padded ? [padded] : [], found.entry)
  const regions = regionStatus(index, item, { fingerprint, rate, padded, max })
  const ready = needed > 0 && done >= needed && regions.regionsTracked === regions.regions
  return {
    itemId: item.id,
    label: item.label,
    mediaId: item.mediaId,
    subject: item.cutout.subject,
    resolvedSubject: found.subject,
    model: found.entry?.model ?? null,
    rate,
    needed,
    done,
    state: ready ? 'ready' : done > 0 ? 'partial' : 'none',
    feather: item.cutout.feather ?? 0,
    invert: Boolean(item.cutout.invert),
    ...regions,
  }
}

/**
 * Per cut-out clip: subject (and what auto resolved to), sample rate, how many
 * of the samples it needs are stored. `state` is ready, partial, none or
 * no-media.
 */
// Covered by headless/cutout.test.mjs
// fallow-ignore-next-line complexity
export function cutoutStatus(workspace, project) {
  const fps = project.metadata?.fps ?? 30
  return (project.timeline?.items ?? [])
    .filter((item) => isCutoutActive(item))
    .map((item) => itemStatus(workspace, item, fps))
}

/**
 * The /v1/cutout routes. `enqueue(fn, opts)` runs page work on the service queue;
 * `page()` is the current harness page; `progress(job)` reads the store's progress.
 */
export function createCutoutRoutes({ workspace, enqueue, page, mediaUrlOf, progress, timeoutMs, sendJson }) {
  let counter = 0
  const running = new Map()

  const start = (projectId, itemIds) => {
    const { project } = loadProjectById(workspace, projectId)
    const job = `cutout-${Date.now().toString(36)}-${++counter}`
    const { media } = resolveProjectMedia(workspace, project, mediaUrlOf, null)
    const promise = enqueue(
      () => page().evaluate((payload) => window.freecut.analyzeCutout(payload), { project, media, itemIds, job }),
      { timeoutMs, kind: 'cutout' },
    )
    running.set(job, { projectId, promise, startedAt: Date.now(), result: null, error: null })
    promise.then(
      (result) => Object.assign(running.get(job), { result }),
      (error) => Object.assign(running.get(job), { error: error.message ?? String(error) }),
    )
    return { job, promise }
  }

  // Service route; exercised by headless/cutout.test.mjs and headless/cutout-e2e.mjs
  // fallow-ignore-next-line complexity
  const status = (projectId, job) => {
    const { project } = loadProjectById(workspace, projectId)
    const run = job ? running.get(job) : null
    const live = job ? progress(job) : null
    return {
      ok: true,
      project: projectId,
      items: cutoutStatus(workspace, project),
      ...(job
        ? {
            job: {
              id: job,
              state: !run ? 'unknown' : run.error ? 'error' : run.result ? 'done' : 'running',
              error: run?.error ?? undefined,
              jobs: run?.result?.jobs ?? live?.jobs ?? [],
            },
          }
        : {}),
    }
  }

  return {
    matches: (url) => url.pathname === '/v1/cutout',
    // fallow-ignore-next-line complexity
    async handle(req, res, url) {
      if (req.method === 'GET') {
        const projectId = assertPortableId(url.searchParams.get('project'), 'project id')
        sendJson(res, 200, status(projectId, url.searchParams.get('job')))
        return
      }
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'GET or POST')
      const body = await readJsonBody(req, { maxBytes: 64 * 1024 })
      const projectId = assertPortableId(body.project, 'project id')
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(String) : undefined
      const { job, promise } = start(projectId, itemIds)
      if (body.wait) {
        await promise.catch(() => {})
      }
      sendJson(res, body.wait ? 200 : 202, status(projectId, job))
    },
  }
}
