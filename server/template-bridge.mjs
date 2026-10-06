// Motion template library routes for the editor:
//
//   GET templates/version
//     A change stamp for <workspace>/app/templates (each template.json and
//     thumbnail.jpg). The open editor polls it so templates the agent saves or
//     imports show up without a reload.
import { templateLibraryStamp } from '../headless/lib/templates.mjs'

export function createTemplateRoutes({ sendJson }) {
  return async function templateRoutes(req, res, { route, root }) {
    if (route !== 'GET templates/version') return false
    sendJson(res, 200, { version: templateLibraryStamp(root) })
    return true
  }
}
