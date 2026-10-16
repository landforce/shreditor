// "All cuts" in the editor's export dialog (docs/cuts.md, Export): every cut
// of the open project's group, one after another, each through the agent's own
// `shred export <cutId>` (native when possible, else the browser engine) at
// its own size, named "<project> - <cut label>".
//
//   POST cuts/export  { project, codec?, quality? }
//     Starts the export (one at a time); replies 202 with the job:
//     { id, done, cuts: [{ id, label, name, status, engine, path, error }] }
//     status: queued | exporting | done | failed
//   GET  cuts/export?job=<id>
//     The job as it stands, for the dialog's per-cut progress.
import crypto from 'node:crypto'
import { cutExportFileName } from '../src/shared/projects/cuts.mjs'
import { failureMessage, runShredProcess } from './shred-process.mjs'

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const CODECS = new Set(['h264', 'h265', 'hevc', 'vp9', 'vp8', 'av1', 'prores'])
const QUALITIES = new Set(['low', 'medium', 'high', 'ultra'])

const httpError = (status, name, message) => Object.assign(new Error(message), { status, name })

/** `shred export` flags for the dialog's codec and quality (anything else is left out). */
export function exportFlags({ codec, quality } = {}) {
  return [
    ...(CODECS.has(codec) ? ['--codec', codec] : []),
    ...(QUALITIES.has(quality) ? ['--quality', quality] : []),
  ]
}

/** What one `shred export` printed: the engine it used and the file (its last line). */
export function readExport(output) {
  return {
    engine: /^engine\s+(\w+)/m.exec(output)?.[1] ?? null,
    path: output.trim().split('\n').at(-1) || null,
  }
}

/** The group's cuts from `shred cut list --json` (its output may carry notes around the JSON). */
export function parseCutList(output) {
  const list = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1))
  const groupName = (list.cuts.find((cut) => cut.main) ?? list.cuts[0])?.name ?? list.group
  return list.cuts.map((cut) => ({
    id: cut.id,
    label: cut.label,
    name: cutExportFileName(groupName, cut.label),
    status: 'queued',
  }))
}

async function listGroup(runShred, root, project) {
  const { code, output } = await runShred(['cut', 'list', project, '--json'], { root })
  if (code !== 0)
    throw httpError(422, 'CutListError', failureMessage(output, 'shred cut list failed'))
  return parseCutList(output)
}

async function exportCut(runShred, root, cut, flags) {
  cut.status = 'exporting'
  const { code, output } = await runShred(['export', cut.id, '--out', cut.name, ...flags], {
    root,
  })
  const result =
    code === 0
      ? { status: 'done', ...readExport(output) }
      : { status: 'failed', error: failureMessage(output, 'shred export failed') }
  Object.assign(cut, result)
}

/** Export the job's cuts in order; one failure doesn't stop the rest. */
export async function runCutExport(job, { runShred, root, flags }) {
  for (const cut of job.cuts) await exportCut(runShred, root, cut, flags)
  job.done = true
}

export function createCutExportRoutes({ sendJson, readBody, runShred = runShredProcess }) {
  const jobs = new Map()
  const running = () => [...jobs.values()].some((job) => !job.done)

  async function start(req, res, root) {
    const input = JSON.parse((await readBody(req)).toString() || '{}')
    if (!ID.test(input.project ?? '')) throw httpError(400, 'TypeError', 'project is required')
    if (running()) throw httpError(409, 'BusyError', 'The cuts are already being exported')
    const job = { id: crypto.randomUUID(), done: false, cuts: await listGroup(runShred, root, input.project) }
    jobs.set(job.id, job)
    void runCutExport(job, { runShred, root, flags: exportFlags(input) })
    sendJson(res, 202, job)
  }

  function status(res, jobId) {
    const job = jobs.get(jobId ?? '')
    if (!job) throw httpError(404, 'NotFoundError', `No cut export ${jobId}`)
    sendJson(res, 200, job)
  }

  return async function cutExportRoutes(req, res, { route, root, query }) {
    if (route === 'POST cuts/export') await start(req, res, root)
    else if (route === 'GET cuts/export') status(res, query.get('job'))
    else return false
    return true
  }
}
