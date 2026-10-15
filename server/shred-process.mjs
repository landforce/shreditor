// Runs the agent's own `shred` for editor actions that are agent commands
// (motion re-renders, style kit sets), so the editor and Claude change a
// project the same way.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SHRED = fileURLToPath(new URL('../skills/shreditor-edit/scripts/shred.mjs', import.meta.url))

/** Runs shred with the workspace pinned; resolves its exit code and output. */
export function runShredProcess(args, { root }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SHRED, ...args], {
      env: { ...process.env, SHRED_WORKSPACE: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', (error) => resolve({ code: 1, output: error.message }))
    child.on('close', (code) => resolve({ code, output }))
  })
}

/** The last lines of a failed run, for the editor to show. */
export const failureMessage = (output, fallback) =>
  output.trim().split('\n').slice(-12).join('\n') || fallback
