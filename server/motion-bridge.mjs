// Motion graphic routes for the editor (skills/shreditor-edit/references/motion.md):
//
//   GET  motion/clip?project=<id>&item=<clipId>
//     The clip's composition and controls: the folder it rendered from, the
//     variables it declares and the values its render used. 404 when the clip
//     has no logged render (it was not placed by shred motion).
//
//   POST motion/rerender  { project, item, variables }
//     Re-renders the clip's composition with those values over its current ones
//     and swaps the render into the clip: the same `shred motion add --item` an
//     agent runs, so the output is identical. It edits project.json through the
//     edit service; the editor saves first and reloads after, as for any agent
//     edit. One re-render per project at a time (409 while one runs).
import path from 'node:path'
import { motionClip } from '../skills/shreditor-edit/scripts/motion.mjs'
import { failureMessage, runShredProcess } from './shred-process.mjs'

const ID = /^[0-9a-f-]{8,64}$/i

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, name: 'TypeError' })
}

export function createMotionRoutes({ sendJson, readBody, runShred = runShredProcess }) {
  const busy = new Set()
  const motionRoot = (root, project) => path.join(root, 'projects', project, 'motion')
  const clipOf = (root, project, item) => {
    if (!ID.test(project ?? '')) throw badRequest('project is required')
    if (!ID.test(item ?? '')) throw badRequest('item is required')
    const info = motionClip(motionRoot(root, project), item)
    if (!info)
      throw Object.assign(new Error(`${item} is not a motion graphic placed by shred motion`), {
        status: 404,
        name: 'NotFoundError',
      })
    return info
  }

  return async function motionRoutes(req, res, { route, root, query }) {
    if (route === 'GET motion/clip') {
      sendJson(res, 200, clipOf(root, query.get('project'), query.get('item')))
      return true
    }
    if (route !== 'POST motion/rerender') return false
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    const { project, item, variables } = body
    const info = clipOf(root, project, item)
    if (!variables || typeof variables !== 'object' || Array.isArray(variables))
      throw badRequest('variables must be an object of control values')
    const unknown = Object.keys(variables).filter((k) => !info.variables.some((v) => v.id === k))
    if (unknown.length) throw badRequest(`not a control of this graphic: ${unknown.join(', ')}`)
    if (busy.has(project)) {
      sendJson(res, 409, { name: 'BusyError', message: 'A motion graphic is already re-rendering' })
      return true
    }
    busy.add(project)
    try {
      const { code, output } = await runShred(
        [
          'motion',
          'add',
          project,
          info.source,
          '--item',
          item,
          '--variables',
          JSON.stringify(variables),
        ],
        { root },
      )
      const clipId = /^replaced\s.*\[([0-9a-f-]+)\]/m.exec(output)?.[1]
      if (code !== 0 || !clipId) {
        sendJson(res, 422, {
          name: 'MotionRenderError',
          message: failureMessage(output, 'shred motion add failed'),
        })
        return true
      }
      sendJson(res, 200, { ok: true, clipId, output: output.trim() })
      return true
    } finally {
      busy.delete(project)
    }
  }
}
