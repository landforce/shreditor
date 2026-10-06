#!/usr/bin/env node
// npm run formats:sync [-- --check]
//
// Re-copies the format guides from the ai-video-editor plugin
// ($AI_VIDEO_EDITOR_DIR, else ~/Dev/ai-video-editor) into formats/: each
// format's SKILL.md as formats/<id>/guide.md and references/vdb-research.md as
// formats/<id>/research.md, plus the format decision guide as
// formats/choosing.md. Each copy starts with a header naming its source and the
// source's sha256.
//
// A source containing a forbidden word is refused (not copied). When a guide's
// hash differs from the hash its targets were reviewed against
// (guide.reviewedHash in formats/registry.mjs) it prints a REVIEW line: re-check
// the numeric targets against the new guide, then update reviewedHash.
//
// --check writes nothing and exits 1 when a copy is stale or a review is due.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHOOSING_GUIDE, FORMATS } from '../formats/registry.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Stored encoded so the words themselves never appear in this repository.
export const FORBIDDEN_WORDS = ['dGVzc2VyYWN0', 'aHlwZXJmcmFtZXM='].map((encoded) =>
  Buffer.from(encoded, 'base64').toString('utf8'),
)

export const sha256 = (text) =>
  `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`

/** True when the text contains a forbidden word (any case). */
export function hasForbiddenWord(text) {
  const lower = text.toLowerCase()
  return FORBIDDEN_WORDS.some((word) => lower.includes(word))
}

/** Every vendored file: plugin source -> repo target, with the reviewed hash for guides. */
export function vendoredFiles(formats = FORMATS, choosing = CHOOSING_GUIDE) {
  return [
    ...formats.flatMap((format) => [
      {
        formatId: format.id,
        source: format.guide.source,
        target: format.guide.path,
        reviewedHash: format.guide.reviewedHash,
      },
      { formatId: format.id, source: format.guide.researchSource, target: format.guide.research },
    ]),
    {
      formatId: 'choosing',
      source: choosing.source,
      target: choosing.path,
      reviewedHash: choosing.reviewedHash,
    },
  ]
}

export function renderVendored(source, content, hash) {
  return [
    '<!--',
    `  Vendored from the ai-video-editor plugin: ${source}`,
    `  source-sha256: ${hash}`,
    '  Do not edit here. Change the plugin, then run: npm run formats:sync',
    '-->',
    '',
    content,
  ].join('\n')
}

export function readVendoredHash(text) {
  return /source-sha256: (sha256:[0-9a-f]{64})/.exec(text ?? '')?.[1] ?? null
}

const readOrNull = (file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function syncOne(file, { sourceRoot, repoRoot, write }) {
  const content = readOrNull(path.join(sourceRoot, file.source))
  if (content === null) return { ...file, status: 'missing' }
  if (hasForbiddenWord(content)) return { ...file, status: 'refused' }
  const hash = sha256(content)
  const targetFile = path.join(repoRoot, file.target)
  const existing = readOrNull(targetFile)
  const previousHash = readVendoredHash(existing)
  const review = Boolean(file.reviewedHash) && file.reviewedHash !== hash
  // Byte for byte: a copy edited (or reformatted) here is restored too.
  const rendered = renderVendored(file.source, content, hash)
  if (existing === rendered) return { ...file, status: 'unchanged', hash, previousHash, review }
  if (write) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true })
    fs.writeFileSync(targetFile, rendered)
  }
  return { ...file, status: write ? 'copied' : 'stale', hash, previousHash, review }
}

/**
 * Sync every vendored file. Returns { files, ok }: each file has status
 * copied | unchanged | stale (check mode) | refused | missing, its hash, the
 * previous vendored hash, and review: true when it differs from reviewedHash.
 */
export function syncFormats({
  sourceRoot,
  repoRoot = REPO,
  write = true,
  files = vendoredFiles(),
} = {}) {
  const results = files.map((file) => syncOne(file, { sourceRoot, repoRoot, write }))
  const broken = results.some((r) => r.status === 'refused' || r.status === 'missing')
  const due = results.some((r) => r.status === 'stale' || r.review)
  return { files: results, ok: !broken && (write || !due) }
}

const short = (hash) => (hash ? hash.slice(0, 19) : 'none')

export function describeSync(report) {
  const lines = report.files.map((file) => {
    if (file.status === 'missing') return `MISSING    ${file.source} (not found in the plugin)`
    if (file.status === 'refused') {
      return `REFUSED    ${file.source} contains a forbidden word; ${file.target} left as is`
    }
    const change = file.status === 'unchanged' ? '' : `  (${short(file.previousHash)} -> ${short(file.hash)})`
    return `${file.status.padEnd(10)} ${file.target}${change}`
  })
  for (const file of report.files.filter((f) => f.review)) {
    lines.push(
      `REVIEW     ${file.formatId}: ${file.source} changed since its targets were reviewed ` +
        `(reviewed ${short(file.reviewedHash)}, now ${short(file.hash)}). Re-check the targets and ` +
        `rules in formats/registry.mjs against ${file.target}, then set reviewedHash to ${file.hash}.`,
    )
  }
  return lines
}

function main() {
  const check = process.argv.includes('--check')
  const sourceRoot =
    process.env.AI_VIDEO_EDITOR_DIR || path.join(os.homedir(), 'Dev', 'ai-video-editor')
  if (!fs.existsSync(sourceRoot)) {
    process.stderr.write(`formats:sync: plugin not found at ${sourceRoot} (set AI_VIDEO_EDITOR_DIR)\n`)
    process.exit(1)
  }
  const report = syncFormats({ sourceRoot, write: !check })
  for (const line of describeSync(report)) process.stdout.write(`${line}\n`)
  process.exitCode = report.ok ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
