#!/usr/bin/env node
// The agent service as the login item runs it: the workspace is resolved each
// time it starts ($SHREDITOR_WORKSPACE, else ~/.shreditor/config.json, else
// ~/Movies/Shreditor), so `shreditor choose` then a restart moves it.
//
//   node server/install/run-service.mjs --port 8787
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { main } from '../../headless/serve.mjs'
import { currentWorkspace } from '../workspace-bridge.mjs'

const say = (line) => console.log(`${new Date().toISOString()} ${line}`)

// The headless Chrome this job launches carries a marker switch, so the one a
// killed run left behind (Playwright can't close it after a SIGKILL) is found
// and stopped on the next start instead of running on its own.
const marker = `--shreditor-job=${process.env.XPC_SERVICE_NAME || 'service'}`

/** pids of orphaned processes (parent launchd) started with `marker`. */
export function orphansWith(psOutput, marker) {
  return psOutput
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((m) => m && m[2] === '1' && m[3].split(' ').includes(marker))
    .map((m) => Number(m[1]))
}

function stopOrphanedBrowsers() {
  const ps = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
  for (const pid of orphansWith(ps, marker)) {
    try {
      process.kill(pid, 'SIGKILL')
      say(`stopped the headless Chrome a previous run left behind (pid ${pid})`)
    } catch {}
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.FREECUT_CHROME_ARGS = `${process.env.FREECUT_CHROME_ARGS ?? ''} ${marker}`.trim()
  const { values } = parseArgs({ options: { port: { type: 'string', default: '8787' } } })
  const workspace = currentWorkspace()
  fs.mkdirSync(workspace, { recursive: true })
  stopOrphanedBrowsers()
  say(`starting the agent service on ${workspace}`)
  // launchd runs one copy of this job, so a writer lock whose process is dead is
  // one this job left behind (a crash); take it over rather than wait.
  main(['--workspace', workspace, '--port', values.port, '--break-lock']).catch((error) => {
    console.error(`Service failed to start: ${error.message ?? error}`)
    process.exit(1)
  })
}
