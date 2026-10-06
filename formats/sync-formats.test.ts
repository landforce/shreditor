import { onTestFinished, test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  FORBIDDEN_WORDS,
  describeSync,
  hasForbiddenWord,
  readVendoredHash,
  sha256,
  syncFormats,
  vendoredFiles,
} from '../scripts/sync-formats.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'formats-sync-'))
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }))
  const plugin = path.join(root, 'plugin')
  const repo = path.join(root, 'repo')
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(plugin, file)), { recursive: true })
    fs.writeFileSync(path.join(plugin, file), text)
  }
  return { plugin, repo, write }
}

const GUIDE = '# Demo\n\n| Length | 10-20 s |\n'

test('copies each source with a header naming it and its hash', () => {
  const { plugin, repo, write } = fixture()
  write('skills/demo/SKILL.md', GUIDE)
  const files = [
    {
      formatId: 'demo',
      source: 'skills/demo/SKILL.md',
      target: 'formats/demo/guide.md',
      reviewedHash: sha256(GUIDE),
    },
  ]
  const first = syncFormats({ sourceRoot: plugin, repoRoot: repo, files })
  assert.equal(first.ok, true)
  assert.equal(first.files[0]!.status, 'copied')
  assert.equal(first.files[0]!.review, false)
  const copy = fs.readFileSync(path.join(repo, 'formats/demo/guide.md'), 'utf8')
  assert.ok(copy.includes('skills/demo/SKILL.md'))
  assert.equal(readVendoredHash(copy), sha256(GUIDE))
  assert.ok(copy.endsWith(GUIDE))
  assert.equal(
    syncFormats({ sourceRoot: plugin, repoRoot: repo, files }).files[0]!.status,
    'unchanged',
  )
  // A copy edited (or reformatted) here is restored from the source.
  fs.writeFileSync(path.join(repo, 'formats/demo/guide.md'), copy.replace('10-20', '10 - 20'))
  const restored = syncFormats({ sourceRoot: plugin, repoRoot: repo, files })
  assert.equal(restored.files[0]!.status, 'copied')
  assert.equal(restored.files[0]!.review, false)
  assert.equal(fs.readFileSync(path.join(repo, 'formats/demo/guide.md'), 'utf8'), copy)
})

test('reports a guide whose hash changed since its targets were reviewed', () => {
  const { plugin, repo, write } = fixture()
  write('skills/demo/SKILL.md', GUIDE)
  const files = [
    {
      formatId: 'demo',
      source: 'skills/demo/SKILL.md',
      target: 'formats/demo/guide.md',
      reviewedHash: sha256(GUIDE),
    },
  ]
  syncFormats({ sourceRoot: plugin, repoRoot: repo, files })
  const changed = GUIDE.replace('10-20', '12-18')
  write('skills/demo/SKILL.md', changed)

  const check = syncFormats({ sourceRoot: plugin, repoRoot: repo, files, write: false })
  assert.equal(check.ok, false, '--check fails when stale or due for review')
  assert.equal(check.files[0]!.status, 'stale')
  assert.equal(
    readVendoredHash(fs.readFileSync(path.join(repo, 'formats/demo/guide.md'), 'utf8')),
    sha256(GUIDE),
    'check writes nothing',
  )

  const synced = syncFormats({ sourceRoot: plugin, repoRoot: repo, files })
  assert.equal(synced.files[0]!.status, 'copied')
  assert.equal(synced.files[0]!.review, true)
  assert.equal(synced.files[0]!.previousHash, sha256(GUIDE))
  const lines = describeSync(synced)
  assert.ok(
    lines.some(
      (line) =>
        line.startsWith('REVIEW') && line.includes('demo') && line.includes(sha256(changed)),
    ),
  )
  // Files without a reviewed hash (research) never ask for a review.
  const research = [
    { formatId: 'demo', source: 'skills/demo/SKILL.md', target: 'formats/demo/research.md' },
  ]
  assert.equal(
    syncFormats({ sourceRoot: plugin, repoRoot: repo, files: research }).files[0]!.review,
    false,
  )
})

test('refuses a source containing a forbidden word, in any case', () => {
  const { plugin, repo, write } = fixture()
  const word = FORBIDDEN_WORDS[1]!
  write('skills/demo/SKILL.md', `# Demo\nRender with ${word[0]!.toUpperCase()}${word.slice(1)}.\n`)
  write('skills/other/SKILL.md', GUIDE)
  const files = [
    { formatId: 'demo', source: 'skills/demo/SKILL.md', target: 'formats/demo/guide.md' },
    { formatId: 'other', source: 'skills/other/SKILL.md', target: 'formats/other/guide.md' },
  ]
  const report = syncFormats({ sourceRoot: plugin, repoRoot: repo, files })
  assert.equal(report.ok, false)
  assert.equal(report.files[0]!.status, 'refused')
  assert.equal(fs.existsSync(path.join(repo, 'formats/demo/guide.md')), false)
  assert.equal(report.files[1]!.status, 'copied', 'other files still sync')
  const line = describeSync(report).find((l) => l.startsWith('REFUSED'))
  assert.ok(line)
  assert.equal(hasForbiddenWord(line), false, 'the report never repeats the word')
  assert.equal(hasForbiddenWord(FORBIDDEN_WORDS[0]!.toUpperCase()), true)
})

test('a missing source fails the sync', () => {
  const { plugin, repo } = fixture()
  fs.mkdirSync(plugin, { recursive: true })
  const files = [
    { formatId: 'demo', source: 'skills/demo/SKILL.md', target: 'formats/demo/guide.md' },
  ]
  const report = syncFormats({ sourceRoot: plugin, repoRoot: repo, files })
  assert.equal(report.ok, false)
  assert.equal(report.files[0]!.status, 'missing')
})

test('the real file list covers every format guide, research file and the decision guide', () => {
  const files = vendoredFiles()
  assert.equal(files.length, 9)
  assert.ok(files.some((f) => f.target === 'formats/choosing.md' && f.reviewedHash))
  for (const id of ['graphic-yap', 'greenscreen', 'vlog', 'ten-shot']) {
    assert.ok(
      files.some(
        (f) =>
          f.target === `formats/${id}/guide.md` &&
          f.source === `skills/${id}/SKILL.md` &&
          f.reviewedHash,
      ),
    )
    assert.ok(
      files.some(
        (f) =>
          f.target === `formats/${id}/research.md` &&
          f.source === `skills/${id}/references/vdb-research.md`,
      ),
    )
  }
})
