#!/usr/bin/env node
// Keeps one command running for a Windows login item (windows-startup.mjs),
// as launchd and systemd do on the other systems: appends its output to a log,
// restarts it when it exits (at most once per THROTTLE_SECONDS), and records
// its own pid and the command's in a state file so `shreditor` can find,
// restart and stop it. A second copy for the same state file exits at once.
//
//   node supervise.mjs --state <file.json> --log <file> --cwd <dir> [--env K=V]... -- <command> [args...]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { THROTTLE_SECONDS } from './launchd.mjs'

/** { pid, childPid, ... } from a state file, or null. */
export function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Whether the supervisor a state file names is running. A pid recorded before
 * this boot is not it (Windows reuses pids), so it must have started since.
 */
export const supervisorRunning = (state) =>
  alive(state?.pid) && state.since > Date.now() - os.uptime() * 1000

const writeState = (file, state) => {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state))
  fs.renameSync(tmp, file)
}

/** `base` with `extra` set; Windows names are case-insensitive (Path is PATH). */
export function withEnv(base, extra) {
  const upper = new Set(Object.keys(extra).map((key) => key.toUpperCase()))
  return {
    ...Object.fromEntries(Object.entries(base).filter(([key]) => !upper.has(key.toUpperCase()))),
    ...extra,
  }
}

function supervise({ state, log, cwd, env, command }) {
  fs.mkdirSync(path.dirname(state), { recursive: true })
  fs.mkdirSync(path.dirname(log), { recursive: true })
  const other = readState(state)
  if (other?.pid !== process.pid && supervisorRunning(other)) return
  const since = Date.now()
  let child = null
  let stopping = false
  let lastExit = null
  const start = () => {
    if (stopping) return
    const out = fs.openSync(log, 'a')
    child = spawn(command[0], command.slice(1), {
      cwd,
      env: withEnv(process.env, env),
      stdio: ['ignore', out, out],
      windowsHide: true,
    })
    fs.closeSync(out)
    const startedAt = Date.now()
    writeState(state, { pid: process.pid, since, childPid: child.pid ?? null, startedAt, lastExit })
    child.on('exit', (code, signal) => {
      lastExit = code ?? signal
      child = null
      writeState(state, { pid: process.pid, since, childPid: null, startedAt, lastExit })
      if (stopping) return
      const wait = Math.max(0, startedAt + THROTTLE_SECONDS * 1000 - Date.now())
      setTimeout(start, wait)
    })
    child.on('error', (error) => fs.appendFileSync(log, `supervise: ${error.message}\n`))
  }
  const stop = () => {
    stopping = true
    if (child) child.kill()
    setTimeout(() => process.exit(0), 40_000).unref()
    if (!child) process.exit(0)
    else child.on('exit', () => process.exit(0))
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, stop)
  start()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      state: { type: 'string' },
      log: { type: 'string' },
      cwd: { type: 'string' },
      env: { type: 'string', multiple: true, default: [] },
    },
  })
  const env = Object.fromEntries(
    values.env.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
  )
  supervise({ state: values.state, log: values.log, cwd: values.cwd, env, command: positionals })
}
