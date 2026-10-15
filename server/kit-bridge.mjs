// Video Style Kit routes for the editor's Style tab (docs/video-style-kit.md):
//
//   GET  kit?project=<id>
//     The project's kit record and the kit file now: { record, path, kit,
//     drift } (drift: the file changed since it was applied), { record, error }
//     when the file can't be read, or { record: null } for a project without a kit.
//
//   POST kit/set  { project, values: { "<path>": "<value>" } }
//     Sets kit values by path: the same `shred kit set` an agent runs (checked,
//     logged in the kit's changelog, the project's kit:* styles follow). It
//     edits project.json; the editor saves first and reloads after.
import fs from 'node:fs'
import path from 'node:path'
import { readKitFile } from '../formats/kit/node.mjs'
import { failureMessage, runShredProcess } from './shred-process.mjs'

const ID = /^[0-9a-f-]{8,64}$/i
const KIT_PATH = /^[a-z]\w*(?:\.\w+)+$/i

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, name: 'TypeError' })
}

/** The kit a project follows, as GET kit reports it. */
export function projectKit(root, project) {
  if (!ID.test(project ?? '')) throw badRequest('project is required')
  let record = null
  try {
    record =
      JSON.parse(fs.readFileSync(path.join(root, 'projects', project, 'project.json'), 'utf8'))
        .kit ?? null
  } catch {
    throw Object.assign(new Error(`No project ${project}`), { status: 404, name: 'NotFoundError' })
  }
  if (!record) return { record: null }
  try {
    const read = readKitFile(record.path)
    return { record, path: read.path, kit: read.kit, drift: read.hash !== record.hash }
  } catch (error) {
    return { record, error: error.message }
  }
}

export function createKitRoutes({ sendJson, readBody, runShred = runShredProcess }) {
  const busy = new Set()
  return async function kitRoutes(req, res, { route, root, query }) {
    if (route === 'GET kit') {
      sendJson(res, 200, projectKit(root, query.get('project')))
      return true
    }
    if (route !== 'POST kit/set') return false
    const { project, values } = JSON.parse((await readBody(req)).toString() || '{}')
    if (!ID.test(project ?? '')) throw badRequest('project is required')
    const entries = values && typeof values === 'object' ? Object.entries(values) : []
    if (!entries.length) throw badRequest('values must map kit paths to values')
    for (const [key, value] of entries) {
      if (!KIT_PATH.test(key)) throw badRequest(`"${key}" is not a kit path`)
      if (typeof value !== 'string') throw badRequest(`${key}: values are sent as text`)
    }
    if (busy.has(project)) {
      sendJson(res, 409, { name: 'BusyError', message: 'The style kit is already being saved' })
      return true
    }
    busy.add(project)
    try {
      const { code, output } = await runShred(
        [
          'kit',
          'set',
          project,
          ...entries.map(([key, value]) => `${key}=${value}`),
          '--why',
          'from the Style tab',
        ],
        { root },
      )
      if (code !== 0) {
        sendJson(res, 422, {
          name: 'KitSetError',
          message: failureMessage(output, 'shred kit set failed'),
        })
        return true
      }
      sendJson(res, 200, { ok: true, output: output.trim() })
      return true
    } finally {
      busy.delete(project)
    }
  }
}
