#!/usr/bin/env node
// shreditor command line.
//
//   shreditor open [folder] [--project <id>]   use a folder as the workspace and print the editor URL
//   shreditor where                            print the current workspace folder
//   shreditor choose                           pick the workspace folder in a Finder dialog
//   shreditor import <file...> [--project <id>] [--link] [--category <category>] [--no-wait]
//                                              import footage in place: an APFS clone on the
//                                              workspace's volume, else a link to the original
//                                              (--link always links). Video Chrome can't decode
//                                              as it is gets a working copy (made by a background
//                                              worker); import waits for it, printing progress,
//                                              unless --no-wait. Same as
//                                              POST /__shreditor/media/import (server/media-bridge.mjs).
//   shreditor media <mediaId...> [--wait] [--retry] [--json]
//                                              working-copy state: ready (and from -> to), preparing
//                                              NN%, or failed (why); --wait until none is preparing,
//                                              --retry a failed one.
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
import { preparationStates, readMetadata, retryPreparation, waitForPreparation } from '../server/media-preparation.mjs'
import { currentWorkspace, DEFAULT_WORKSPACE, setWorkspace } from '../server/workspace-bridge.mjs'

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    link: { type: 'boolean', default: false },
    category: { type: 'string' },
    'no-wait': { type: 'boolean', default: false },
    wait: { type: 'boolean', default: false },
    retry: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    port: { type: 'string', default: process.env.SHREDITOR_PORT || '5273' },
  },
})
const [command, folder, ...rest] = positionals
const base = `http://localhost:${opt.port}`
const say = (line) => process.stdout.write(`${line}\n`)

const describe = (s) =>
  s.status === 'preparing'
    ? `making playable copy ${Math.round((s.progress ?? 0) * 100)}%`
    : s.status === 'failed'
      ? `failed: ${s.error ?? 'no playable copy'}`
      : s.status

/** "prores HQ 10-bit yuv422p10le -> hevc 10-bit yuv422p10le (notes)" for ready working copies. */
function workingCopyLine(root, id) {
  const c = readMetadata(root, id)?.compatibility
  if (c?.status !== 'ready') return ''
  const side = (d) => d?.video ? `${d.video.codec}${d.video.profile ? ` ${d.video.profile}` : ''} ${d.video.bitDepth}-bit ${d.video.pixFmt}${d.audio ? ` + ${d.audio.codec}` : ''}` : '?'
  const v = c.verification ?? {}
  return `  working copy: ${side(c.original)} -> ${side(c.derivative)} [${c.action}; frames ${v.frames?.join('/') ?? '?'}; duration delta ${v.durationDelta ?? '?'}s]${c.notes?.length ? ` (${c.notes.join('; ')})` : ''}`
}

const stateLine = (root, s) =>
  `${s.status.padEnd(9)} ${s.id}  ${s.fileName ?? ''}${s.status === 'ready' ? workingCopyLine(root, s.id) || '  plays as is' : `  ${describe(s)}`}`

/** Wait for working copies, one line per state change or 10% step. */
async function waitAndPrint(root, ids) {
  const printed = new Map()
  const states = await waitForPreparation(root, ids, {
    onChange: (list) => {
      for (const s of list) {
        const step = s.status === 'preparing' ? `p${Math.floor((s.progress ?? 0) * 10)}` : s.status
        if (printed.get(s.id) === step) continue
        printed.set(s.id, step)
        say(stateLine(root, s))
      }
    },
  })
  if (states.some((s) => s.status !== 'ready')) process.exitCode = 1
  return states
}

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
      const root = currentWorkspace()
      // Working copies are made by a detached worker, so --no-wait can return.
      const results = await importMediaByPath(root, files, {
        projectId: opt.project,
        mode: opt.link ? 'link' : 'auto',
        category: opt.category,
        prepare: 'detached',
      })
      for (const r of results) {
        if (r.error) {
          say(`failed  ${r.sourcePath}: ${r.error.message}`)
          continue
        }
        const c = r.metadata?.compatibility
        const note = c?.status === 'preparing' ? `  (making a playable working copy: ${c.detail})` : c?.status === 'failed' ? `  (no playable copy: ${c.error})` : ''
        say(`${r.duplicate ? 'exists' : r.method.padEnd(6)}  ${r.id}  ${r.fileName}${r.metadata?.category ? `  [${r.metadata.category}]` : ''}${note}`)
      }
      const preparing = results.filter((r) => r.metadata?.compatibility?.status === 'preparing').map((r) => r.id)
      if (preparing.length && opt['no-wait']) say(`${preparing.length} working cop${preparing.length === 1 ? 'y' : 'ies'} in progress; check with: shreditor media ${preparing.join(' ')}`)
      else if (preparing.length) await waitAndPrint(root, preparing)
      if (results.some((r) => r.error)) process.exitCode = 1
      break
    }
    case 'media': {
      const root = currentWorkspace()
      const ids = [folder, ...rest].filter(Boolean)
      if (!ids.length) throw new Error('Usage: shreditor media <mediaId...> [--wait] [--retry] [--json]')
      if (opt.retry) for (const id of ids) await retryPreparation(root, id, { detached: true })
      const states = opt.wait || opt.retry ? await waitAndPrint(root, ids) : preparationStates(root, ids)
      if (opt.json) say(JSON.stringify(ids.map((id) => ({ ...states.find((s) => s.id === id), compatibility: readMetadata(root, id)?.compatibility ?? null })), null, 2))
      else if (!opt.wait && !opt.retry) for (const s of states) say(stateLine(root, s))
      if (states.some((s) => s.status === 'failed' || s.status === 'missing')) process.exitCode = 1
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
      say('Usage: shreditor open [folder] [--project <id>] | shreditor where | shreditor choose | shreditor import <file...> [--project <id>] [--link] [--category <c>] [--no-wait] | shreditor media <mediaId...> [--wait] [--retry] [--json] | shreditor categorize <mediaId>=<category>...')
      process.exit(command ? 1 : 0)
  }
} catch (error) {
  console.error(`shreditor: ${error.message}`)
  process.exit(1)
}
