// The checkout's state: git HEAD, whether the built editor (dist/) is current,
// and whether node_modules matches package-lock.json. Shared by `shred up`,
// `shreditor install`, `shreditor update` and `shreditor status`.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STAMP = '.shreditor-build.json'

/** { sha (short), full, time (seconds) } of HEAD, or null outside a git checkout. */
export function gitHead(repo) {
  try {
    const [sha, full, time] = execFileSync('git', ['log', '-1', '--format=%h %H %ct', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(' ')
    return { sha, full, time: Number(time) }
  } catch {
    return null
  }
}

/** What runBuild recorded about the build in dist/: { sha, full, builtAt }, or null. */
export function readBuildStamp(repo) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repo, 'dist', STAMP), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Why the built editor is stale, or null when it is current: missing, built from
 * another commit (when runBuild stamped it), else older than the checked-out commit.
 */
export function staleBuild(repo) {
  const index = path.join(repo, 'dist', 'index.html')
  if (!fs.existsSync(index)) return 'no build yet'
  const head = gitHead(repo)
  if (!head) return null
  const stamp = readBuildStamp(repo)
  if (stamp?.full)
    return stamp.full === head.full ? null : `build is of ${stamp.sha}, HEAD is ${head.sha}`
  if (fs.statSync(index).mtimeMs / 1000 < head.time) return `build is older than ${head.sha}`
  return null
}

/** `npm run build`, logged to `log`; stamps dist/ with the commit it was built from. */
export function runBuild(
  repo,
  { reason, say = () => {}, log = path.join(os.tmpdir(), 'shreditor-build.log') } = {},
) {
  say(`Building Shreditor${reason ? ` (${reason})` : ''}…`)
  try {
    execFileSync('npm', ['run', 'build'], {
      cwd: repo,
      stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log, 'a')],
    })
  } catch {
    throw new Error(`Build failed; see ${log}`)
  }
  const head = gitHead(repo)
  if (head) {
    const stamp = { sha: head.sha, full: head.full, builtAt: new Date().toISOString() }
    fs.writeFileSync(path.join(repo, 'dist', STAMP), `${JSON.stringify(stamp, null, 2)}\n`)
  }
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Compare package-lock.json with what npm last installed (node_modules/.package-lock.json).
 * Returns null when they match, else why not. Optional packages (other platforms) may be absent.
 */
export function compareLockfiles(lock, installed) {
  if (!installed) return 'node_modules is missing or was not installed by npm'
  const have = installed.packages ?? {}
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!key) continue
    const got = have[key]
    if (!got && !entry.optional && !entry.peer)
      return `${key.replace(/^.*node_modules\//, '')} is not installed`
    if (got && got.version !== entry.version)
      return `${key.replace(/^.*node_modules\//, '')} is ${got.version}, package-lock wants ${entry.version}`
  }
  return null
}

/** Why node_modules needs `npm ci`, or null. */
export function depsState(repo) {
  if (!fs.existsSync(path.join(repo, 'node_modules'))) return 'node_modules is missing'
  return compareLockfiles(
    readJson(path.join(repo, 'package-lock.json')),
    readJson(path.join(repo, 'node_modules', '.package-lock.json')),
  )
}

/** node_modules is a link to another checkout's: never reinstall through it. */
export function linkedNodeModules(repo) {
  try {
    return fs.lstatSync(path.join(repo, 'node_modules')).isSymbolicLink()
      ? fs.realpathSync(path.join(repo, 'node_modules'))
      : null
  } catch {
    return null
  }
}

/** `npm ci`, refusing a linked node_modules (it would empty the other checkout's). */
export function runNpmCi(
  repo,
  { say = () => {}, log = path.join(os.tmpdir(), 'shreditor-npm-ci.log') } = {},
) {
  const linked = linkedNodeModules(repo)
  if (linked)
    throw new Error(`node_modules is a link to ${linked}; run npm ci in that checkout instead`)
  say('Installing dependencies (npm ci)…')
  try {
    execFileSync('npm', ['ci'], {
      cwd: repo,
      stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log, 'a')],
    })
  } catch {
    throw new Error(`npm ci failed; see ${log}`)
  }
}

/** Tracked files with uncommitted changes (untracked files don't block a fast-forward). */
export function treeDirty(repo) {
  return (
    execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim() !== ''
  )
}

/** Files that differ between two commits. */
export function changedFiles(repo, from, to) {
  if (from === to) return []
  return execFileSync('git', ['diff', '--name-only', from, to], { cwd: repo, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
}
