// `shreditor install | uninstall | status | update | restart`: keep the editor
// and the agent service running on this Mac as login items (launchd), and
// update the checkout without losing anyone's unsaved work.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { currentWorkspace } from '../workspace-bridge.mjs'
import {
  changedFiles,
  depsState,
  gitHead,
  linkedNodeModules,
  readBuildStamp,
  runBuild,
  runNpmCi,
  staleBuild,
  treeDirty,
} from './build-state.mjs'
import { checkRestartSafe, updateSteps } from './guard.mjs'
import {
  DEFAULT_LABEL_PREFIX,
  DEFAULT_PORTS,
  bootout,
  bootstrap,
  jobLabel,
  jobPlan,
  jobStatus,
  kickstart,
  writePlist,
} from './launchd.mjs'
import { checkPrereqs, planFixes, realProbe } from './prereqs.mjs'
import {
  editorInfo,
  logFile,
  serviceHealth,
  shreditorPid,
  spawnEditor,
  spawnService,
  stopPid,
  waitFor,
} from './processes.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const KINDS = ['editor', 'service']
const NAMES = { editor: 'the editor', service: 'the agent service' }
const say = (line = '') => process.stdout.write(`${line}\n`)

const OPTIONS = {
  yes: { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  'label-prefix': {
    type: 'string',
    default: process.env.SHREDITOR_LABEL_PREFIX || DEFAULT_LABEL_PREFIX,
  },
  'editor-port': { type: 'string' },
  'service-port': { type: 'string' },
  workspace: { type: 'string' },
  config: { type: 'string' },
  'log-dir': { type: 'string' },
}

const answering = { editor: (url) => editorInfo(url), service: (url) => serviceHealth(url) }

/** The two jobs as options and any installed plists say (installed ports win unless given). */
function jobsFor(opt) {
  const installed = Object.fromEntries(
    KINDS.map((kind) => [kind, jobStatus(jobLabel(opt['label-prefix'], kind))]),
  )
  const ports = {
    editor: Number(opt['editor-port'] ?? installed.editor.port ?? DEFAULT_PORTS.editor),
    service: Number(opt['service-port'] ?? installed.service.port ?? DEFAULT_PORTS.service),
  }
  const plan = jobPlan({
    repo: REPO,
    prefix: opt['label-prefix'],
    ports,
    workspace: opt.workspace,
    config: opt.config,
    ...(opt['log-dir'] ? { logDir: opt['log-dir'] } : {}),
  })
  return { plan, installed }
}

// ── install ────────────────────────────────────────────────────────────────

function printChecks(checks) {
  for (const c of checks) {
    say(`${c.ok ? 'ok     ' : 'missing'}  ${c.label.padEnd(28)} ${c.detail ?? ''}`)
  }
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}

async function runFix(fix) {
  if (fix.kind === 'brew') {
    const brew = realProbe(REPO).which('brew')
    say(`$ brew install ${fix.formulas.join(' ')}`)
    const r = spawnSync(brew, ['install', ...fix.formulas], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`brew install ${fix.formulas.join(' ')} failed`)
  } else if (fix.kind === 'model') {
    const { setupWhisper } = await import('../transcription-setup.mjs')
    await setupWhisper({ yes: true, say })
  } else if (fix.kind === 'npm-ci') runNpmCi(REPO, { say })
  else if (fix.kind === 'build') runBuild(REPO, { reason: 'for the login item', say })
}

/** Check, fix (with consent) and re-check the prerequisites; false when something is still missing. */
async function prerequisites(opt) {
  say('Checking what Shreditor needs:')
  let checks = checkPrereqs(realProbe(REPO))
  printChecks(checks)
  const { auto, manual } = planFixes(checks)
  if (manual.length) {
    say('\nDo these first, then run this again:')
    for (const c of manual) say(`  - ${c.label}: ${c.manual}`)
    return false
  }
  if (!auto.length) return true
  say('\nTo finish, this runs:')
  for (const fix of auto) say(`  ${fix.command}`)
  if (!opt.yes && !(await confirm('Run these now?'))) {
    say(
      process.stdin.isTTY
        ? 'Nothing changed.'
        : 'Run again with --yes to do it, or run them yourself.',
    )
    return false
  }
  for (const fix of auto) await runFix(fix)
  checks = checkPrereqs(realProbe(REPO))
  const still = checks.filter((c) => !c.ok)
  for (const c of still) say(`still missing: ${c.label} (${c.detail})`)
  return !still.length
}

/**
 * Whatever already serves the jobs' ports outside launchd (e.g. `shred up`):
 * [{ kind, pid }] to stop. Throws when that would lose work or isn't Shreditor.
 */
async function foreignProcesses(plan, installed, opt) {
  const found = []
  for (const kind of KINDS) {
    const job = plan[kind]
    const self = await answering[kind](job.url)
    const ours = installed[kind].loaded && installed[kind].pid && installed[kind].port === job.port
    if (ours) continue
    if (!self) {
      if (await portAnswers(job.url))
        throw new Error(
          `Something other than Shreditor is serving ${job.url}. Stop it, or pass --${kind}-port.`,
        )
      continue
    }
    const pid = shreditorPid(kind, { port: job.port, reportedPid: self.pid })
    if (!pid)
      throw new Error(
        `Can't tell which process serves ${NAMES[kind]} at ${job.url}; stop it yourself (shred up started it), then run this again.`,
      )
    found.push({ kind, pid })
  }
  if (found.length)
    await assertSafe(
      plan,
      found.map((f) => f.kind),
      opt,
    )
  return found
}

async function portAnswers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

/** Refuse (throw) when restarting these kinds would lose unsaved work or interrupt the service. */
async function assertSafe(plan, kinds, opt) {
  const urls = Object.fromEntries(kinds.map((kind) => [kind, plan[kind].url]))
  const { blockers } = await checkRestartSafe(urls, { force: opt.force, say })
  if (blockers.length)
    throw new Error(
      `Not safe to stop ${kinds.map((kind) => NAMES[kind]).join(' and ')} now:\n  ${blockers.join('\n  ')}\n(--force does it anyway.)`,
    )
}

async function waitUntilAnswering(job, { oldPid } = {}) {
  const up = await waitFor(
    async () => {
      const status = jobStatus(job.label)
      return status.pid && status.pid !== oldPid && (await answering[job.kind](job.url))
        ? status
        : null
    },
    { timeoutMs: 240_000 },
  )
  if (!up) throw new Error(`${NAMES[job.kind]} did not start; see ${job.log}`)
  return up
}

async function install(opt) {
  if (process.platform !== 'darwin')
    throw new Error('shreditor install sets up macOS login items; on other systems run shred up')
  if (!(await prerequisites(opt))) return 1
  const { plan, installed } = jobsFor(opt)
  for (const { kind, pid } of await foreignProcesses(plan, installed, opt)) {
    say(`Stopping ${NAMES[kind]} that was started by hand (pid ${pid}); the login item takes over.`)
    await stopPid(pid)
  }
  if (KINDS.some((kind) => installed[kind].loaded))
    await assertSafe(
      plan,
      KINDS.filter((kind) => installed[kind].loaded),
      opt,
    )
  for (const kind of KINDS) {
    const job = plan[kind]
    writePlist(job)
    if (installed[kind].loaded) bootout(job.label)
    await bootstrap(job.plistPath)
  }
  say('\nStarting…')
  for (const kind of KINDS) {
    const status = await waitUntilAnswering(plan[kind])
    say(`${kind.padEnd(8)} ${plan[kind].url}  (pid ${status.pid})`)
  }
  say(`\nShreditor is on: open ${plan.editor.url}`)
  say('It starts when you log in and restarts if it stops. Update with: npx shreditor update')
  say(`Logs: ${path.dirname(plan.editor.log)}`)
  return 0
}

// ── uninstall ──────────────────────────────────────────────────────────────

async function uninstall(opt) {
  const { plan, installed } = jobsFor(opt)
  const loaded = KINDS.filter((kind) => installed[kind].loaded)
  if (loaded.length) await assertSafe(plan, loaded, opt)
  for (const kind of KINDS) {
    const label = plan[kind].label
    const unloaded = installed[kind].loaded && bootout(label)
    const file = installed[kind].plistPath
    const removed = fs.existsSync(file)
    fs.rmSync(file, { force: true })
    say(
      `${kind.padEnd(8)} ${unloaded ? 'stopped, ' : ''}${removed ? `removed ${file}` : 'no login item'}`,
    )
  }
  say('Logs, the workspace and ~/.shreditor are left as they are.')
  return 0
}

// ── status ─────────────────────────────────────────────────────────────────

function launchdLine(status) {
  if (!status.installed) return 'no login item'
  if (!status.loaded) return `login item ${status.label}: installed, not loaded`
  return `login item ${status.label}: ${status.state}${status.pid ? `, pid ${status.pid}` : ''}${status.lastExit !== null ? `, last exit ${status.lastExit}` : ''}`
}

function buildLine() {
  const head = gitHead(REPO)
  const stamp = readBuildStamp(REPO)
  const stale = staleBuild(REPO)
  const built = stamp
    ? `built from ${stamp.sha} at ${stamp.builtAt}`
    : 'built (commit not recorded)'
  return `${stale ? `stale: ${stale}` : built}; HEAD ${head?.sha ?? '?'}`
}

async function status(opt) {
  const { plan, installed } = jobsFor(opt)
  const report = {}
  for (const kind of KINDS) {
    const job = plan[kind]
    const self = await answering[kind](job.url)
    // Without a login item, `shred up` logs to the temp folder.
    report[kind] = {
      url: job.url,
      answering: Boolean(self),
      launchd: installed[kind],
      log: installed[kind].log ?? logFile(kind),
    }
    say(`${kind.padEnd(9)} ${job.url}  ${self ? 'answering' : 'not answering'}`)
    say(`          ${launchdLine(installed[kind])}`)
    say(`          log ${report[kind].log}`)
    if (kind === 'editor') report.workspace = self?.root ?? currentWorkspace()
  }
  say(`workspace ${report.workspace}`)
  say(`build     ${buildLine()}`)
  say(`node      ${process.version} (${process.execPath})`)
  if (opt.json) say(JSON.stringify(report, null, 2))
  return 0
}

// ── update / restart ───────────────────────────────────────────────────────

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()

/** Restart both, the login items if installed, else processes `shred up` started. */
async function restartAll(plan, installed, opt) {
  const kinds = []
  for (const kind of KINDS)
    if (installed[kind].loaded || (await answering[kind](plan[kind].url))) kinds.push(kind)
  if (!kinds.length)
    return say('Nothing is running; start it with: shred up (or npx shreditor install)')
  await assertSafe(plan, kinds, opt)
  for (const kind of kinds) {
    if (installed[kind].loaded) await restartJob(plan[kind], installed[kind])
    else await restartProcess(kind, plan[kind])
  }
}

async function restartJob(job, status) {
  kickstart(job.label, { restart: true })
  const now = await waitUntilAnswering(job, { oldPid: status.pid })
  say(`restarted ${NAMES[job.kind]} (login item, pid ${now.pid})`)
}

async function restartProcess(kind, job) {
  const self = await answering[kind](job.url)
  if (kind === 'editor' && self.mode === 'dev')
    return say('the editor is a dev server; it reloads on its own')
  const pid = shreditorPid(kind, { port: job.port, reportedPid: self.pid })
  if (!pid)
    return say(`Restart ${NAMES[kind]} yourself (can't tell its process): stop it, then shred up`)
  // Keep the workspace it was on (pinned if that isn't the configured one).
  const on = kind === 'service' ? (self.workspace ?? currentWorkspace()) : self.root
  const workspace = kind === 'service' || on !== currentWorkspace() ? on : undefined
  await stopPid(pid)
  if (kind === 'editor') spawnEditor({ repo: REPO, port: job.port, workspace })
  else spawnService({ repo: REPO, port: job.port, workspace })
  const now = await waitFor(() => answering[kind](job.url), { timeoutMs: 240_000 })
  if (!now) throw new Error(`${NAMES[kind]} did not come back; run shred up`)
  say(`restarted ${NAMES[kind]} (not a login item; pid ${pid} -> ${now.pid ?? '?'})`)
}

/** Pull, install dependencies if the lockfile moved, build: { from, to, commits } or null when current. */
function pullAndBuild() {
  if (treeDirty(REPO))
    throw new Error(`${REPO} has uncommitted changes; commit or stash them, then update.`)
  const from = gitHead(REPO)
  say('$ git pull --ff-only')
  const pulled = spawnSync('git', ['pull', '--ff-only'], { cwd: REPO, stdio: 'inherit' })
  if (pulled.status !== 0)
    throw new Error('git pull --ff-only failed (see above); nothing was rebuilt or restarted')
  const to = gitHead(REPO)
  const steps = updateSteps({
    from: from.full,
    to: to.full,
    changed: changedFiles(REPO, from.full, to.full),
    depsMismatch: depsState(REPO),
    linkedDeps: linkedNodeModules(REPO),
    stale: staleBuild(REPO),
  })
  if (steps.depsLinkedWarning)
    say(
      `warning: dependencies changed; node_modules is a link to ${linkedNodeModules(REPO)}: run npm ci there`,
    )
  if (steps.npmCi) runNpmCi(REPO, { say })
  if (!steps.build) return null
  runBuild(REPO, { reason: steps.moved ? `${from.sha} -> ${to.sha}` : 'stale build', say })
  return {
    from,
    to,
    commits: steps.moved ? Number(git(['rev-list', '--count', `${from.full}..${to.full}`])) : 0,
  }
}

async function update(opt) {
  const { plan, installed } = jobsFor(opt)
  // Before building: a build replaces what the running editor serves.
  const running = []
  for (const kind of KINDS)
    if (installed[kind].loaded || (await answering[kind](plan[kind].url))) running.push(kind)
  if (running.length) await assertSafe(plan, running, opt)
  const result = pullAndBuild()
  if (!result) {
    say(`Already up to date (${gitHead(REPO).sha}).`)
    return 0
  }
  say(
    result.commits
      ? `Updated ${result.from.sha} -> ${result.to.sha} (${result.commits} commit${result.commits === 1 ? '' : 's'}).`
      : `Rebuilt ${result.to.sha}.`,
  )
  try {
    await restartAll(plan, installed, opt)
  } catch (error) {
    say(`Built, but not restarted: ${error.message}\nWhen it is safe: npx shreditor restart`)
    return 1
  }
  return 0
}

async function restart(opt) {
  const { plan, installed } = jobsFor(opt)
  await restartAll(plan, installed, opt)
  return 0
}

const COMMANDS = { install, uninstall, status, update, restart }
export const INSTALL_COMMANDS = Object.keys(COMMANDS)

/** Run one of INSTALL_COMMANDS with its own options; resolves to the exit code. */
export async function runInstallCommand(command, argv) {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false })
  return COMMANDS[command](values)
}
