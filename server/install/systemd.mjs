// Linux login items for the editor and the agent service: systemd user units
// (~/.config/systemd/user/<label>.service) that start with your session,
// restart after a crash (throttled), and log to ~/.local/state/shreditor/logs/.
// Same API as launchd.mjs (see login-items.mjs). Where systemd user services
// aren't running (containers, WSL without systemd), unavailable() says why and
// `shreditor install` falls back to `shred up`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultLogDir as logDirFor, extraToolDirs } from '../platform.mjs'
import {
  DEFAULT_LABEL_PREFIX,
  DEFAULT_PORTS,
  KINDS,
  THROTTLE_SECONDS,
  jobLabel,
  jobUrl,
  programArguments,
} from './launchd.mjs'

const p = path.posix
export const KIND_NAME = 'systemd user service'
export const unitName = (label) => `${label}.service`
export const unitsDir = (home = os.homedir()) => p.join(home, '.config', 'systemd', 'user')
export const unitPath = (label, home = os.homedir()) => p.join(unitsDir(home), unitName(label))
export const defaultLogDir = (home = os.homedir()) => logDirFor('linux', home, {})

/** PATH for the units: this node's folder, Homebrew and /usr/local, then the PATH install ran with. */
export function jobPath(nodePath, { home = os.homedir(), pathEnv = process.env.PATH ?? '' } = {}) {
  return [
    ...new Set([
      p.dirname(nodePath),
      ...extraToolDirs('linux', home, {}),
      ...pathEnv.split(':'),
      '/usr/bin',
      '/bin',
    ]),
  ]
    .filter(Boolean)
    .join(':')
}

// systemd expands % specifiers in these lines (and $VARIABLES in ExecStart):
// double them, and quote each word C-style.
const escapeUnit = (s) => String(s).replace(/%/g, '%%')
const quote = (s) => `"${escapeUnit(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const quoteArg = (s) => quote(s).replace(/\$/g, '$$$$')

/** The unit file for one job. */
export function unitFile(job) {
  return [
    `# Shreditor ${job.kind} (written by shreditor install)`,
    '[Unit]',
    `Description=Shreditor ${job.kind === 'editor' ? 'editor' : 'agent service'} (${job.label})`,
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${escapeUnit(job.repo)}`,
    ...Object.entries(job.env).map(([key, value]) => `Environment=${quote(`${key}=${value}`)}`),
    `ExecStart=${job.args.map(quoteArg).join(' ')}`,
    'Restart=always',
    `RestartSec=${THROTTLE_SECONDS}`,
    // The service drains its queue for up to 30 s on SIGTERM.
    'TimeoutStopSec=40',
    `StandardOutput=append:${escapeUnit(job.log)}`,
    `StandardError=append:${escapeUnit(job.log)}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}

/** Both jobs for this checkout, as launchd.mjs's jobPlan (itemPath is the unit file). */
export function jobPlan({
  repo,
  nodePath = process.execPath,
  home = os.homedir(),
  prefix = DEFAULT_LABEL_PREFIX,
  ports = DEFAULT_PORTS,
  workspace,
  config,
  logDir = defaultLogDir(home),
  pathEnv,
}) {
  const plan = {}
  for (const kind of KINDS) {
    const label = jobLabel(prefix, kind)
    const port = Number(ports[kind])
    const job = {
      kind,
      label,
      port,
      url: jobUrl(kind, port),
      log: p.join(logDir, `${kind}.log`),
      itemPath: unitPath(label, home),
      repo,
      args: programArguments(kind, { repo, nodePath, port, p }),
      env: {
        PATH: jobPath(nodePath, { home, pathEnv }),
        SHREDITOR_JOB: label,
        ...(workspace ? { SHREDITOR_WORKSPACE: path.resolve(workspace) } : {}),
        ...(config ? { SHREDITOR_CONFIG: path.resolve(config) } : {}),
      },
    }
    plan[kind] = { ...job, unit: unitFile(job) }
  }
  return plan
}

/** Run systemctl --user; { status, stdout, stderr }. Tests pass their own `run`. */
export function systemctl(args, { run = spawnSync } = {}) {
  const r = run('systemctl', ['--user', ...args], { encoding: 'utf8' })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? String(r.error?.message ?? ''),
  }
}

/** Why user units can't be used here, or null when they can. */
export function unavailable({ run } = {}) {
  const r = systemctl(['show-environment'], { run })
  if (r.status === 0) return null
  return `systemd user services aren't running here (${r.stderr.trim().split('\n')[0] || `systemctl exit ${r.status}`})`
}

/** Parse `systemctl show` key=value lines. */
export function parseShow(text) {
  const props = Object.fromEntries(
    text
      .split('\n')
      .map((line) => /^(\w+)=(.*)$/.exec(line))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  )
  const pid = Number(props.MainPID)
  const exit = props.ExecMainStatus
  return {
    enabled: props.UnitFileState === 'enabled',
    state: props.ActiveState
      ? `${props.ActiveState}${props.SubState ? ` (${props.SubState})` : ''}`
      : 'unknown',
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    lastExit: exit && exit !== '0' ? exit : null,
  }
}

/** The --port and log of an installed unit file. */
export function parseUnit(text) {
  const exec = /^ExecStart=(.*)$/m.exec(text ?? '')?.[1] ?? ''
  const port = /"--port" "(\d+)"/.exec(exec)?.[1]
  const log = /^StandardOutput=append:(.*)$/m.exec(text ?? '')?.[1]
  return { port: port ? Number(port) : null, log: log ? log.replace(/%%/g, '%') : null }
}

/** As launchd.mjs: loaded means enabled (on at login, kept running). */
export function jobStatus(label, { home = os.homedir(), run } = {}) {
  const file = unitPath(label, home)
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  const shown = text
    ? systemctl(
        [
          'show',
          unitName(label),
          '-p',
          'UnitFileState',
          '-p',
          'ActiveState',
          '-p',
          'SubState',
          '-p',
          'MainPID',
          '-p',
          'ExecMainStatus',
        ],
        { run },
      )
    : null
  const status = shown?.status === 0 ? parseShow(shown.stdout) : null
  const loaded = Boolean(status?.enabled)
  return {
    label,
    itemPath: file,
    installed: Boolean(text),
    loaded,
    ...(loaded
      ? { state: status.state, pid: status.pid, lastExit: status.lastExit }
      : { state: 'not loaded', pid: null, lastExit: null }),
    ...parseUnit(text),
  }
}

function must(args, { run } = {}) {
  const r = systemctl(args, { run })
  if (r.status !== 0)
    throw new Error(
      `systemctl --user ${args.join(' ')} failed: ${r.stderr.trim() || `exit ${r.status}`}`,
    )
}

/** Stop a job and turn it off; true when it was on. */
export function bootout(label, { run } = {}) {
  return systemctl(['disable', '--now', unitName(label)], { run }).status === 0
}

/** Turn a unit file on: enabled at login, and started now. */
export async function bootstrap(file, { run } = {}) {
  must(['daemon-reload'], { run })
  must(['enable', '--now', p.basename(file)], { run })
}

/** Start an enabled job now, or restart it when running. */
export function kickstart(label, { restart = false, run } = {}) {
  must([restart ? 'restart' : 'start', unitName(label)], { run })
}

/** Write a job's unit file (and its log folder). */
export function writeJob(job) {
  fs.mkdirSync(p.dirname(job.itemPath), { recursive: true })
  fs.mkdirSync(p.dirname(job.log), { recursive: true })
  fs.writeFileSync(job.itemPath, job.unit)
}

/** Remove a stopped job's unit file; true when there was one. */
export function removeJob(file, { run } = {}) {
  const existed = fs.existsSync(file)
  fs.rmSync(file, { force: true })
  if (existed) systemctl(['daemon-reload'], { run })
  return existed
}
