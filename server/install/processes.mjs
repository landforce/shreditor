// Starting, finding and stopping the editor and the agent service outside
// launchd: what `shred up` / `shred start` run, and what `shreditor install`
// and `shreditor update` stop (safely) or restart.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Parsed JSON from `url`, or null when nothing answers (or it isn't JSON). */
export async function getJson(url, { timeoutMs = 3000, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export const editorInfo = (editorUrl, options) => getJson(`${editorUrl}/__shreditor/info`, options)
export const serviceHealth = (serviceUrl, options) => getJson(`${serviceUrl}/health`, options)

/** Poll `check` until it returns truthy or `timeoutMs` passes; returns the last result. */
export async function waitFor(check, { timeoutMs = 120_000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await check()
    if (result || Date.now() >= deadline) return result
    await sleep(intervalMs)
  }
}

export const logFile = (name) => path.join(os.tmpdir(), `shreditor-${name}.log`)

/**
 * Start the editor detached on `port`: the built preview, or the dev server (dev).
 * A pinned workspace is passed on; otherwise it follows the config.
 */
export function spawnEditor({ repo, port, dev = false, workspace, log = logFile('editor') }) {
  const child = spawn(
    'npm',
    ['run', dev ? 'dev' : 'preview', '--', '--port', String(port), '--strictPort'],
    {
      cwd: repo,
      env: { ...process.env, ...(workspace ? { SHREDITOR_WORKSPACE: workspace } : {}) },
      detached: true,
      stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')],
    },
  )
  child.unref()
  return log
}

/** Start the agent service detached on `workspace` and `port`. */
export function spawnService({ repo, port, workspace, log = logFile('service') }) {
  const child = spawn(
    process.execPath,
    [path.join(repo, 'headless/serve.mjs'), '--workspace', workspace, '--port', String(port)],
    {
      cwd: repo,
      detached: true,
      stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')],
    },
  )
  child.unref()
  return log
}

// What a Shreditor editor or service process looks like in `ps`.
const SHREDITOR_COMMAND = {
  editor: /\b(vp|vite|vite\/node\/cli\.js) (preview|dev)\b/,
  service: /headless\/serve\.mjs|server\/install\/run-service\.mjs/,
}

const commandOf = (pid) => {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/**
 * The pid serving `port` as a Shreditor `kind`: the one the server reports
 * about itself, else (older servers) the listener whose command line is a
 * Shreditor editor or service. null when it can't be told.
 */
export function shreditorPid(kind, { port, reportedPid }) {
  if (Number.isInteger(reportedPid) && reportedPid > 0) return reportedPid
  let pids = []
  try {
    pids = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .map(Number)
  } catch {
    return null
  }
  const matching = pids.filter((pid) => pid > 0 && SHREDITOR_COMMAND[kind].test(commandOf(pid)))
  return matching.length === 1 ? matching[0] : null
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** SIGTERM `pid` and wait for it to exit (SIGKILL after `timeoutMs`). */
export async function stopPid(pid, { timeoutMs = 40_000 } = {}) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (error.code === 'ESRCH') return
    throw error
  }
  if (await waitFor(() => !alive(pid), { timeoutMs, intervalMs: 250 })) return
  process.kill(pid, 'SIGKILL')
  await waitFor(() => !alive(pid), { timeoutMs: 5000, intervalMs: 250 })
}
