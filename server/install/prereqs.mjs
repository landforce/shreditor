// What Shreditor needs on this machine (macOS, Linux or Windows), each with a
// clear fix. Checks are pure (they read a probe), so tests stub the machine;
// realProbe() reads this one.
import fs from 'node:fs'
import path from 'node:path'
import { chromeCandidates, chromeExpectedAt, findChrome } from '../platform.mjs'
import { findExecutable, transcriptionConfig } from '../transcription.mjs'
import { DEFAULT_MODEL, findExistingModel } from '../transcription-setup.mjs'
import { depsState, linkedNodeModules, staleBuild } from './build-state.mjs'
import { installCommands, managersHere, manualInstall, packageFor } from './packages.mjs'

export const MIN_NODE_MAJOR = 22
// Where Playwright's channel 'chrome' looks on macOS (other systems: server/platform.mjs).
export const CHROME_PATH = chromeCandidates('darwin')[0]
const BREW_INSTALL =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

/** The facts the checks need, read from this machine and checkout. */
export function realProbe(repo) {
  const config = transcriptionConfig()
  return {
    platform: process.platform,
    nodeVersion: process.versions.node,
    chrome: findChrome(),
    which: (command) => findExecutable(command),
    whisperCli: config.whisperCli,
    model: {
      path: config.model,
      size: fs.statSync(config.model, { throwIfNoEntry: false })?.size ?? 0,
      isDefault: path.basename(config.model) === DEFAULT_MODEL.file,
    },
    get existingModel() {
      return this.model.size === 0 && this.model.isDefault ? findExistingModel(config.model) : null
    },
    deps: depsState(repo),
    depsLinkedTo: linkedNodeModules(repo),
    build: staleBuild(repo),
  }
}

const ok = (id, label, detail) => ({ id, label, ok: true, detail })
const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`

/**
 * A tool a package manager here can install (`fix`), else install steps for
 * the user (`manual`). `optional`: missing it doesn't stop the install.
 */
function toolCheck(id, label, found, { tool, platform, managers, optional = false }) {
  if (found) return ok(id, label, found)
  const pkg = packageFor(tool, managers)
  if (pkg) {
    const [{ command }] = installCommands([pkg])
    return {
      id,
      label,
      ok: false,
      detail: 'not found',
      fix: { kind: pkg.manager, ...pkg, command },
    }
  }
  return {
    id,
    label,
    ok: false,
    detail: 'not found',
    manual: manualInstall(tool, platform),
    ...(optional ? { optional } : {}),
  }
}

const NODE_INSTALL = {
  darwin: 'https://nodejs.org (or: brew install node)',
  linux: 'https://nodejs.org (or with nvm, or your package manager if it has 22+)',
  win32: 'https://nodejs.org (or: winget install -e --id OpenJS.NodeJS.LTS)',
}

const CHROME_INSTALL = {
  darwin: 'Download Chrome from https://www.google.com/chrome/ and drag it into Applications.',
  linux:
    'Install Google Chrome (not Chromium): npx playwright install --with-deps chrome, or the .deb/.rpm from https://www.google.com/chrome/',
  win32:
    'Install Google Chrome: winget install -e --id Google.Chrome, or from https://www.google.com/chrome/',
}

function modelCheck(model, existing) {
  const label = 'Whisper model'
  if (model.size > 0) return ok('model', label, `${model.path} (${gb(model.size)})`)
  if (!model.isDefault)
    return {
      id: 'model',
      label,
      ok: false,
      detail: `${model.path} is missing`,
      manual:
        'Put your model file at the path set in ~/.shreditor/config.json, or remove "model" there to use the default.',
    }
  return {
    id: 'model',
    label,
    ok: false,
    detail: existing ? `not set up (a copy is at ${existing})` : 'not downloaded',
    fix: {
      kind: 'model',
      command: existing
        ? `use the copy at ${existing} (no download)`
        : `download ${DEFAULT_MODEL.file} (${gb(DEFAULT_MODEL.size)}) from ${DEFAULT_MODEL.url}`,
    },
  }
}

function depsCheck(probe) {
  const label = 'Dependencies (node_modules)'
  if (!probe.deps) return ok('deps', label, 'match package-lock.json')
  if (probe.depsLinkedTo)
    return {
      id: 'deps',
      label,
      ok: false,
      detail: probe.deps,
      manual: `node_modules is a link to ${probe.depsLinkedTo}; run npm ci in that checkout.`,
    }
  return {
    id: 'deps',
    label,
    ok: false,
    detail: probe.deps,
    fix: { kind: 'npm-ci', command: 'npm ci' },
  }
}

/**
 * Every prerequisite: { id, label, ok, detail, fix?: { kind, command },
 * manual?: text, optional?: true }. A probe without `platform` is a Mac.
 */
export function checkPrereqs(probe) {
  const platform = probe.platform ?? 'darwin'
  const mac = platform === 'darwin'
  const major = Number(probe.nodeVersion.split('.')[0])
  const brew = probe.which('brew')
  const ffmpeg = probe.which('ffmpeg')
  const ffprobe = probe.which('ffprobe')
  const managers = managersHere(platform, probe.which)
  return [
    major >= MIN_NODE_MAJOR
      ? ok('node', `Node.js ${MIN_NODE_MAJOR}+`, `v${probe.nodeVersion}`)
      : {
          id: 'node',
          label: `Node.js ${MIN_NODE_MAJOR}+`,
          ok: false,
          detail: `v${probe.nodeVersion}`,
          manual: `Install Node.js ${MIN_NODE_MAJOR} or newer from ${NODE_INSTALL[platform] ?? NODE_INSTALL.linux}, then run this again with it.`,
        },
    probe.chrome
      ? ok('chrome', 'Google Chrome', probe.chrome)
      : {
          id: 'chrome',
          label: 'Google Chrome',
          ok: false,
          detail: chromeExpectedAt(platform),
          manual: CHROME_INSTALL[platform] ?? CHROME_INSTALL.linux,
        },
    // Homebrew is how a Mac gets ffmpeg and whisper.cpp; elsewhere it is one option of several.
    ...(mac
      ? [
          brew
            ? ok('brew', 'Homebrew', brew)
            : {
                id: 'brew',
                label: 'Homebrew',
                ok: false,
                detail: 'not found',
                manual: `Install it from https://brew.sh: ${BREW_INSTALL}`,
              },
        ]
      : []),
    toolCheck('ffmpeg', 'ffmpeg and ffprobe', ffmpeg && ffprobe ? `${ffmpeg}, ${ffprobe}` : null, {
      tool: 'ffmpeg',
      platform,
      managers,
    }),
    // Without whisper-cli only native transcription is off, so off a Mac (where
    // it is built or unzipped by hand) it doesn't hold up the install.
    toolCheck('whisper', 'whisper-cli (whisper.cpp)', probe.which(probe.whisperCli), {
      tool: 'whisper',
      platform,
      managers,
      optional: !mac,
    }),
    modelCheck(probe.model, probe.existingModel),
    depsCheck(probe),
    probe.build
      ? {
          id: 'build',
          label: 'Editor build',
          ok: false,
          detail: probe.build,
          fix: { kind: 'build', command: 'npm run build' },
        }
      : ok('build', 'Editor build', 'current'),
  ]
}

const PACKAGE_FIX = new Set(['brew', 'apt', 'dnf', 'pacman', 'winget'])

/**
 * What to do about the failures: `auto` fixes this command can run (packages
 * merged into one install per package manager, e.g. one `brew install`, first),
 * `manual` steps the user must take before it can go on. Homebrew itself is
 * only required when a formula needs it. Optional checks are in neither; see
 * them with laterSteps().
 */
export function planFixes(checks) {
  const failed = checks.filter((c) => !c.ok)
  const auto = [
    ...installCommands(failed.filter((c) => PACKAGE_FIX.has(c.fix?.kind)).map((c) => c.fix)),
    ...failed.filter((c) => c.fix && !PACKAGE_FIX.has(c.fix.kind)).map((c) => c.fix),
  ]
  const brewNeeded = failed.some((c) => c.id === 'ffmpeg' || c.id === 'whisper')
  const manual = failed.filter((c) => c.manual && !c.optional && (c.id !== 'brew' || brewNeeded))
  return { auto, manual }
}

/** Optional checks that failed with no automatic fix: worth saying, not blocking. */
export const laterSteps = (checks) => checks.filter((c) => !c.ok && c.optional && c.manual)
