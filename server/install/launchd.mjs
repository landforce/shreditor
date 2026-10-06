// macOS login items for the editor and the agent service: launchd LaunchAgents
// that start at login, restart after a crash (throttled), and log to
// ~/Library/Logs/Shreditor/. `shreditor install` writes and loads them.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_LABEL_PREFIX = 'app.shreditor'
export const DEFAULT_PORTS = { editor: 5273, service: 8787 }
/** launchd starts a job at most once per this many seconds, so a crash loop can't spin. */
export const THROTTLE_SECONDS = 10
const KINDS = ['editor', 'service']
// launchd's own PATH is /usr/bin:/bin:/usr/sbin:/sbin; ffmpeg, ffprobe and
// whisper-cli live in Homebrew's prefix (Apple silicon, then Intel).
const SYSTEM_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]

export const jobLabel = (prefix, kind) => `${prefix}.${kind}`
export const agentsDir = (home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents')
export const plistPath = (label, home = os.homedir()) =>
  path.join(agentsDir(home), `${label}.plist`)
export const defaultLogDir = (home = os.homedir()) =>
  path.join(home, 'Library', 'Logs', 'Shreditor')

/** PATH for the jobs: this node's folder first (npm), then Homebrew, then the system. */
export function jobPath(nodePath) {
  return [...new Set([path.dirname(nodePath), ...SYSTEM_PATH])].join(':')
}

function programArguments(kind, { repo, nodePath, port }) {
  // The editor: the built preview (`npm run preview`), on a fixed port.
  if (kind === 'editor')
    return [
      nodePath,
      path.join(repo, 'node_modules', '.bin', 'vp'),
      'preview',
      '--port',
      String(port),
      '--strictPort',
    ]
  // The service resolves the workspace from the config each time it starts.
  return [nodePath, path.join(repo, 'server', 'install', 'run-service.mjs'), '--port', String(port)]
}

/**
 * Both jobs for this checkout: label, plist path and contents, port, URL, log.
 * `workspace` / `config` pin SHREDITOR_WORKSPACE / SHREDITOR_CONFIG for both jobs
 * (tests); otherwise they follow ~/.shreditor/config.json.
 */
export function jobPlan({
  repo,
  nodePath = process.execPath,
  home = os.homedir(),
  prefix = DEFAULT_LABEL_PREFIX,
  ports = DEFAULT_PORTS,
  workspace,
  config,
  logDir = defaultLogDir(home),
}) {
  const env = {
    PATH: jobPath(nodePath),
    ...(workspace ? { SHREDITOR_WORKSPACE: path.resolve(workspace) } : {}),
    ...(config ? { SHREDITOR_CONFIG: path.resolve(config) } : {}),
  }
  const plan = {}
  for (const kind of KINDS) {
    const label = jobLabel(prefix, kind)
    const port = Number(ports[kind])
    const log = path.join(logDir, `${kind}.log`)
    plan[kind] = {
      kind,
      label,
      port,
      url: kind === 'editor' ? `http://localhost:${port}` : `http://127.0.0.1:${port}`,
      log,
      plistPath: plistPath(label, home),
      plist: {
        Label: label,
        ProgramArguments: programArguments(kind, { repo, nodePath, port }),
        WorkingDirectory: repo,
        EnvironmentVariables: env,
        RunAtLoad: true,
        KeepAlive: true,
        ThrottleInterval: THROTTLE_SECONDS,
        // The service drains its queue for up to 30 s on SIGTERM.
        ExitTimeOut: 40,
        ProcessType: 'Interactive',
        StandardOutPath: log,
        StandardErrorPath: log,
      },
    }
  }
  return plan
}

const xmlEscape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function plistValue(value, indent) {
  const pad = '  '.repeat(indent)
  if (typeof value === 'boolean') return `${pad}<${value}/>`
  if (typeof value === 'number') return `${pad}<integer>${value}</integer>`
  if (Array.isArray(value))
    return [`${pad}<array>`, ...value.map((v) => plistValue(v, indent + 1)), `${pad}</array>`].join(
      '\n',
    )
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).flatMap(([k, v]) => [
      `${pad}  <key>${xmlEscape(k)}</key>`,
      plistValue(v, indent + 1),
    ])
    return [`${pad}<dict>`, ...entries, `${pad}</dict>`].join('\n')
  }
  return `${pad}<string>${xmlEscape(value)}</string>`
}

/** An XML property list for a plain object (strings, integers, booleans, arrays, dicts). */
export function plistXml(object) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    plistValue(object, 0),
    '</plist>',
    '',
  ].join('\n')
}

/** Read an installed plist back (via plutil), or null when there is none. */
export function readPlist(file) {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(
      execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }),
    )
  } catch {
    return null
  }
}

/** The --port a job was installed with. */
export const plistPort = (plist) => {
  const args = plist?.ProgramArguments ?? []
  const at = args.indexOf('--port')
  return at >= 0 ? Number(args[at + 1]) : null
}

const domain = () => `gui/${process.getuid()}`

/** Run launchctl; { status, stdout, stderr }. Tests pass their own `run`. */
export function launchctl(args, { run = spawnSync } = {}) {
  const r = run('launchctl', args, { encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Parse `launchctl print gui/<uid>/<label>`: state, pid and last exit code. */
export function parsePrint(text) {
  const field = (name) => new RegExp(`^\\s*${name} = (.+)$`, 'm').exec(text)?.[1]?.trim()
  const pid = Number(field('pid'))
  const exit = field('last exit code')
  return {
    state: field('state') ?? 'unknown',
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    lastExit: exit === undefined || /never/.test(exit) ? null : exit,
  }
}

/** { label, plistPath, installed, loaded, state, pid, lastExit, plist, port, log } for one job label. */
export function jobStatus(label, { home = os.homedir(), run } = {}) {
  const file = plistPath(label, home)
  const plist = readPlist(file)
  const printed = launchctl(['print', `${domain()}/${label}`], { run })
  const loaded = printed.status === 0
  return {
    label,
    plistPath: file,
    installed: Boolean(plist),
    loaded,
    ...(loaded ? parsePrint(printed.stdout) : { state: 'not loaded', pid: null, lastExit: null }),
    plist,
    port: plistPort(plist),
    log: plist?.StandardOutPath ?? null,
  }
}

/** Unload a job if it is loaded (stops it). */
export function bootout(label, { run } = {}) {
  return launchctl(['bootout', `${domain()}/${label}`], { run }).status === 0
}

/** Load a plist (starts it: RunAtLoad). Retries briefly: a job just booted out can take a moment to go. */
export async function bootstrap(file, { run, tries = 10 } = {}) {
  let last
  for (let i = 0; i < tries; i++) {
    last = launchctl(['bootstrap', domain(), file], { run })
    if (last.status === 0) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `launchctl bootstrap ${file} failed: ${last.stderr.trim() || `exit ${last.status}`}`,
  )
}

/** Start a loaded job now, or restart it when running (-k). */
export function kickstart(label, { restart = false, run } = {}) {
  const r = launchctl(['kickstart', ...(restart ? ['-k'] : []), `${domain()}/${label}`], { run })
  if (r.status !== 0)
    throw new Error(`launchctl kickstart ${label} failed: ${r.stderr.trim() || `exit ${r.status}`}`)
}

/** Write a job's plist (and its log folder). */
export function writePlist(job) {
  fs.mkdirSync(path.dirname(job.plistPath), { recursive: true })
  fs.mkdirSync(path.dirname(job.log), { recursive: true })
  fs.writeFileSync(job.plistPath, plistXml(job.plist))
}
