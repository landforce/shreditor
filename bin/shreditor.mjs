#!/usr/bin/env node
// shreditor command line.
//
//   shreditor open [folder] [--project <id>]   use a folder as the workspace and print the editor URL
//   shreditor where                            print the current workspace folder
//   shreditor choose                           pick the workspace folder in a Finder dialog
//   shreditor import <file...> [--project <id>] [--link] [--category <category>]
//                                              import footage in place: an APFS clone on the
//                                              workspace's volume, else a link to the original
//                                              (--link always links). Same as
//                                              POST /__shreditor/media/import (server/media-bridge.mjs).
//   shreditor categorize <mediaId>=<category>... | --category <category> <mediaId>...
//                                              set what each media is for (speaker, b-roll, graphics,
//                                              overlay, voiceover, music, sfx, other; "none" clears).
//                                              Same as POST /__shreditor/media/category.
//
// The editor (npm run dev) reads the workspace from ~/.shreditor/config.json
// on every request, so switching takes effect on the next page load.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { importMediaByPath, MEDIA_CATEGORIES, setMediaCategories } from '../server/media-bridge.mjs'
import { currentWorkspace, DEFAULT_WORKSPACE, setWorkspace } from '../server/workspace-bridge.mjs'

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    link: { type: 'boolean', default: false },
    category: { type: 'string' },
    port: { type: 'string', default: process.env.SHREDITOR_PORT || '5273' },
  },
})
const [command, folder, ...rest] = positionals
const base = `http://localhost:${opt.port}`
const say = (line) => process.stdout.write(`${line}\n`)

try {
  switch (command) {
    case 'open': {
      const root = setWorkspace(folder ?? DEFAULT_WORKSPACE)
      say(`Workspace: ${root}`)
      say(opt.project ? `${base}/editor/${encodeURIComponent(opt.project)}` : `${base}/projects`)
      break
    }
    case 'where':
      say(currentWorkspace())
      break
    case 'choose': {
      const res = await fetch(`${base}/__shreditor/workspace/choose`, { method: 'POST' })
      const body = await res.json()
      if (res.status === 499) say('Cancelled.')
      else if (!res.ok) throw new Error(body.message)
      else say(`Workspace: ${body.root}`)
      break
    }
    case 'import': {
      const files = [folder, ...rest].filter(Boolean).map((file) => path.resolve(file))
      if (!files.length) throw new Error('Usage: shreditor import <file...> [--project <id>] [--link]')
      const results = await importMediaByPath(currentWorkspace(), files, {
        projectId: opt.project,
        mode: opt.link ? 'link' : 'auto',
        category: opt.category,
      })
      for (const r of results) {
        if (r.error) say(`failed  ${r.sourcePath}: ${r.error.message}`)
        else say(`${r.duplicate ? 'exists' : r.method.padEnd(6)}  ${r.id}  ${r.fileName}${r.metadata?.category ? `  [${r.metadata.category}]` : ''}`)
      }
      if (results.some((r) => r.error)) process.exitCode = 1
      break
    }
    case 'categorize': {
      const args = [folder, ...rest].filter(Boolean)
      const clear = (c) => (c === 'none' || c === '' ? null : c)
      const items = opt.category
        ? args.map((mediaId) => ({ mediaId, category: clear(opt.category) }))
        : args.map((arg) => {
            const at = arg.lastIndexOf('=')
            if (at < 1) throw new Error(`Expected <mediaId>=<category>, got ${arg}`)
            return { mediaId: arg.slice(0, at), category: clear(arg.slice(at + 1)) }
          })
      if (!items.length) {
        throw new Error(`Usage: shreditor categorize <mediaId>=<category>... | --category <category> <mediaId>...\nCategories: ${MEDIA_CATEGORIES.join(', ')}, none`)
      }
      const { changed, unchanged } = setMediaCategories(currentWorkspace(), items)
      for (const c of changed) say(`set     ${c.mediaId}  ${c.from ?? 'none'} -> ${c.to ?? 'none'}`)
      for (const u of unchanged) say(`same    ${u.mediaId}  ${u.category ?? 'none'}`)
      break
    }
    default:
      say('Usage: shreditor open [folder] [--project <id>] | shreditor where | shreditor choose | shreditor import <file...> [--project <id>] [--link] [--category <c>] | shreditor categorize <mediaId>=<category>...')
      process.exit(command ? 1 : 0)
  }
} catch (error) {
  console.error(`shreditor: ${error.message}`)
  process.exit(1)
}
