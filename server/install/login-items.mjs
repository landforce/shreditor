// The login items for this system: launchd on macOS, systemd user units on
// Linux, the Startup folder on Windows. All three export the same API:
//   jobPlan(options) -> { editor, service }: label, port, url, log, itemPath, ...
//   jobStatus(label) -> { installed, loaded, state, pid, lastExit, port, log, itemPath }
//   writeJob(job), removeJob(itemPath), bootstrap(itemPath) (turn on and start),
//   bootout(label) (stop and turn off), kickstart(label, { restart })
//   unavailable() -> null, or why login items can't be used here
//   KIND_NAME: what one is called on this system
import * as launchd from './launchd.mjs'
import * as systemd from './systemd.mjs'
import * as windows from './windows-startup.mjs'

export { DEFAULT_LABEL_PREFIX, DEFAULT_PORTS, jobLabel } from './launchd.mjs'

const BACKENDS = { darwin: launchd, linux: systemd, win32: windows }

/** Systems with none: report not installed, and say why on install. */
const none = {
  ...systemd,
  KIND_NAME: 'login item',
  unavailable: () => `login items aren't supported on ${process.platform}`,
  jobStatus: (label) => ({
    label,
    itemPath: null,
    installed: false,
    loaded: false,
    state: 'not loaded',
    pid: null,
    lastExit: null,
    port: null,
    log: null,
  }),
}

export const loginItems = BACKENDS[process.platform] ?? none
export const jobStatus = (label, options) => loginItems.jobStatus(label, options)
