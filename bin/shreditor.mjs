#!/usr/bin/env node
// shreditor command line.
//
//   shreditor open [folder] [--project <id>]   use a folder as the workspace and print the editor URL
//   shreditor where                            print the current workspace folder
//   shreditor choose                           pick the workspace folder in a Finder dialog
//   shreditor import <file...> [--project <id>] [--link]
//                                              import footage in place: an APFS clone on the
//                                              workspace's volume, else a link to the original
//                                              (--link always links). Same as
//                                              POST /__shreditor/media/import (server/media-bridge.mjs).
//
// The editor (npm run dev) reads the workspace from ~/.shreditor/config.json
// on every request, so switching takes effect on the next page load.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { importMediaByPath } from '../server/media-bridge.mjs'
import { currentWorkspace, DEFAULT_WORKSPACE, setWorkspace } from '../server/workspace-bridge.mjs'

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    link: { type: 'boolean', default: false },
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
      })
      for (const r of results) {
        if (r.error) say(`failed  ${r.sourcePath}: ${r.error.message}`)
        else say(`${r.duplicate ? 'exists' : r.method.padEnd(6)}  ${r.id}  ${r.fileName}`)
      }
      if (results.some((r) => r.error)) process.exitCode = 1
      break
    }
    default:
      say('Usage: shreditor open [folder] [--project <id>] | shreditor where | shreditor choose | shreditor import <file...> [--project <id>] [--link]')
      process.exit(command ? 1 : 0)
  }
} catch (error) {
  console.error(`shreditor: ${error.message}`)
  process.exit(1)
}
