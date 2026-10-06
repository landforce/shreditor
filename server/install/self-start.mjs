// `shred` commands start what they need: the agent service (and the editor,
// for anything that reads the editor's unsaved state) when it isn't answering.
// With the login item installed for that port, launchd starts it; otherwise it
// is started the way `shred up` does. One line says what was started.
import os from 'node:os'
import { DEFAULT_LABEL_PREFIX, bootstrap, jobLabel, jobStatus, kickstart } from './launchd.mjs'
import { waitFor } from './processes.mjs'

/**
 * How to bring one of them up: 'none' (answering), 'kickstart' (its login item
 * is loaded), 'bootstrap' (installed but unloaded), 'spawn' (no login item for
 * this port), or 'refuse' (autostart turned off).
 */
export function startPlan({ up, job, port, autostart = true }) {
  if (up) return 'none'
  if (!autostart) return 'refuse'
  if (!job?.installed || job.port !== Number(port)) return 'spawn'
  return job.loaded ? 'kickstart' : 'bootstrap'
}

/** The login item for `kind`, read from launchd; tests pass `status`. */
const loginItem = (kind, { prefix, home, status = jobStatus }) =>
  status(jobLabel(prefix, kind), { home })

/**
 * ensure('service' | 'editor') brings it up once per process. `targets[kind]`:
 * { name, port, up: async () => bool, spawn: async () => void, timeoutMs? }.
 */
export function createAutostart({
  targets,
  prefix = process.env.SHREDITOR_LABEL_PREFIX || DEFAULT_LABEL_PREFIX,
  autostart = process.env.SHRED_AUTOSTART !== '0',
  home = os.homedir(),
  say = (line) => process.stderr.write(`${line}\n`),
  launchd = { bootstrap, kickstart, status: jobStatus },
}) {
  const started = new Map()
  async function bringUp(kind, explicit) {
    const target = targets[kind]
    if (await target.up()) return 'none'
    const job = loginItem(kind, { prefix, home, status: launchd.status })
    const plan = startPlan({ up: false, job, port: target.port, autostart: autostart || explicit })
    if (plan === 'refuse')
      throw new Error(
        `${target.name} is not running on port ${target.port} (SHRED_AUTOSTART=0; start it with: shred up)`,
      )
    if (plan === 'spawn') await target.spawn()
    // Loading the plist starts it (RunAtLoad); a loaded job is started now.
    else if (plan === 'bootstrap') await launchd.bootstrap(job.plistPath)
    else launchd.kickstart(job.label)
    if (!(await waitFor(target.up, { timeoutMs: target.timeoutMs ?? 240_000 }))) {
      throw new Error(`${target.name} did not start${job?.log ? `; see ${job.log}` : ''}`)
    }
    if (!explicit) say(`started ${target.name}${plan === 'spawn' ? '' : ' (login item)'}`)
    return plan
  }
  return {
    /** explicit: `shred up`/`start` asked for it (always starts, prints nothing itself). */
    ensure(kind, { explicit = false } = {}) {
      if (!started.has(kind)) started.set(kind, bringUp(kind, explicit))
      return started.get(kind)
    },
  }
}
