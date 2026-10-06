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
//   shreditor media <mediaId...> | --project <id> [--wait] [--retry] [--json]
//                                              working-copy state: ready (and from -> to), preparing
//                                              NN%, or failed (why); --wait until none is preparing,
//                                              --retry a failed one. Also each media's category with
//                                              who set it ([speaker auto] = suggested by the editor's
//                                              background analysis, unconfirmed) and transcript state.
//   shreditor categorize <mediaId>=<category>... | --category <category> <mediaId>...
//                                              set what each media is for (speaker, b-roll, graphics,
//                                              overlay, voiceover, music, sfx, other; "none" clears),
//                                              as the agent: explicit, so the editor never changes it.
//                                              Re-setting an auto suggestion confirms it.
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
import { importMediaByPath, MEDIA_CATEGORIES, projectMediaCategories, setMediaCategories } from '../server/media-bridge.mjs'
import { preparationStates, readMetadata, retryPreparation, waitForPreparation } from '../server/media-preparation.mjs'
import { currentWorkspace, DEFAULT_WORKSPACE, setWorkspace } from '../server/workspace-bridge.mjs'
import { enableAutoTranscription, readTranscriptionStatus, settleHandoffs, transcribeMedia } from '../server/transcription.mjs'

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
    force: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
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

/** "[speaker auto]" (a suggestion), "[b-roll agent]", "[graphics]" (explicit, older metadata), "" when none. */
const categoryTag = (m) => (m?.category ? `  [${m.category}${m.categorySource ? ` ${m.categorySource}` : ''}]` : '')
const transcriptTag = (m) => (m?.transcription?.status ? `  transcript: ${m.transcription.status}` : '')

const stateLine = (root, s) => {
  const m = readMetadata(root, s.id)
  return `${s.status.padEnd(9)} ${s.id}  ${s.fileName ?? ''}${categoryTag(m)}${s.status === 'ready' ? workingCopyLine(root, s.id) || '  plays as is' : `  ${describe(s)}`}${transcriptTag(m)}`
}

/** "speaker (auto)" / "none" for categorize output. */
const categoryLabel = (category, source) => (category ? `${category}${source ? ` (${source})` : ''}` : `none${source ? ` (${source})` : ''}`)

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
      // New audio/video is transcribed by the editor's bridge when it is running.
      enableAutoTranscription({ mode: 'handoff', bridgeUrl: base })
      // Working copies are made by a detached worker, so --no-wait can return.
      const results = await importMediaByPath(root, files, {
        projectId: opt.project,
        mode: opt.link ? 'link' : 'auto',
        category: opt.category,
        prepare: 'detached',
      })
      const handedOff = new Set(await settleHandoffs())
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
      const queued = results.filter((r) => !r.error && !r.duplicate && readTranscriptionStatus(root, r.id)?.status === 'queued')
      if (queued.some((r) => handedOff.has(r.id))) {
        say(`Transcribing new audio/video in the background (locally, whisper.cpp, in the editor at ${base}); read one with: shred transcript <mediaId>`)
      }
      if (queued.some((r) => !handedOff.has(r.id))) {
        say(`Queued for transcription; no editor at ${base} for this workspace, so it starts when the editor next runs (or now: shreditor transcribe <mediaId>)`)
      }
      if (results.some((r) => r.error)) process.exitCode = 1
      break
    }
    case 'media': {
      const root = currentWorkspace()
      const ids = [folder, ...rest].filter(Boolean)
      if (opt.project) ids.push(...projectMediaCategories(root, opt.project).map((m) => m.mediaId))
      if (!ids.length) throw new Error('Usage: shreditor media <mediaId...> | --project <id> [--wait] [--retry] [--json]')
      if (opt.retry) for (const id of ids) await retryPreparation(root, id, { detached: true })
      const states = opt.wait || opt.retry ? await waitAndPrint(root, ids) : preparationStates(root, ids)
      if (opt.json) {
        say(JSON.stringify(ids.map((id) => {
          const m = readMetadata(root, id)
          return {
            ...states.find((s) => s.id === id),
            category: m?.category ?? null,
            // auto = suggested by the editor's analysis; explicit = set before sources were recorded
            categorySource: m?.categorySource ?? (m?.category ? 'explicit' : null),
            transcription: m?.transcription ?? null,
            compatibility: m?.compatibility ?? null,
          }
        }), null, 2))
      }
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
      const { changed, unchanged } = setMediaCategories(currentWorkspace(), items, { source: 'agent' })
      for (const c of changed) say(`set     ${c.mediaId}  ${categoryLabel(c.from, c.fromSource)} -> ${categoryLabel(c.to, c.source)}`)
      for (const u of unchanged) say(`same    ${u.mediaId}  ${categoryLabel(u.category, u.source)}`)
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
      say('Usage: shreditor open [folder] [--project <id>] | shreditor where | shreditor choose | shreditor import <file...> [--project <id>] [--link] [--category <c>] [--no-wait] | shreditor media <mediaId...> | --project <id> [--wait] [--retry] [--json] | shreditor categorize <mediaId>=<category>... | shreditor transcribe <mediaId...> | --project <id> [--force] | shreditor setup whisper [--yes]')
      process.exit(command ? 1 : 0)
  }
} catch (error) {
  console.error(`shreditor: ${error.message}`)
  process.exit(1)
}
