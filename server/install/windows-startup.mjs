// Windows login items for the editor and the agent service: a script in your
// Startup folder (no admin rights needed) that runs each one hidden under
// supervise.mjs, which restarts it when it stops (throttled) and logs to
// %LOCALAPPDATA%\Shreditor\Logs\. Same API as launchd.mjs (see login-items.mjs).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultLogDir as logDirFor, extraToolDirs } from '../platform.mjs'
import {
  DEFAULT_LABEL_PREFIX,
  DEFAULT_PORTS,
  KINDS,
  jobLabel,
  jobUrl,
  programArguments,
} from './launchd.mjs'
import { alive, readState, supervisorRunning } from './supervise.mjs'

const p = path.win32
export const KIND_NAME = 'Startup folder item'
const appData = (home, env) => env.APPDATA || p.join(home, 'AppData', 'Roaming')
export const startupDir = (home = os.homedir(), env = process.env) =>
  p.join(appData(home, env), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
export const itemPath = (label, home = os.homedir(), env = process.env) =>
  p.join(startupDir(home, env), `${label}.vbs`)
export const defaultLogDir = (home = os.homedir(), env = process.env) =>
  logDirFor('win32', home, env)

/** PATH for the jobs: this node's folder, winget's links, then the PATH install ran with. */
export function jobPath(nodePath, { home = os.homedir(), env = process.env } = {}) {
  return [
    ...new Set([
      p.dirname(nodePath),
      ...extraToolDirs('win32', home, env),
      ...String(env.PATH ?? env.Path ?? '').split(';'),
    ]),
  ]
    .filter(Boolean)
    .join(';')
}

/** One argument on a Windows command line (CommandLineToArgvW rules). */
export function winQuote(arg) {
  const s = String(arg)
  if (s && !/[\s"]/.test(s)) return s
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

/** The .vbs that starts a job hidden (WScript.Shell.Run, window style 0, don't wait). */
export function startupScript(job) {
  const line = job.command.map(winQuote).join(' ')
  return [
    `' Shreditor ${job.kind} (${job.label}), written by shreditor install`,
    `CreateObject("WScript.Shell").Run "${line.replace(/"/g, '""')}", 0, False`,
    '',
  ].join('\r\n')
}

/** Both jobs for this checkout, as launchd.mjs's jobPlan (itemPath is the Startup script). */
export function jobPlan({
  repo,
  nodePath = process.execPath,
  home = os.homedir(),
  env = process.env,
  prefix = DEFAULT_LABEL_PREFIX,
  ports = DEFAULT_PORTS,
  workspace,
  config,
  logDir = defaultLogDir(home, env),
}) {
  const plan = {}
  for (const kind of KINDS) {
    const label = jobLabel(prefix, kind)
    const port = Number(ports[kind])
    const log = p.join(logDir, `${kind}.log`)
    const state = p.join(logDir, `${kind}.state.json`)
    const jobEnv = {
      PATH: jobPath(nodePath, { home, env }),
      SHREDITOR_JOB: label,
      ...(workspace ? { SHREDITOR_WORKSPACE: p.resolve(workspace) } : {}),
      ...(config ? { SHREDITOR_CONFIG: p.resolve(config) } : {}),
    }
    const args = programArguments(kind, {
      repo,
      nodePath,
      port,
      p,
      editorBin: ['node_modules', 'vite-plus', 'bin', 'vp'],
    })
    const job = {
      kind,
      label,
      port,
      url: jobUrl(kind, port),
      log,
      state,
      itemPath: itemPath(label, home, env),
      command: [
        nodePath,
        p.join(repo, 'server', 'install', 'supervise.mjs'),
        '--state',
        state,
        '--log',
        log,
        '--cwd',
        repo,
        ...Object.entries(jobEnv).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
        '--',
        ...args,
      ],
    }
    plan[kind] = { ...job, script: startupScript(job) }
  }
  return plan
}

/** The state file, --port and log an installed Startup script runs with. */
export function parseScript(text) {
  const line = (text ?? '').replace(/""/g, '"')
  const arg = (name) => new RegExp(`${name} (?:"([^"]*)"|([^\\s"]+))`).exec(line)
  const value = (name) => {
    const m = arg(name)
    return m ? (m[1] ?? m[2]) : null
  }
  const port = value('--port')
  return { state: value('--state'), port: port ? Number(port) : null, log: value('--log') }
}

/** As launchd.mjs: loaded means its supervisor is running. */
export function jobStatus(label, { home = os.homedir(), env = process.env } = {}) {
  const file = itemPath(label, home, env)
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  const { state: stateFile, port, log } = parseScript(text)
  const state = stateFile ? readState(stateFile) : null
  const loaded = Boolean(text) && supervisorRunning(state)
  const pid = loaded && alive(state.childPid) ? state.childPid : null
  return {
    label,
    itemPath: file,
    installed: Boolean(text),
    loaded,
    state: loaded ? (pid ? 'running' : 'waiting to restart') : 'not loaded',
    pid,
    lastExit: state?.lastExit ?? null,
    port,
    log,
  }
}

/** Stop a job (its supervisor and everything under it); true when it was running. */
export function bootout(label, { home, env, run = spawnSync } = {}) {
  const status = jobStatus(label, { home, env })
  if (!status.loaded) return false
  const { state } = parseScript(fs.readFileSync(status.itemPath, 'utf8'))
  const pid = readState(state)?.pid
  run('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  return true
}

/** Start a job from its Startup script, as logging in does. */
export async function bootstrap(file) {
  spawn('wscript.exe', [file], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

/** Start a job now if it isn't running, or restart it. */
export function kickstart(label, { restart = false, home, env } = {}) {
  const status = jobStatus(label, { home, env })
  if (status.loaded && !restart) return
  if (status.loaded) bootout(label, { home, env })
  bootstrap(status.itemPath)
}

/** Write a job's Startup script (and its log folder). */
export function writeJob(job) {
  fs.mkdirSync(p.dirname(job.itemPath), { recursive: true })
  fs.mkdirSync(p.dirname(job.log), { recursive: true })
  fs.writeFileSync(job.itemPath, job.script)
}

/** Remove a stopped job's Startup script; true when there was one. */
export function removeJob(file) {
  const existed = fs.existsSync(file)
  fs.rmSync(file, { force: true })
  return existed
}

/** Every Windows user has a Startup folder: null. */
export const unavailable = () => null
