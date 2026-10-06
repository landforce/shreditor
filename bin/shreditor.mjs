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
//   shreditor transcribe <mediaId...> | --project <id> [--force]
//                                              transcribe now with whisper.cpp, locally, into the
//                                              editor's transcript store (imports do this in the
//                                              background on their own; --force replaces a transcript
//                                              made in the app). See server/transcription.mjs.
//   shreditor setup whisper [--yes] [--verify] check ffmpeg, whisper-cli and the model; --yes downloads
//                                              the model (1.6 GB) and verifies its sha256
//
// The editor (npm run dev) reads the workspace from ~/.shreditor/config.json
// on every request, so switching takes effect on the next page load.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { importMediaByPath, MEDIA_CATEGORIES, setMediaCategories } from '../server/media-bridge.mjs'
import { currentWorkspace, DEFAULT_WORKSPACE, setWorkspace } from '../server/workspace-bridge.mjs'
import { enableAutoTranscription, readTranscriptionStatus, settleHandoffs, transcribeMedia } from '../server/transcription.mjs'

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    link: { type: 'boolean', default: false },
    category: { type: 'string' },
    port: { type: 'string', default: process.env.SHREDITOR_PORT || '5273' },
    force: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
  },
})
const [command, folder, ...rest] = positionals
const base = `http://localhost:${opt.port}`
const say = (line) => process.stdout.write(`${line}\n`)
const readMetadata = (root, id) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'media', id, 'metadata.json'), 'utf8'))
  } catch {
    return null
  }
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
      // New audio/video is transcribed by the editor's bridge when it is running.
      enableAutoTranscription({ mode: 'handoff', bridgeUrl: base })
      const results = await importMediaByPath(currentWorkspace(), files, {
        projectId: opt.project,
        mode: opt.link ? 'link' : 'auto',
        category: opt.category,
      })
      const handedOff = new Set(await settleHandoffs())
      for (const r of results) {
        if (r.error) say(`failed  ${r.sourcePath}: ${r.error.message}`)
        else say(`${r.duplicate ? 'exists' : r.method.padEnd(6)}  ${r.id}  ${r.fileName}${r.metadata?.category ? `  [${r.metadata.category}]` : ''}`)
      }
      const queued = results.filter((r) => !r.error && !r.duplicate && readTranscriptionStatus(currentWorkspace(), r.id)?.status === 'queued')
      if (queued.some((r) => handedOff.has(r.id))) {
        say(`Transcribing new audio/video in the background (locally, whisper.cpp, in the editor at ${base}); read one with: shred transcript <mediaId>`)
      }
      if (queued.some((r) => !handedOff.has(r.id))) {
        say(`Queued for transcription; no editor at ${base} for this workspace, so it starts when the editor next runs (or now: shreditor transcribe <mediaId>)`)
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
    case 'transcribe': {
      const root = currentWorkspace()
      let ids = [folder, ...rest].filter(Boolean)
      if (opt.project) {
        const links = JSON.parse(fs.readFileSync(path.join(root, 'projects', opt.project, 'media-links.json'), 'utf8'))
        ids = [...ids, ...links.mediaIds.map((entry) => (typeof entry === 'string' ? entry : entry.id))]
          .filter((id) => /^(audio|video)\//.test(readMetadata(root, id)?.mimeType ?? ''))
      }
      if (!ids.length) throw new Error('Usage: shreditor transcribe <mediaId...> | --project <id> [--force]')
      for (const id of ids) {
        const result = await transcribeMedia(root, id, { force: opt.force, log: (line) => say(`        ${line}`) })
        const detail = result.status === 'done' ? `${result.words} words, ${result.language}` : (result.reason ?? result.error ?? result.hint ?? '')
        say(`${result.status.padEnd(7)} ${id}  ${readMetadata(root, id)?.fileName ?? ''}${detail ? `  (${detail})` : ''}`)
        if (result.status === 'failed' || result.status === 'unavailable') process.exitCode = 1
      }
      break
    }
    case 'setup': {
      if (folder && folder !== 'whisper') throw new Error('Usage: shreditor setup whisper [--yes] [--verify]')
      const { setupWhisper } = await import('../server/transcription-setup.mjs')
      if (!(await setupWhisper({ yes: opt.yes, verify: opt.verify, say }))) process.exitCode = 1
      break
    }
    default:
      say('Usage: shreditor open [folder] [--project <id>] | shreditor where | shreditor choose | shreditor import <file...> [--project <id>] [--link] [--category <c>] | shreditor categorize <mediaId>=<category>... | shreditor transcribe <mediaId...> | --project <id> [--force] | shreditor setup whisper [--yes]')
      process.exit(command ? 1 : 0)
  }
} catch (error) {
  console.error(`shreditor: ${error.message}`)
  process.exit(1)
}
